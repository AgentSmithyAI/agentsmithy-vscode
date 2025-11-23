import {describe, it, expect} from 'vitest';
import {formatToolCallWithPath} from '../toolFormatter';

describe('toolFormatter path handling edge cases', () => {
  const workspaceRoot = '/home/user/project';

  it('handles regular relative paths', () => {
    const args = {target_file: 'src/file.ts'};
    const result = formatToolCallWithPath('read_file', args, workspaceRoot);

    expect(result.path).toBe('/home/user/project/src/file.ts');
    expect(result.displayPath).toBe('src/file.ts');
  });

  it('handles deeply nested relative paths', () => {
    const args = {target_file: 'agentsmithy/llm/providers/openai/models.py'};
    const result = formatToolCallWithPath('read_file', args, workspaceRoot);

    expect(result.path).toBe('/home/user/project/agentsmithy/llm/providers/openai/models.py');
    expect(result.displayPath).toBe('agentsmithy/llm/providers/openai/models.py');
  });

  it('keeps absolute paths unchanged', () => {
    const args = {target_file: '/home/user/project/src/file.ts'};
    const result = formatToolCallWithPath('read_file', args, workspaceRoot);

    expect(result.path).toBe('/home/user/project/src/file.ts');
    expect(result.displayPath).toBe('src/file.ts');
  });

  it('handles workspace root with trailing slash', () => {
    const args = {target_file: 'src/file.ts'};
    const result = formatToolCallWithPath('read_file', args, '/home/user/project/');

    expect(result.path).toBe('/home/user/project/src/file.ts');
  });

  it('EDGE CASE: path starting with / but meant as relative (should not happen in practice)', () => {
    // This is weird but possible if backend sends strange paths
    const args = {target_file: '/subdir/file.txt'};
    const result = formatToolCallWithPath('read_file', args, workspaceRoot);

    // Currently treated as absolute (starts with /), which is correct behavior
    expect(result.path).toBe('/subdir/file.txt');
  });

  it('handles Windows-style paths', () => {
    const windowsRoot = 'C:\\Users\\project';
    const args = {target_file: 'src\\file.ts'};
    const result = formatToolCallWithPath('read_file', args, windowsRoot);

    // Should normalize slashes and join correctly
    expect(result.path).toBe('C:/Users/project/src/file.ts');
  });

  it('handles Windows absolute paths', () => {
    const windowsRoot = 'C:\\Users\\project';
    const args = {target_file: 'C:\\Users\\project\\src\\file.ts'};
    const result = formatToolCallWithPath('read_file', args, windowsRoot);

    // Windows absolute path should be kept (starts with C:\)
    expect(result.path).toBe('C:\\Users\\project\\src\\file.ts');
  });

  it('handles empty string path', () => {
    const args = {target_file: ''};
    const result = formatToolCallWithPath('read_file', args, workspaceRoot);

    expect(result.path).toBeUndefined();
    expect(result.displayPath).toBe('unknown');
  });

  it('handles null/undefined path', () => {
    const args = {};
    const result = formatToolCallWithPath('read_file', args, workspaceRoot);

    expect(result.path).toBeUndefined();
    expect(result.displayPath).toBe('unknown');
  });
});
