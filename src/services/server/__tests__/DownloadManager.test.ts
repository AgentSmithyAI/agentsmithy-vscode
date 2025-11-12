import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {DownloadManager} from '../DownloadManager';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import {EventEmitter} from 'events';
import type {IncomingMessage, ClientRequest} from 'http';

// Mock modules
vi.mock('fs');
vi.mock('https');
vi.mock('http');
vi.mock('../../../utils/platform', () => ({
  getAssetName: vi.fn((version: string) => `agentsmithy-linux-amd64-${version}`),
  getVersionedBinaryName: vi.fn((version: string) => `agentsmithy-agent-${version}`),
  createFileLink: vi.fn(),
  getLatestInstalledVersion: vi.fn(),
  compareVersions: vi.fn(),
  getInstalledVersions: vi.fn(() => []),
  makeExecutable: vi.fn(),
}));
vi.mock('../../../utils/crypto', () => ({
  calculateFileSHA256: vi.fn(),
}));

describe('DownloadManager', () => {
  let downloadManager: DownloadManager;
  let mockOutputChannel: {appendLine: ReturnType<typeof vi.fn>};
  let mockWriteStream: EventEmitter & {close: ReturnType<typeof vi.fn>};
  let mockResponse: EventEmitter & Partial<IncomingMessage>;
  let mockRequest: EventEmitter & Partial<ClientRequest>;

  beforeEach(() => {
    mockOutputChannel = {
      appendLine: vi.fn(),
    };

    downloadManager = new DownloadManager('/test/server/dir', mockOutputChannel as never);

    // Setup mock write stream
    mockWriteStream = Object.assign(new EventEmitter(), {
      close: vi.fn((callback: () => void) => callback()),
    });

    // Setup mock response
    mockResponse = Object.assign(new EventEmitter(), {
      statusCode: 200,
      headers: {},
      pipe: vi.fn().mockReturnValue(mockWriteStream),
    });

    // Setup mock request
    mockRequest = Object.assign(new EventEmitter(), {
      end: vi.fn(),
    });

    vi.mocked(fs.createWriteStream).mockReturnValue(mockWriteStream as never);
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.statSync).mockReturnValue({size: 0} as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('downloadBinary', () => {
    it('should download file successfully from scratch', async () => {
      // Arrange
      const expectedSize = 1000;
      const onProgress = vi.fn();

      vi.mocked(https.request).mockImplementation((options: unknown, callback?: (res: IncomingMessage) => void) => {
        if (callback) {
          setTimeout(() => {
            callback(mockResponse as IncomingMessage);
            // Simulate data chunks
            mockResponse.emit('data', Buffer.from('x'.repeat(500)));
            mockResponse.emit('data', Buffer.from('x'.repeat(500)));
            mockWriteStream.emit('finish');
          }, 0);
        }
        return mockRequest as ClientRequest;
      });

      // Act
      const promise = downloadManager.downloadBinary('v1.0.0', '1.0.0', '/test/link', expectedSize, onProgress);

      await promise;

      // Assert
      expect(https.request).toHaveBeenCalled();
      expect(fs.createWriteStream).toHaveBeenCalledWith('/test/server/dir/agentsmithy-agent-1.0.0.part', {flags: 'w'});
      expect(onProgress).toHaveBeenCalled();
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('Downloading server from:'));
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith('Server downloaded successfully');
    });

    it('should resume download from partial file', async () => {
      // Arrange
      const partialSize = 500;
      const expectedSize = 1000;
      const onProgress = vi.fn();

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({size: partialSize} as never);

      let requestOptions: {headers?: {Range?: string}} = {};
      vi.mocked(https.request).mockImplementation((options: unknown, callback?: (res: IncomingMessage) => void) => {
        requestOptions = options as {headers?: {Range?: string}};
        if (callback) {
          setTimeout(() => {
            mockResponse.statusCode = 206; // Partial Content
            mockResponse.headers = {'content-range': `bytes ${partialSize}-999/1000`};
            callback(mockResponse as IncomingMessage);
            // Simulate remaining data
            mockResponse.emit('data', Buffer.from('x'.repeat(500)));
            mockWriteStream.emit('finish');
          }, 0);
        }
        return mockRequest as ClientRequest;
      });

      // Act
      const promise = downloadManager.downloadBinary('v1.0.0', '1.0.0', '/test/link', expectedSize, onProgress);

      await promise;

      // Assert
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('Found partial download'));
      expect(requestOptions.headers?.Range).toBe(`bytes=${partialSize}-`);
      expect(mockResponse.statusCode).toBe(206);
      expect(fs.createWriteStream).toHaveBeenCalledWith(
        '/test/server/dir/agentsmithy-agent-1.0.0.part',
        {flags: 'a'}, // Append mode
      );
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('Resuming download from byte'));
    });

    it('should start over when server does not support resume', async () => {
      // Arrange
      const partialSize = 500;
      const expectedSize = 1000;
      const onProgress = vi.fn();

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({size: partialSize} as never);

      vi.mocked(https.request).mockImplementation((options: unknown, callback?: (res: IncomingMessage) => void) => {
        if (callback) {
          setTimeout(() => {
            mockResponse.statusCode = 200; // Full content, not 206
            callback(mockResponse as IncomingMessage);
            mockResponse.emit('data', Buffer.from('x'.repeat(1000)));
            mockWriteStream.emit('finish');
          }, 0);
        }
        return mockRequest as ClientRequest;
      });

      // Act
      const promise = downloadManager.downloadBinary('v1.0.0', '1.0.0', '/test/link', expectedSize, onProgress);

      await promise;

      // Assert
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('Server does not support resume'),
      );
      expect(fs.unlinkSync).toHaveBeenCalled();
      expect(fs.createWriteStream).toHaveBeenCalledWith(
        '/test/server/dir/agentsmithy-agent-1.0.0.part',
        {flags: 'w'}, // Write mode, not append
      );
    });

    it('should follow redirects and preserve Range header', async () => {
      // Arrange
      const partialSize = 500;
      const expectedSize = 1000;
      const onProgress = vi.fn();

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({size: partialSize} as never);

      let callCount = 0;
      const requests: Array<{headers?: {Range?: string}}> = [];

      vi.mocked(https.request).mockImplementation((options: unknown, callback?: (res: IncomingMessage) => void) => {
        requests.push(options as {headers?: {Range?: string}});
        if (callback) {
          setTimeout(() => {
            if (callCount === 0) {
              // First call: redirect
              mockResponse.statusCode = 302;
              mockResponse.headers = {location: 'https://cdn.example.com/file'};
              callback(mockResponse as IncomingMessage);
              callCount++;
            } else {
              // Second call: actual download with 206
              mockResponse.statusCode = 206;
              mockResponse.headers = {'content-range': `bytes ${partialSize}-999/1000`};
              callback(mockResponse as IncomingMessage);
              mockResponse.emit('data', Buffer.from('x'.repeat(500)));
              mockWriteStream.emit('finish');
            }
          }, 0);
        }
        return mockRequest as ClientRequest;
      });

      // Act
      const promise = downloadManager.downloadBinary('v1.0.0', '1.0.0', '/test/link', expectedSize, onProgress);

      await promise;

      // Assert
      expect(https.request).toHaveBeenCalledTimes(2);
      // Both requests should have Range header
      expect(requests[0].headers?.Range).toBe(`bytes=${partialSize}-`);
      expect(requests[1].headers?.Range).toBe(`bytes=${partialSize}-`);
      expect(mockResponse.statusCode).toBe(206);
    });

    it('should call progress callback with correct values', async () => {
      // Arrange
      const expectedSize = 1000;
      const onProgress = vi.fn();

      vi.mocked(https.request).mockImplementation((options: unknown, callback?: (res: IncomingMessage) => void) => {
        if (callback) {
          setTimeout(() => {
            callback(mockResponse as IncomingMessage);
            // Simulate data chunks
            mockResponse.emit('data', Buffer.from('x'.repeat(300)));
            mockResponse.emit('data', Buffer.from('x'.repeat(400)));
            mockResponse.emit('data', Buffer.from('x'.repeat(300)));
            mockWriteStream.emit('finish');
          }, 0);
        }
        return mockRequest as ClientRequest;
      });

      // Act
      const promise = downloadManager.downloadBinary('v1.0.0', '1.0.0', '/test/link', expectedSize, onProgress);

      await promise;

      // Assert - progress should be called with accumulated bytes
      expect(onProgress).toHaveBeenCalled();
      const calls = onProgress.mock.calls;
      // Check that bytes accumulate
      expect(calls[calls.length - 1]).toEqual([expectedSize, expectedSize]); // Final call: 100%
    });

    it('should call progress callback from resumed position', async () => {
      // Arrange
      const partialSize = 500;
      const expectedSize = 1000;
      const onProgress = vi.fn();

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({size: partialSize} as never);

      vi.mocked(https.request).mockImplementation((options: unknown, callback?: (res: IncomingMessage) => void) => {
        if (callback) {
          setTimeout(() => {
            mockResponse.statusCode = 206;
            mockResponse.headers = {'content-range': `bytes ${partialSize}-999/1000`};
            callback(mockResponse as IncomingMessage);
            mockResponse.emit('data', Buffer.from('x'.repeat(500)));
            mockWriteStream.emit('finish');
          }, 0);
        }
        return mockRequest as ClientRequest;
      });

      // Act
      const promise = downloadManager.downloadBinary('v1.0.0', '1.0.0', '/test/link', expectedSize, onProgress);

      await promise;

      // Assert - initial progress should be from partial size
      expect(onProgress).toHaveBeenCalledWith(partialSize, expectedSize); // Initial call
      const finalCall = onProgress.mock.calls[onProgress.mock.calls.length - 1];
      expect(finalCall).toEqual([expectedSize, expectedSize]); // Final call: 100%
    });

    it('should handle download errors without deleting partial file', async () => {
      // Arrange
      const expectedSize = 1000;
      const onProgress = vi.fn();

      vi.mocked(https.request).mockImplementation((options: unknown, callback?: (res: IncomingMessage) => void) => {
        if (callback) {
          setTimeout(() => {
            callback(mockResponse as IncomingMessage);
            mockResponse.emit('data', Buffer.from('x'.repeat(300)));
            // Simulate error
            mockWriteStream.emit('error', new Error('Write failed'));
          }, 0);
        }
        return mockRequest as ClientRequest;
      });

      // Act & Assert
      await expect(
        downloadManager.downloadBinary('v1.0.0', '1.0.0', '/test/link', expectedSize, onProgress),
      ).rejects.toThrow('File write failed');

      // Partial file should NOT be deleted (to allow resume)
      expect(fs.unlinkSync).not.toHaveBeenCalledWith('/test/server/dir/agentsmithy-agent-1.0.0.part');
    });

    it('should handle request errors without deleting partial file', async () => {
      // Arrange
      const expectedSize = 1000;
      const onProgress = vi.fn();

      vi.mocked(https.request).mockImplementation(() => {
        setTimeout(() => {
          mockRequest.emit('error', new Error('Network error'));
        }, 0);
        return mockRequest as ClientRequest;
      });

      // Act & Assert
      await expect(
        downloadManager.downloadBinary('v1.0.0', '1.0.0', '/test/link', expectedSize, onProgress),
      ).rejects.toThrow('Download failed');

      // Partial file should NOT be deleted (to allow resume)
      expect(fs.unlinkSync).not.toHaveBeenCalledWith('/test/server/dir/agentsmithy-agent-1.0.0.part');
    });

    it('should log progress at intervals', async () => {
      // Arrange
      const expectedSize = 1000;
      const onProgress = vi.fn();

      vi.mocked(https.request).mockImplementation((options: unknown, callback?: (res: IncomingMessage) => void) => {
        if (callback) {
          setTimeout(() => {
            callback(mockResponse as IncomingMessage);
            // Emit data chunks
            mockResponse.emit('data', Buffer.from('x'.repeat(500)));
            mockResponse.emit('data', Buffer.from('x'.repeat(500)));
            mockWriteStream.emit('finish');
          }, 0);
        }
        return mockRequest as ClientRequest;
      });

      // Act
      const promise = downloadManager.downloadBinary('v1.0.0', '1.0.0', '/test/link', expectedSize, onProgress);

      await promise;

      // Assert - should log download start
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('Downloading server from:'));
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith('Server downloaded successfully');
    });
  });

  describe('fetchLatestRelease', () => {
    it('should fetch latest release info from GitHub', async () => {
      // Arrange
      const mockReleaseData = {
        tag_name: 'v1.0.0',
        assets: [
          {
            name: 'agentsmithy-linux-amd64-v1.0.0',
            size: 1000,
            digest: 'sha256:abc123',
          },
        ],
      };

      const mockGetResponse = Object.assign(new EventEmitter(), {
        statusCode: 200,
        headers: {},
      });

      vi.mocked(https.get).mockImplementation((options: unknown, callback?: (res: IncomingMessage) => void) => {
        if (callback) {
          // Call callback immediately with response
          callback(mockGetResponse as IncomingMessage);
          // Then emit data and end
          setImmediate(() => {
            mockGetResponse.emit('data', JSON.stringify(mockReleaseData));
            mockGetResponse.emit('end');
          });
        }
        return mockGetResponse as never;
      });

      // Act
      const result = await downloadManager.fetchLatestRelease();

      // Assert
      expect(result).toEqual({
        version: 'v1.0.0',
        size: 1000,
        sha256: 'abc123',
      });
    });
  });

  describe('cleanupOldVersions', () => {
    it('should remove old versions and their partial files', async () => {
      // Arrange
      const {getInstalledVersions} = await import('../../../utils/platform');
      vi.mocked(getInstalledVersions).mockReturnValue(['1.0.0', '0.9.0', '0.8.0']);
      vi.mocked(fs.existsSync).mockReturnValue(true);

      // Act
      await downloadManager.cleanupOldVersions('1.0.0');

      // Assert
      expect(fs.unlinkSync).toHaveBeenCalledWith('/test/server/dir/agentsmithy-agent-0.9.0');
      expect(fs.unlinkSync).toHaveBeenCalledWith('/test/server/dir/agentsmithy-agent-0.9.0.part');
      expect(fs.unlinkSync).toHaveBeenCalledWith('/test/server/dir/agentsmithy-agent-0.8.0');
      expect(fs.unlinkSync).toHaveBeenCalledWith('/test/server/dir/agentsmithy-agent-0.8.0.part');
      expect(fs.unlinkSync).not.toHaveBeenCalledWith('/test/server/dir/agentsmithy-agent-1.0.0');
    });

    it('should handle errors when removing old versions', async () => {
      // Arrange
      const {getInstalledVersions} = await import('../../../utils/platform');
      vi.mocked(getInstalledVersions).mockReturnValue(['1.0.0', '0.9.0']);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.unlinkSync).mockImplementation((path: unknown) => {
        if ((path as string).includes('0.9.0')) {
          throw new Error('Permission denied');
        }
      });

      // Act
      await downloadManager.cleanupOldVersions('1.0.0');

      // Assert
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('Failed to remove old version'),
      );
    });
  });

  describe('verifyIntegrity', () => {
    it('should return true when file size matches', () => {
      // Arrange
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({size: 1000} as never);

      // Act
      const result = downloadManager.verifyIntegrity('1.0.0', 1000);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when file size does not match', () => {
      // Arrange
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({size: 500} as never);

      // Act
      const result = downloadManager.verifyIntegrity('1.0.0', 1000);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when file does not exist', () => {
      // Arrange
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // Act
      const result = downloadManager.verifyIntegrity('1.0.0', 1000);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('verifySHA256', () => {
    it('should return true when SHA256 matches', async () => {
      // Arrange
      const {calculateFileSHA256} = await import('../../../utils/crypto');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(calculateFileSHA256).mockResolvedValue('abc123');

      // Act
      const result = await downloadManager.verifySHA256('1.0.0', 'ABC123'); // Case insensitive

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when SHA256 does not match', async () => {
      // Arrange
      const {calculateFileSHA256} = await import('../../../utils/crypto');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(calculateFileSHA256).mockResolvedValue('abc123');

      // Act
      const result = await downloadManager.verifySHA256('1.0.0', 'def456');

      // Assert
      expect(result).toBe(false);
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('SHA256 mismatch'));
    });

    it('should return true when no SHA256 provided', async () => {
      // Act
      const result = await downloadManager.verifySHA256('1.0.0', '');

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when file does not exist', async () => {
      // Arrange
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // Act
      const result = await downloadManager.verifySHA256('1.0.0', 'abc123');

      // Assert
      expect(result).toBe(false);
    });

    it('should handle SHA256 calculation errors', async () => {
      // Arrange
      const {calculateFileSHA256} = await import('../../../utils/crypto');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(calculateFileSHA256).mockRejectedValue(new Error('Calculation failed'));

      // Act
      const result = await downloadManager.verifySHA256('1.0.0', 'abc123');

      // Assert
      expect(result).toBe(false);
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('Failed to calculate SHA256'));
    });
  });

  describe('acquireLock', () => {
    it('should acquire lock successfully', async () => {
      // Arrange
      vi.mocked(fs.openSync).mockReturnValue(3 as never);
      vi.mocked(fs.writeSync).mockReturnValue(5 as never);
      vi.mocked(fs.closeSync).mockReturnValue(undefined);

      // Act
      const result = await downloadManager.acquireLock();

      // Assert
      expect(result).toBe(true);
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith('Acquired download lock');
    });

    it('should remove stale lock and retry', async () => {
      // Arrange
      let callCount = 0;
      vi.mocked(fs.openSync).mockImplementation(() => {
        if (callCount === 0) {
          callCount++;
          const error = new Error('File exists') as NodeJS.ErrnoException;
          error.code = 'EEXIST';
          throw error;
        }
        return 3 as never;
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('999999'); // Non-existent PID
      vi.mocked(fs.unlinkSync).mockReturnValue(undefined);
      vi.mocked(fs.writeSync).mockReturnValue(5 as never);
      vi.mocked(fs.closeSync).mockReturnValue(undefined);

      // Mock isProcessAlive to return false for stale PID
      vi.spyOn(process, 'kill').mockImplementation(() => {
        throw new Error('No such process');
      });

      // Act
      const result = await downloadManager.acquireLock();

      // Assert
      expect(result).toBe(true);
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('Removing stale download lock'),
      );
    });

    it('should fail when lock is held by another process', async () => {
      // Arrange
      vi.mocked(fs.openSync).mockImplementation(() => {
        const error = new Error('File exists') as NodeJS.ErrnoException;
        error.code = 'EEXIST';
        throw error;
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(String(process.pid)); // Current process PID

      // Mock isProcessAlive to return true
      vi.spyOn(process, 'kill').mockReturnValue(true);

      // Act
      const result = await downloadManager.acquireLock(2); // Only 2 attempts

      // Assert
      expect(result).toBe(false);
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('Download lock is held by another VSCode instance'),
      );
    });
  });

  describe('downloadBinary - additional scenarios', () => {
    it('should handle 416 Range Not Satisfiable status', async () => {
      // Arrange
      const partialSize = 1000;
      const expectedSize = 1000;
      const onProgress = vi.fn();

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({size: partialSize} as never);

      vi.mocked(https.request).mockImplementation((options: unknown, callback?: (res: IncomingMessage) => void) => {
        if (callback) {
          setTimeout(() => {
            mockResponse.statusCode = 416; // Range Not Satisfiable
            callback(mockResponse as IncomingMessage);
          }, 0);
        }
        return mockRequest as ClientRequest;
      });

      // Act
      const promise = downloadManager.downloadBinary('v1.0.0', '1.0.0', '/test/link', expectedSize, onProgress);

      await promise;

      // Assert
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith('Download appears to be complete, finalizing...');
    });

    it('should handle unexpected status codes', async () => {
      // Arrange
      const expectedSize = 1000;
      const onProgress = vi.fn();

      vi.mocked(https.request).mockImplementation((options: unknown, callback?: (res: IncomingMessage) => void) => {
        if (callback) {
          setTimeout(() => {
            mockResponse.statusCode = 404; // Not Found
            callback(mockResponse as IncomingMessage);
          }, 0);
        }
        return mockRequest as ClientRequest;
      });

      // Act & Assert
      await expect(
        downloadManager.downloadBinary('v1.0.0', '1.0.0', '/test/link', expectedSize, onProgress),
      ).rejects.toThrow('Download failed with status code: 404');
    });

    it('should handle finalization errors', async () => {
      // Arrange
      const expectedSize = 1000;
      const onProgress = vi.fn();

      vi.mocked(https.request).mockImplementation((options: unknown, callback?: (res: IncomingMessage) => void) => {
        if (callback) {
          setTimeout(() => {
            callback(mockResponse as IncomingMessage);
            mockResponse.emit('data', Buffer.from('x'.repeat(1000)));
            mockWriteStream.emit('finish');
          }, 0);
        }
        return mockRequest as ClientRequest;
      });

      vi.mocked(fs.renameSync).mockImplementation(() => {
        throw new Error('Rename failed');
      });

      // Act & Assert
      await expect(
        downloadManager.downloadBinary('v1.0.0', '1.0.0', '/test/link', expectedSize, onProgress),
      ).rejects.toThrow('Failed to finalize download');
    });
  });

  describe('releaseLock', () => {
    it('should release lock successfully', () => {
      // Arrange
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.unlinkSync).mockReturnValue(undefined);

      // Act
      downloadManager.releaseLock();

      // Assert
      expect(fs.unlinkSync).toHaveBeenCalled();
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith('Released download lock');
    });

    it('should handle errors when releasing lock', () => {
      // Arrange
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.unlinkSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      // Act
      downloadManager.releaseLock();

      // Assert
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('Failed to release download lock'),
      );
    });

    it('should do nothing when lock file does not exist', () => {
      // Arrange
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // Act
      downloadManager.releaseLock();

      // Assert
      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });
  });

  describe('getLatestInstalled', () => {
    it('should return latest installed version', async () => {
      // Arrange
      const {getLatestInstalledVersion} = await import('../../../utils/platform');
      vi.mocked(getLatestInstalledVersion).mockReturnValue('1.0.0');

      // Act
      const result = downloadManager.getLatestInstalled();

      // Assert
      expect(result).toBe('1.0.0');
    });
  });

  describe('compareVersions', () => {
    it('should compare versions', async () => {
      // Arrange
      const {compareVersions: platformCompareVersions} = await import('../../../utils/platform');
      vi.mocked(platformCompareVersions).mockReturnValue(1);

      // Act
      const result = downloadManager.compareVersions('2.0.0', '1.0.0');

      // Assert
      expect(result).toBe(1);
    });
  });
});
