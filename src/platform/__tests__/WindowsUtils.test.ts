import {describe, it, expect, vi, beforeEach} from 'vitest';
import {WindowsUtils} from '../WindowsUtils';
import * as fs from 'fs';

vi.mock('fs');

describe('WindowsUtils', () => {
  let utils: WindowsUtils;

  beforeEach(() => {
    utils = new WindowsUtils();
    vi.resetAllMocks();
  });

  describe('getBinaryName', () => {
    it('should return executable name with .exe extension', () => {
      expect(utils.getBinaryName()).toBe('agentsmithy-agent.exe');
    });
  });

  describe('getAssetName', () => {
    it('should format asset name for x64', () => {
      expect(utils.getAssetName('1.0.0', {platform: 'win32', arch: 'x64'})).toBe('agentsmithy-windows-amd64-1.0.0.exe');
    });

    it('should format asset name for arm64', () => {
      expect(utils.getAssetName('1.0.0', {platform: 'win32', arch: 'arm64'})).toBe(
        'agentsmithy-windows-arm64-1.0.0.exe',
      );
    });

    it('should use raw arch for others', () => {
      expect(utils.getAssetName('1.0.0', {platform: 'win32', arch: 'ia32'})).toBe('agentsmithy-windows-ia32-1.0.0.exe');
    });

    it('should clean version string', () => {
      expect(utils.getAssetName('v1.0.0', {platform: 'win32', arch: 'x64'})).toBe(
        'agentsmithy-windows-amd64-1.0.0.exe',
      );
    });
  });

  describe('createFileLink', () => {
    it('should remove existing file if it exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      utils.createFileLink('target', 'link');

      expect(fs.unlinkSync).toHaveBeenCalledWith('link');
    });

    it('should try hard link first', () => {
      utils.createFileLink('target', 'link');

      expect(fs.linkSync).toHaveBeenCalledWith('target', 'link');
      expect(fs.copyFileSync).not.toHaveBeenCalled();
    });

    it('should fallback to copy if hard link fails', () => {
      vi.mocked(fs.linkSync).mockImplementation(() => {
        throw new Error('EPERM');
      });

      utils.createFileLink('target', 'link');

      expect(fs.linkSync).toHaveBeenCalledWith('target', 'link');
      expect(fs.copyFileSync).toHaveBeenCalledWith('target', 'link');
    });
  });

  describe('makeExecutable', () => {
    it('should do nothing on Windows', () => {
      utils.makeExecutable('file');
      expect(fs.chmodSync).not.toHaveBeenCalled();
    });
  });
});
