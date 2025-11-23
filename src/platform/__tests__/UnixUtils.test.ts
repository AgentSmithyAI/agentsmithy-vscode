import {describe, it, expect, vi, beforeEach} from 'vitest';
import {UnixUtils} from '../UnixUtils';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('fs');
vi.mock('path');

describe('UnixUtils', () => {
  let utils: UnixUtils;

  beforeEach(() => {
    utils = new UnixUtils();
    vi.resetAllMocks();
    vi.mocked(path.basename).mockImplementation((p) => p.split('/').pop() || p);
  });

  describe('getBinaryName', () => {
    it('should return binary name without extension', () => {
      expect(utils.getBinaryName()).toBe('agentsmithy-agent');
    });
  });

  describe('getAssetName', () => {
    it('should format asset name for linux x64', () => {
      expect(utils.getAssetName('1.0.0', {platform: 'linux', arch: 'x64'})).toBe('agentsmithy-linux-amd64-1.0.0');
    });

    it('should format asset name for macos', () => {
      expect(utils.getAssetName('1.0.0', {platform: 'darwin', arch: 'x64'})).toBe('agentsmithy-macos-amd64-1.0.0');
    });

    it('should format asset name for arm64', () => {
      expect(utils.getAssetName('1.0.0', {platform: 'linux', arch: 'arm64'})).toBe('agentsmithy-linux-arm64-1.0.0');
    });
  });

  describe('createFileLink', () => {
    it('should remove existing file if it exists (lstat succeeds)', () => {
      vi.mocked(fs.lstatSync).mockReturnValue({} as fs.Stats);

      utils.createFileLink('/dir/target', '/dir/link');

      expect(fs.unlinkSync).toHaveBeenCalledWith('/dir/link');
    });

    it('should ignore ENOENT when removing existing file', () => {
      vi.mocked(fs.lstatSync).mockImplementation(() => {
        const err = new Error('ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      });

      utils.createFileLink('/dir/target', '/dir/link');

      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });

    it('should create symlink with relative path', () => {
      utils.createFileLink('/dir/target', '/dir/link');

      expect(fs.symlinkSync).toHaveBeenCalledWith('target', '/dir/link');
    });

    it('should make link executable', () => {
      utils.createFileLink('/dir/target', '/dir/link');

      expect(fs.chmodSync).toHaveBeenCalledWith('/dir/link', 0o755);
    });
  });

  describe('makeExecutable', () => {
    it('should chmod 755', () => {
      utils.makeExecutable('/dir/file');
      expect(fs.chmodSync).toHaveBeenCalledWith('/dir/file', 0o755);
    });

    it('should ignore ENOENT', () => {
      vi.mocked(fs.chmodSync).mockImplementation(() => {
        const err = new Error('ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      });

      expect(() => utils.makeExecutable('/dir/file')).not.toThrow();
    });

    it('should throw other errors', () => {
      vi.mocked(fs.chmodSync).mockImplementation(() => {
        const err = new Error('EPERM') as NodeJS.ErrnoException;
        err.code = 'EPERM';
        throw err;
      });

      expect(() => utils.makeExecutable('/dir/file')).toThrow('EPERM');
    });
  });
});
