import * as fs from 'fs';
import * as semver from 'semver';
import {IPlatformUtils, PlatformInfo} from './IPlatformUtils';

export class WindowsUtils implements IPlatformUtils {
  getBinaryName = (): string => 'agentsmithy-agent.exe';

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

    return `agentsmithy-windows-${binaryArch}-${cleanVersion}.exe`;
  };

  createFileLink = (targetPath: string, linkPath: string): void => {
    try {
      if (fs.existsSync(linkPath)) {
        fs.unlinkSync(linkPath);
      }
    } catch {
      // Ignore error removing existing file
    }

    try {
      // Windows: try hard link first (standard, efficient)
      fs.linkSync(targetPath, linkPath);
    } catch {
      // Fallback to copy if link fails (more robust)
      fs.copyFileSync(targetPath, linkPath);
    }
  };

  makeExecutable = (_filePath: string): void => {
    // No-op on Windows
  };
}
