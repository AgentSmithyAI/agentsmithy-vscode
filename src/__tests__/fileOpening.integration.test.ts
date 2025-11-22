import {describe, it, expect, vi, beforeEach} from 'vitest';
import * as path from 'path';

/**
 * Tests for file opening validation logic
 * Reproduces the "Opening files outside the workspace is not allowed" issue
 */
describe('File Opening Integration', () => {
  describe('Path validation logic (OLD BUGGY)', () => {
    const validateFilePath = (file: string, workspaceRoot: string): {allowed: boolean; reason?: string} => {
      if (!file || !workspaceRoot) {
        return {allowed: false, reason: 'Empty path or workspace'};
      }

      const resolvedFile = path.resolve(file); // BUG: relative paths resolve from CWD!
      const resolvedRoot = path.resolve(workspaceRoot);

      // Current buggy logic
      if (!resolvedFile.startsWith(resolvedRoot + path.sep) && resolvedFile !== resolvedRoot) {
        return {allowed: false, reason: `${resolvedFile} not in ${resolvedRoot}${path.sep}`};
      }

      return {allowed: true};
    };

    it('REPRO: fails for workspace root without trailing separator', () => {
      const workspace = '/home/user/project';
      const file = '/home/user/project/src/file.ts';

      const result = validateFilePath(file, workspace);
      console.log('Result:', result);

      // This should pass but might fail with current logic
      expect(result.allowed).toBe(true);
    });

    it('REPRO: fails when workspace has trailing slash', () => {
      const workspace = '/home/user/project/';
      const file = '/home/user/project/src/file.ts';

      const result = validateFilePath(file, workspace);

      expect(result.allowed).toBe(true);
    });

    it('REPRO: edge case - opening workspace root itself', () => {
      const workspace = '/home/user/project';
      const file = '/home/user/project';

      const result = validateFilePath(file, workspace);

      // Should be allowed (opening workspace root folder)
      expect(result.allowed).toBe(true);
    });

    it('correctly rejects files outside workspace', () => {
      const workspace = '/home/user/project';
      const file = '/home/user/other/file.ts';

      const result = validateFilePath(file, workspace);

      expect(result.allowed).toBe(false);
    });

    it('correctly rejects path traversal attacks', () => {
      const workspace = '/home/user/project';
      const file = '/home/user/project/../../etc/passwd';

      const result = validateFilePath(file, workspace);

      // After resolve, this becomes /home/etc/passwd
      expect(result.allowed).toBe(false);
    });
  });

  describe('Fixed validation logic', () => {
    const validateFilePathFixed = (file: string, workspaceRoot: string): {allowed: boolean; reason?: string} => {
      if (!file || !workspaceRoot) {
        return {allowed: false, reason: 'Empty path or workspace'};
      }

      // FIX: Resolve relative paths from workspace root, not CWD
      const resolvedFile = path.isAbsolute(file) ? path.resolve(file) : path.resolve(workspaceRoot, file);
      const resolvedRoot = path.resolve(workspaceRoot);

      // Normalize: ensure root ends with separator for consistent comparison
      const normalizedRoot = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;

      // File is inside workspace if it starts with workspace path
      if (resolvedFile === resolvedRoot || resolvedFile.startsWith(normalizedRoot)) {
        return {allowed: true};
      }

      return {allowed: false, reason: `${resolvedFile} not in ${normalizedRoot}`};
    };

    it('allows absolute files inside workspace', () => {
      const workspace = '/home/user/project';
      const file = '/home/user/project/src/file.ts';

      const result = validateFilePathFixed(file, workspace);

      expect(result.allowed).toBe(true);
    });

    it('allows relative files inside workspace', () => {
      const workspace = '/home/user/project';
      const file = 'agentsmithy/llm/providers/openai/models.py';

      const result = validateFilePathFixed(file, workspace);

      expect(result.allowed).toBe(true);
    });

    it('allows workspace root itself', () => {
      const workspace = '/home/user/project';
      const file = '/home/user/project';

      const result = validateFilePathFixed(file, workspace);

      expect(result.allowed).toBe(true);
    });

    it('handles trailing slashes correctly', () => {
      const workspace = '/home/user/project/';
      const file = '/home/user/project/src/file.ts';

      const result = validateFilePathFixed(file, workspace);

      expect(result.allowed).toBe(true);
    });

    it('rejects files outside workspace', () => {
      const workspace = '/home/user/project';
      const file = '/home/user/other/file.ts';

      const result = validateFilePathFixed(file, workspace);

      expect(result.allowed).toBe(false);
    });

    it('rejects path traversal attacks', () => {
      const workspace = '/home/user/project';
      const file = '/home/user/project/../../etc/passwd';

      const result = validateFilePathFixed(file, workspace);

      expect(result.allowed).toBe(false);
    });
  });
});
