export interface PlatformInfo {
  platform: string;
  arch: string;
}

export interface IPlatformUtils {
  /**
   * Get binary filename for the platform
   */
  getBinaryName(): string;

  /**
   * Get asset name from GitHub releases
   */
  getAssetName(version: string, platformInfo: PlatformInfo): string;

  /**
   * Create a link to the target file
   */
  createFileLink(targetPath: string, linkPath: string): void;

  /**
   * Make file executable (chmod on Unix)
   */
  makeExecutable(filePath: string): void;
}
