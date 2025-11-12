/* eslint-disable no-undef */
import * as fs from 'fs';
import * as path from 'path';

export interface PlatformInfo {
  platform: 'linux' | 'darwin' | 'win32';
  arch: 'x64' | 'arm64';
}

/**
 * Get current platform information
 */
export const getPlatformInfo = (): PlatformInfo => {
  const platform = process.platform as 'linux' | 'darwin' | 'win32';
  const arch = process.arch as 'x64' | 'arm64';

  if (!['linux', 'darwin', 'win32'].includes(platform)) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  if (!['x64', 'arm64'].includes(arch)) {
    throw new Error(`Unsupported architecture: ${arch}`);
  }

  return {platform, arch};
};

/**
 * Get binary filename for current platform
 */
export const getBinaryName = (): string => {
  const {platform} = getPlatformInfo();
  return platform === 'win32' ? 'agentsmithy-agent.exe' : 'agentsmithy-agent';
};

/**
 * Get asset name from GitHub releases for current platform
 * GitHub releases use naming: agentsmithy-{os}-{arch}-{version}
 */
export const getAssetName = (version: string): string => {
  const {platform, arch} = getPlatformInfo();
  // Remove 'v' prefix if present
  const cleanVersion = version.replace(/^v/, '');

  if (platform === 'linux') {
    return `agentsmithy-linux-amd64-${cleanVersion}`;
  }
  if (platform === 'darwin') {
    return arch === 'arm64' ? `agentsmithy-macos-arm64-${cleanVersion}` : `agentsmithy-macos-amd64-${cleanVersion}`;
  }
  // platform === 'win32'
  return `agentsmithy-windows-amd64-${cleanVersion}.exe`;
};

/**
 * Get versioned filename for downloaded binary (same as asset name)
 */
export const getVersionedBinaryName = (version: string): string => {
  return getAssetName(version);
};

/**
 * Parse version from versioned binary filename
 * Example: "agentsmithy-linux-amd64-1.8.4" -> "1.8.4"
 */
export const parseVersionFromFilename = (filename: string): string | null => {
  // Match version at the end, with or without .exe
  const match = filename.match(/-(v?\d+\.\d+\.\d+)(?:\.exe)?$/);
  return match ? match[1] : null;
};

/**
 * Compare two semantic versions
 * Returns: 1 if a > b, -1 if a < b, 0 if equal
 */
export const compareVersions = (a: string, b: string): number => {
  const cleanA = a.replace(/^v/, '');
  const cleanB = b.replace(/^v/, '');

  const partsA = cleanA.split('.').map(Number);
  const partsB = cleanB.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    if (partsA[i] > partsB[i]) {
      return 1;
    }
    if (partsA[i] < partsB[i]) {
      return -1;
    }
  }

  return 0;
};

/**
 * Get all installed server versions in directory
 */
export const getInstalledVersions = (serverDir: string): string[] => {
  try {
    const files = fs.readdirSync(serverDir);
    const versions: string[] = [];

    for (const file of files) {
      const version = parseVersionFromFilename(file);
      if (version) {
        versions.push(version);
      }
    }

    return versions.sort((a, b) => compareVersions(b, a)); // Newest first
  } catch {
    // Directory doesn't exist or can't be read
    return [];
  }
};

/**
 * Get the latest installed version
 */
export const getLatestInstalledVersion = (serverDir: string): string | null => {
  const versions = getInstalledVersions(serverDir);
  return versions.length > 0 ? versions[0] : null;
};

/**
 * Make file executable on Unix systems
 */
export const makeExecutable = (filePath: string): void => {
  const {platform} = getPlatformInfo();

  if (platform !== 'win32') {
    try {
      fs.chmodSync(filePath, 0o755);
    } catch (error) {
      // Ignore ENOENT - file doesn't exist
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
};

/**
 * Create a link (symlink on Unix, hard link on Windows) to a file
 * Also ensures the target has proper executable permissions
 */
export const createFileLink = (targetPath: string, linkPath: string): void => {
  const {platform} = getPlatformInfo();

  // Remove existing link if present
  try {
    fs.unlinkSync(linkPath);
  } catch (error) {
    // Ignore ENOENT - file doesn't exist or was already removed
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  if (platform === 'win32') {
    // Windows: use hard link (doesn't require admin rights)
    fs.linkSync(targetPath, linkPath);
  } else {
    // Linux/macOS: use symbolic link with relative path
    // For symlinks in same directory, use just the filename
    const targetName = path.basename(targetPath);
    fs.symlinkSync(targetName, linkPath);

    // Ensure link is executable
    makeExecutable(linkPath);
  }
};
