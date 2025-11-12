/* eslint-disable no-undef */
import * as fs from 'fs';
import * as path from 'path';
import semver from 'semver';

export interface PlatformInfo {
  platform: 'linux' | 'darwin' | 'win32';
  arch: 'x64' | 'arm64';
}

/**
 * Get current platform information
 * Note: Does not validate if platform is supported by AgentSmithy server.
 * Use DownloadManager.fetchLatestRelease() to check if asset exists for this platform.
 */
export const getPlatformInfo = (): PlatformInfo => {
  const platform = process.platform as 'linux' | 'darwin' | 'win32';
  const arch = process.arch as 'x64' | 'arm64';

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
 *
 * Note: This function generates expected asset name based on current platform.
 * It doesn't guarantee the asset exists - use DownloadManager.fetchLatestRelease()
 * to verify asset availability.
 */
export const getAssetName = (version: string): string => {
  const {platform, arch} = getPlatformInfo();
  // Remove 'v' prefix if present using semver
  const cleanVersion = semver.clean(version) || version.replace(/^v/, '');

  // Map Node.js arch to binary arch naming
  // Only map known architectures, use original name for unknown ones
  let binaryArch: string;
  if (arch === 'x64') {
    binaryArch = 'amd64';
  } else if (arch === 'arm64') {
    binaryArch = 'arm64';
  } else {
    // Unknown architecture (ia32, arm, mips, ppc64, s390x, etc.)
    // Use Node.js arch name as-is, will fail when asset not found
    binaryArch = arch;
  }

  // Map platform to binary OS naming
  let os: string;
  let ext = '';

  if (platform === 'linux') {
    os = 'linux';
  } else if (platform === 'darwin') {
    os = 'macos';
  } else if (platform === 'win32') {
    os = 'windows';
    ext = '.exe';
  } else {
    // Unknown platform - use Node.js platform name as-is
    // Will fail when asset not found with helpful error message
    os = platform;
  }

  return `agentsmithy-${os}-${binaryArch}-${cleanVersion}${ext}`;
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
  if (!match) {
    return null;
  }

  // Use semver to validate and clean the version
  const version = semver.clean(match[1]);
  return version;
};

/**
 * Compare two semantic versions using semver library
 * Returns: 1 if a > b, -1 if a < b, 0 if equal
 */
export const compareVersions = (a: string, b: string): number => {
  return semver.compare(a, b);
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
