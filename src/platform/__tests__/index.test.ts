import {describe, it, expect} from 'vitest';
import {getPlatformUtils, getPlatformInfo} from '../index';
import {WindowsUtils} from '../WindowsUtils';
import {UnixUtils} from '../UnixUtils';

describe('Platform Factory', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
    });
  });

  it('should return WindowsUtils for win32', () => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
    });
    expect(getPlatformUtils()).toBeInstanceOf(WindowsUtils);
  });

  it('should return UnixUtils for linux', () => {
    Object.defineProperty(process, 'platform', {
      value: 'linux',
    });
    expect(getPlatformUtils()).toBeInstanceOf(UnixUtils);
  });

  it('should return UnixUtils for darwin', () => {
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
    });
    expect(getPlatformUtils()).toBeInstanceOf(UnixUtils);
  });

  describe('getPlatformInfo', () => {
    it('should return current process info', () => {
      const info = getPlatformInfo();
      expect(info.platform).toBe(process.platform);
      expect(info.arch).toBe(process.arch);
    });
  });
});
