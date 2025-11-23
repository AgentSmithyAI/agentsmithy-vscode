import * as fs from 'fs';
import * as path from 'path';
import * as semver from 'semver';
import {IPlatformUtils, PlatformInfo} from './IPlatformUtils';

export class UnixUtils implements IPlatformUtils {
  getBinaryName = (): string => 'agentsmithy-agent';

  getAssetName = (version: string, platformInfo: PlatformInfo): string => {
    const cleanVersion = semver.clean(version) || version.replace(/^v/, '');

    let binaryArch: string;
    if (platformInfo.arch === 'x64') {
      binaryArch = 'amd64';
    } else if (platformInfo.arch === 'arm64') {
      binaryArch = 'arm64';
    } else {
      binaryArch = platformInfo.arch;
    }

    let os = platformInfo.platform;
    if (platformInfo.platform === 'darwin') {
      os = 'macos';
    }

    return `agentsmithy-${os}-${binaryArch}-${cleanVersion}`;
  };

  createFileLink(targetPath: string, linkPath: string): void {
    try {
      // Check if exists (handling broken symlinks too with lstat)
      try {
        fs.lstatSync(linkPath);
        fs.unlinkSync(linkPath);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw e;
        }
      }
    } catch {
      // Ignore error
    }

    // Use relative path for symlink
    const targetName = path.basename(targetPath);
    fs.symlinkSync(targetName, linkPath);

    this.makeExecutable(linkPath);
  }

  makeExecutable = (filePath: string): void => {
    try {
      fs.chmodSync(filePath, 0o755);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  };
}
