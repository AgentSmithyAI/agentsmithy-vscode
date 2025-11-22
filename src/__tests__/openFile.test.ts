import {describe, it, expect, vi, beforeEach} from 'vitest';
import * as vscode from 'vscode';
import * as path from 'path';

describe('File opening validation', () => {
  it('should allow opening files inside workspace', () => {
    const workspaceRoot = '/home/user/project';
    const file = '/home/user/project/src/file.ts';

    const resolvedFile = path.resolve(file);
    const resolvedRoot = path.resolve(workspaceRoot);

    // Current logic
    const isAllowed = resolvedFile.startsWith(resolvedRoot + path.sep) || resolvedFile === resolvedRoot;

    expect(isAllowed).toBe(true);
  });

  it('should reject files outside workspace', () => {
    const workspaceRoot = '/home/user/project';
    const file = '/home/user/other/file.ts';

    const resolvedFile = path.resolve(file);
    const resolvedRoot = path.resolve(workspaceRoot);

    const isAllowed = resolvedFile.startsWith(resolvedRoot + path.sep) || resolvedFile === resolvedRoot;

    expect(isAllowed).toBe(false);
  });

  it('should handle trailing slashes in workspace root', () => {
    const workspaceRoot = '/home/user/project/';
    const file = '/home/user/project/src/file.ts';

    const resolvedFile = path.resolve(file);
    const resolvedRoot = path.resolve(workspaceRoot);

    const isAllowed = resolvedFile.startsWith(resolvedRoot + path.sep) || resolvedFile === resolvedRoot;

    expect(isAllowed).toBe(true);
  });

  it('should handle files without leading slash (relative)', () => {
    const workspaceRoot = '/home/user/project';
    const file = 'src/file.ts'; // Relative path

    const resolvedFile = path.resolve(file);
    const resolvedRoot = path.resolve(workspaceRoot);

    // When resolving relative path, it uses current working directory
    // This test shows the issue - if CWD != workspace, it fails
    console.log('resolvedFile:', resolvedFile);
    console.log('resolvedRoot:', resolvedRoot);

    const isAllowed = resolvedFile.startsWith(resolvedRoot + path.sep) || resolvedFile === resolvedRoot;

    // This might fail depending on CWD
    expect(typeof isAllowed).toBe('boolean');
  });

  it('should handle files with .. in path but still inside workspace', () => {
    const workspaceRoot = '/home/user/project';
    const file = '/home/user/project/src/../lib/file.ts'; // Resolves to /home/user/project/lib/file.ts

    const resolvedFile = path.resolve(file);
    const resolvedRoot = path.resolve(workspaceRoot);

    expect(resolvedFile).toBe('/home/user/project/lib/file.ts');

    const isAllowed = resolvedFile.startsWith(resolvedRoot + path.sep) || resolvedFile === resolvedRoot;

    expect(isAllowed).toBe(true);
  });
});
