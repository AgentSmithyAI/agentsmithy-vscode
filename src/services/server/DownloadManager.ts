import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import semver from 'semver';
import {
  getPlatformUtils,
  getPlatformInfo,
  getLatestInstalledVersion,
  compareVersions,
  getInstalledVersions,
  IPlatformUtils,
} from '../../platform';
import {calculateFileSHA256} from '../../utils/crypto';

export class DownloadManager {
  private readonly serverDir: string;
  private readonly outputChannel: vscode.OutputChannel;
  private readonly platformUtils: IPlatformUtils;

  constructor(serverDir: string, outputChannel: vscode.OutputChannel) {
    this.serverDir = serverDir;
    this.outputChannel = outputChannel;
    this.platformUtils = getPlatformUtils();
  }

  /**
   * Get lock file path
   */
  private getLockPath = (): string => {
    return path.join(this.serverDir, '.download.lock');
  };

  /**
   * Check if process with given PID is running
   */
  private isProcessAlive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  /**
   * Try to acquire download lock
   */
  private tryAcquireLock = (): boolean => {
    const lockPath = this.getLockPath();

    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, process.pid.toString());
      fs.closeSync(fd);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        try {
          const lockPid = Number.parseInt(fs.readFileSync(lockPath, 'utf8'), 10);
          if (!this.isProcessAlive(lockPid)) {
            this.outputChannel.appendLine(`Removing stale download lock (PID ${lockPid})`);
            fs.unlinkSync(lockPath);
            return this.tryAcquireLock();
          }
          return false;
        } catch {
          try {
            fs.unlinkSync(lockPath);
            return this.tryAcquireLock();
          } catch {
            return false;
          }
        }
      }
      return false;
    }
  };

  /**
   * Acquire download lock, waiting if necessary
   */
  acquireLock = async (maxAttempts = 60): Promise<boolean> => {
    for (let i = 0; i < maxAttempts; i++) {
      if (this.tryAcquireLock()) {
        this.outputChannel.appendLine('Acquired download lock');
        return true;
      }

      if (i === 0) {
        this.outputChannel.appendLine('Download lock is held by another VSCode instance, waiting...');
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 1000);
      });
    }

    this.outputChannel.appendLine('Failed to acquire download lock after timeout');
    return false;
  };

  /**
   * Release download lock
   */
  releaseLock = (): void => {
    const lockPath = this.getLockPath();
    try {
      fs.unlinkSync(lockPath);
      this.outputChannel.appendLine('Released download lock');
    } catch (error) {
      // Ignore ENOENT - file doesn't exist or was already removed
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.outputChannel.appendLine(`Failed to release download lock: ${errorMessage}`);
      }
    }
  };

  /**
   * Fetch latest release info from GitHub
   */
  fetchLatestRelease = async (): Promise<{version: string; size: number; sha256: string}> => {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.github.com',
        path: '/repos/AgentSmithyAI/agentsmithy-agent/releases/latest',
        method: 'GET',
        headers: {
          'User-Agent': 'AgentSmithy-VSCode',
          Accept: 'application/vnd.github+json',
        },
      };

      https
        .get(options, (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            try {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
              const release = JSON.parse(data);

              const version = release.tag_name as string;

              // Validate version from GitHub API using semver
              if (!semver.valid(version)) {
                reject(new Error(`Invalid version format from GitHub API: ${version}`));
                return;
              }

              const assets = release.assets as unknown[];

              const assetName = this.platformUtils.getAssetName(version, getPlatformInfo());

              const asset = assets.find((a: unknown) => {
                return (a as {name: string}).name === assetName;
              });

              if (asset === undefined) {
                const {platform, arch} = getPlatformInfo();
                const availableAssets = assets.map((a: unknown) => (a as {name: string}).name).join(', ');
                reject(
                  new Error(
                    `Asset ${assetName} not found in release ${version}.\n` +
                      `Your platform: ${platform} ${arch}\n` +
                      `Available assets: ${availableAssets}\n` +
                      `This platform/architecture combination may not be supported by AgentSmithy server.`,
                  ),
                );
                return;
              }

              const size = (asset as {size: number}).size;
              // Get SHA256 from digest field (format: "sha256:hash")
              const digest = (asset as {digest?: string}).digest || '';
              const sha256 = digest.replace(/^sha256:/, '');

              resolve({version, size, sha256});
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              reject(new Error(`Failed to parse release data: ${errorMessage}`));
            }
          });
        })
        .on('error', (error) => {
          reject(new Error(`Failed to fetch latest version: ${error.message}`));
        });
    });
  };

  /**
   * Validate version tag format using semver library
   */
  validateVersionTag = (version: string): void => {
    // Check for empty or invalid input
    if (!version || typeof version !== 'string') {
      throw new Error(`Invalid version tag: empty or invalid value`);
    }

    // Security: prevent path traversal before validation
    if (version.includes('..') || version.includes('/') || version.includes('\\')) {
      throw new Error(`Invalid version tag: contains path traversal characters`);
    }

    // Use semver to validate - accepts both 'v1.0.0' and '1.0.0'
    const valid = semver.valid(version);
    if (!valid) {
      throw new Error(`Invalid version tag format: ${version}. Expected valid semver like "v1.0.0" or "1.0.0"`);
    }
  };

  /**
   * Validate clean version format (semver WITHOUT 'v' prefix)
   */
  validateCleanVersion = (version: string): void => {
    // Check for empty or invalid input
    if (!version || typeof version !== 'string') {
      throw new Error(`Invalid version: empty or invalid value`);
    }

    // Security: prevent path traversal before validation
    if (version.includes('..') || version.includes('/') || version.includes('\\')) {
      throw new Error(`Invalid version: contains path traversal characters`);
    }

    // Use semver to validate
    const valid = semver.valid(version);
    if (!valid) {
      throw new Error(`Invalid version format: ${version}. Expected valid semver like "1.0.0"`);
    }

    // Additional check: ensure no 'v' prefix in clean version
    if (version.startsWith('v')) {
      throw new Error(`Invalid version format: ${version}. Clean version should not have 'v' prefix`);
    }
  };

  /**
   * Finalize downloaded file: verify SHA256, rename temp to final, make executable, create link
   */
  private finalizeDownload = async (
    tempPath: string,
    versionedPath: string,
    linkPath: string,
    _version: string,
    expectedSHA256?: string,
  ): Promise<void> => {
    // Security: Verify SHA256 BEFORE making file executable
    if (expectedSHA256) {
      this.outputChannel.appendLine('Verifying SHA256...');
      const actualSHA256 = await calculateFileSHA256(tempPath);
      const match = actualSHA256.toLowerCase() === expectedSHA256.toLowerCase();

      if (!match) {
        this.outputChannel.appendLine(`SHA256 mismatch: expected ${expectedSHA256}, got ${actualSHA256}`);
        // Delete compromised file
        try {
          fs.unlinkSync(tempPath);
        } catch {
          // Ignore errors during cleanup
        }
        throw new Error('SHA256 verification failed - file may be corrupted or compromised');
      }
      this.outputChannel.appendLine('SHA256 verified successfully');
    } else {
      this.outputChannel.appendLine('Warning: No SHA256 provided, skipping verification');
    }

    // Now safe to finalize
    try {
      fs.unlinkSync(versionedPath);
    } catch (error) {
      // Ignore ENOENT - file doesn't exist
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    fs.renameSync(tempPath, versionedPath);
    this.platformUtils.makeExecutable(versionedPath);
    this.platformUtils.createFileLink(versionedPath, linkPath);
    this.outputChannel.appendLine('Server downloaded successfully');
  };

  /**
   * Setup progress tracking callbacks for download stream
   */
  private setupProgressTracking = (
    response: http.IncomingMessage,
    actualOffset: number,
    expectedSize: number,
    onProgress?: (downloaded: number, total: number) => void,
  ): void => {
    let downloadedBytes = actualOffset;
    let lastReportTime = Date.now();
    let lastLogTime = Date.now();

    response.on('data', (chunk: Buffer) => {
      downloadedBytes += chunk.length;
      const now = Date.now();

      // Report progress to UI (throttle to every 100ms)
      if (onProgress && now - lastReportTime >= 100) {
        onProgress(downloadedBytes, expectedSize);
        lastReportTime = now;
      }

      // Log progress to output channel (throttle to every 2 seconds)
      if (now - lastLogTime >= 2000) {
        const percent = Math.round((downloadedBytes / expectedSize) * 100);
        this.outputChannel.appendLine(`Download progress: ${percent}% (${downloadedBytes} / ${expectedSize} bytes)`);
        lastLogTime = now;
      }
    });
  };

  /**
   * Handle successful HTTP response (200 or 206)
   */
  private handleSuccessfulResponse = (
    response: http.IncomingMessage,
    tempPath: string,
    versionedPath: string,
    linkPath: string,
    offset: number,
    expectedSize: number,
    version: string,
    expectedSHA256: string | undefined,
    onProgress: ((downloaded: number, total: number) => void) | undefined,
    resolve: () => void,
    reject: (error: Error) => void,
  ): void => {
    // If we requested a range but got 200, server doesn't support resume - start over
    const shouldAppend = response.statusCode === 206 && offset > 0;
    let actualOffset = offset;

    if (shouldAppend) {
      this.outputChannel.appendLine(`Resuming download from byte ${offset}`);
    } else if (offset > 0 && response.statusCode === 200) {
      this.outputChannel.appendLine('Server does not support resume, starting from beginning');
      // Delete partial file and start fresh
      try {
        fs.unlinkSync(tempPath);
      } catch (error) {
        // Ignore ENOENT - file was already removed
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          const errorMessage = error instanceof Error ? error.message : String(error);
          reject(new Error(`Failed to remove partial file: ${errorMessage}`));
          return;
        }
      }
      actualOffset = 0; // Reset offset since we're starting over
    }

    // Open file in append mode if resuming, otherwise create new
    const file = fs.createWriteStream(tempPath, {flags: shouldAppend ? 'a' : 'w'});

    // Track download progress
    this.setupProgressTracking(response, actualOffset, expectedSize, onProgress);

    // Flag to prevent multiple error handlers from running
    let errorHandled = false;

    // Handle response stream errors (network errors during download)
    response.on('error', (error) => {
      if (errorHandled) {
        return;
      }
      errorHandled = true;

      file.close(() => {
        // Don't delete temp file on error - allow resume
        reject(new Error(`Download stream error: ${error.message}`));
      });
    });

    response.pipe(file);

    file.on('finish', () => {
      file.close(() => {
        // Final progress report
        if (onProgress) {
          onProgress(expectedSize, expectedSize);
        }

        // Finalize download (includes SHA256 verification)
        this.finalizeDownload(tempPath, versionedPath, linkPath, version, expectedSHA256)
          .then(() => resolve())
          .catch((error) => {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(`Failed to finalize download: ${errorMessage}`);
            reject(new Error(`Failed to finalize download: ${errorMessage}`));
          });
      });
    });

    file.on('error', (error) => {
      if (errorHandled) {
        return;
      }
      errorHandled = true;

      // Clean up streams to prevent resource leaks
      response.unpipe(file);
      response.destroy();
      file.close(() => {
        // Don't delete temp file on error - allow resume
        reject(new Error(`File write failed: ${error.message}`));
      });
    });
  };

  /**
   * Check if partial download exists and return start byte for resume
   */
  private checkPartialDownload = (
    tempPath: string,
    expectedSize: number,
    onProgress?: (downloaded: number, total: number) => void,
  ): number => {
    try {
      const stats = fs.statSync(tempPath);
      const startByte = stats.size;

      if (startByte > 0) {
        const percent = Math.round((startByte / expectedSize) * 100);
        this.outputChannel.appendLine(
          `Found partial download: ${startByte} / ${expectedSize} bytes (${percent}%), resuming...`,
        );
        // Report initial progress for resumed download
        if (onProgress) {
          onProgress(startByte, expectedSize);
        }
      } else {
        // Empty .part file, remove it
        try {
          fs.unlinkSync(tempPath);
        } catch (error) {
          // Ignore ENOENT - file was already removed
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
          }
        }
      }

      return startByte;
    } catch (error) {
      // Ignore ENOENT - partial file doesn't exist
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      return 0;
    }
  };

  /**
   * Download server binary from GitHub with resume support
   * @param versionTag - version tag with 'v' prefix for GitHub URL (e.g., 'v1.9.0')
   * @param versionClean - version without 'v' for filenames (e.g., '1.9.0')
   * @param linkPath - path to create symlink
   * @param expectedSize - expected file size in bytes
   * @param expectedSHA256 - expected SHA256 hash for security verification (optional but recommended)
   * @param onProgress - callback for progress updates (downloaded, total)
   */
  downloadBinary = async (
    versionTag: string,
    versionClean: string,
    linkPath: string,
    expectedSize: number,
    expectedSHA256: string | undefined,
    onProgress?: (downloaded: number, total: number) => void,
  ): Promise<void> => {
    // Security: Validate version strings to prevent path traversal and URL injection
    this.validateVersionTag(versionTag);
    this.validateCleanVersion(versionClean);

    const assetName = this.platformUtils.getAssetName(versionClean, getPlatformInfo());
    const versionedPath = path.join(this.serverDir, assetName);
    const tempPath = `${versionedPath}.part`; // Temporary file for downloading
    const downloadUrl = `https://github.com/AgentSmithyAI/agentsmithy-agent/releases/download/${versionTag}/${assetName}`;

    // Check if partial download exists
    const startByte = this.checkPartialDownload(tempPath, expectedSize, onProgress);

    this.outputChannel.appendLine(`Downloading server from: ${downloadUrl}`);

    return new Promise((resolve, reject) => {
      const MAX_REDIRECTS = 10;

      const makeRequest = (url: string, offset: number, redirectCount = 0) => {
        // Prevent infinite redirect loops
        if (redirectCount > MAX_REDIRECTS) {
          reject(new Error(`Too many redirects (>${MAX_REDIRECTS})`));
          return;
        }

        const protocol = url.startsWith('https') ? https : http;
        const parsedUrl = new URL(url);

        const options = {
          hostname: parsedUrl.hostname,
          path: parsedUrl.pathname + parsedUrl.search,
          method: 'GET',
          headers: offset > 0 ? {Range: `bytes=${offset}-`} : {},
        };

        const req = protocol.request(options, (response) => {
          // Handle redirects (301, 302, 307, 308)
          if (
            response.statusCode === 301 ||
            response.statusCode === 302 ||
            response.statusCode === 307 ||
            response.statusCode === 308
          ) {
            const redirectUrl = response.headers.location;
            if (!redirectUrl) {
              response.destroy();
              reject(new Error('Redirect location not found'));
              return;
            }
            // Destroy response before following redirect (it won't be used)
            response.destroy();
            this.outputChannel.appendLine(`Following redirect (${redirectCount + 1}/${MAX_REDIRECTS}): ${redirectUrl}`);
            makeRequest(redirectUrl, offset, redirectCount + 1);
            return;
          }

          // Check for successful response or partial content
          if (response.statusCode === 200 || response.statusCode === 206) {
            this.handleSuccessfulResponse(
              response,
              tempPath,
              versionedPath,
              linkPath,
              offset,
              expectedSize,
              versionClean,
              expectedSHA256,
              onProgress,
              resolve,
              reject,
            );
          } else if (response.statusCode === 416 && offset > 0) {
            // Range not satisfiable - file might be complete already
            this.outputChannel.appendLine('Download appears to be complete, finalizing...');
            // Response is complete for 416, safe to destroy
            response.destroy();
            this.finalizeDownload(tempPath, versionedPath, linkPath, versionClean, expectedSHA256)
              .then(() => resolve())
              .catch((error) => {
                const errorMessage = error instanceof Error ? error.message : String(error);
                reject(new Error(`Failed to finalize download: ${errorMessage}`));
              });
          } else {
            // On error, keep temp file for resume but report error
            response.destroy();
            reject(new Error(`Download failed with status code: ${response.statusCode}`));
          }
        });

        req.on('error', (error) => {
          // Don't delete temp file on error - allow resume
          reject(new Error(`Download failed: ${error.message}`));
        });

        req.end();
      };

      makeRequest(downloadUrl, startByte);
    });
  };

  /**
   * Verify binary integrity by size
   */
  verifyIntegrity = (version: string, expectedSize: number): boolean => {
    const filePath = path.join(this.serverDir, this.platformUtils.getAssetName(version, getPlatformInfo()));

    try {
      const stats = fs.statSync(filePath);
      return stats.size === expectedSize;
    } catch {
      // File doesn't exist or can't be accessed
      return false;
    }
  };

  /**
   * Verify binary SHA256
   */
  verifySHA256 = async (version: string, expectedSHA256: string): Promise<boolean> => {
    if (!expectedSHA256) {
      // No SHA256 available, skip verification
      return true;
    }

    const filePath = path.join(this.serverDir, this.platformUtils.getAssetName(version, getPlatformInfo()));

    try {
      const actualSHA256 = await calculateFileSHA256(filePath);
      const match = actualSHA256.toLowerCase() === expectedSHA256.toLowerCase();

      if (!match) {
        this.outputChannel.appendLine(`SHA256 mismatch: expected ${expectedSHA256}, got ${actualSHA256}`);
      }

      return match;
    } catch (error) {
      // File doesn't exist or can't calculate SHA256
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`Failed to calculate SHA256: ${errorMessage}`);
      return false;
    }
  };

  /**
   * Remove a single file with error handling
   */
  private removeFileIfExists = (filePath: string, description: string): void => {
    try {
      fs.unlinkSync(filePath);
      this.outputChannel.appendLine(`Removed ${description}`);
    } catch (error) {
      // Ignore ENOENT - file doesn't exist or was already removed
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.outputChannel.appendLine(`Failed to remove ${description}: ${errorMessage}`);
      }
    }
  };

  /**
   * Clean up old versions and partial downloads
   */
  cleanupOldVersions = async (currentVersion: string): Promise<void> => {
    const allVersions = getInstalledVersions(this.serverDir);

    for (const version of allVersions) {
      if (version !== currentVersion) {
        const oldPath = path.join(this.serverDir, this.platformUtils.getAssetName(version, getPlatformInfo()));
        const oldPartPath = `${oldPath}.part`;

        this.removeFileIfExists(oldPath, `old version: ${version}`);
        this.removeFileIfExists(oldPartPath, `partial download: ${version}`);
      }
    }
  };

  /**
   * Get latest installed version
   */
  getLatestInstalled = (): string | null => {
    return getLatestInstalledVersion(this.serverDir);
  };

  /**
   * Compare versions
   */
  compareVersions = (a: string, b: string): number => {
    return compareVersions(a, b);
  };
}
