import {describe, it, expect} from 'vitest';
import {
  parseVersionFromFilename,
  compareVersions,
  getInstalledVersions,
  getLatestInstalledVersion,
} from '../VersionUtils';
import * as fs from 'fs';
import {vi} from 'vitest';

vi.mock('fs');

describe('VersionUtils', () => {
  describe('parseVersionFromFilename', () => {
    it('should parse version from linux filename', () => {
      expect(parseVersionFromFilename('agentsmithy-linux-amd64-1.2.3')).toBe('1.2.3');
    });

    it('should parse version from windows filename', () => {
      expect(parseVersionFromFilename('agentsmithy-windows-amd64-1.2.3.exe')).toBe('1.2.3');
    });

    it('should parse version with v prefix', () => {
      expect(parseVersionFromFilename('agentsmithy-linux-amd64-v1.2.3')).toBe('1.2.3');
    });

    it('should return null for invalid filename', () => {
      expect(parseVersionFromFilename('invalid-filename')).toBeNull();
    });
  });

  describe('compareVersions', () => {
    it('should return 1 if a > b', () => {
      expect(compareVersions('1.2.0', '1.1.0')).toBe(1);
    });

    it('should return -1 if a < b', () => {
      expect(compareVersions('1.1.0', '1.2.0')).toBe(-1);
    });

    it('should return 0 if a == b', () => {
      expect(compareVersions('1.2.0', '1.2.0')).toBe(0);
    });
  });

  describe('getInstalledVersions', () => {
    it('should return sorted versions', () => {
      vi.mocked(fs.readdirSync).mockReturnValue([
        'agentsmithy-linux-amd64-1.0.0' as unknown as fs.Dirent,
        'agentsmithy-linux-amd64-1.2.0' as unknown as fs.Dirent,
        'agentsmithy-linux-amd64-1.1.0' as unknown as fs.Dirent,
        'junk-file' as unknown as fs.Dirent,
      ]);

      const versions = getInstalledVersions('/tmp');
      expect(versions).toEqual(['1.2.0', '1.1.0', '1.0.0']);
    });

    it('should return empty array on error', () => {
      vi.mocked(fs.readdirSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });
      expect(getInstalledVersions('/tmp')).toEqual([]);
    });
  });

  describe('getLatestInstalledVersion', () => {
    it('should return latest version', () => {
      vi.mocked(fs.readdirSync).mockReturnValue([
        'agentsmithy-linux-amd64-1.0.0' as unknown as fs.Dirent,
        'agentsmithy-linux-amd64-1.2.0' as unknown as fs.Dirent,
      ]);
      expect(getLatestInstalledVersion('/tmp')).toBe('1.2.0');
    });

    it('should return null if no versions found', () => {
      vi.mocked(fs.readdirSync).mockReturnValue([]);
      expect(getLatestInstalledVersion('/tmp')).toBeNull();
    });
  });
});
