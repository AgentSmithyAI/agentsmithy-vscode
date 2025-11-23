import * as fs from 'fs';
import * as semver from 'semver';

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
