import {IPlatformUtils, PlatformInfo} from './IPlatformUtils';
import {WindowsUtils} from './WindowsUtils';
import {UnixUtils} from './UnixUtils';

export * from './IPlatformUtils';
export * from './WindowsUtils';
export * from './UnixUtils';
export * from './VersionUtils';

export const getPlatformInfo = (): PlatformInfo => {
  return {
    platform: process.platform,
    arch: process.arch,
  };
};

export const getPlatformUtils = (): IPlatformUtils => {
  if (process.platform === 'win32') {
    return new WindowsUtils();
  }
  return new UnixUtils();
};
