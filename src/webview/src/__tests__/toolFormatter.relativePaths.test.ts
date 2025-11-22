import {describe, it, expect} from 'vitest';
import {formatToolCallWithPath} from '../toolFormatter';

describe('toolFormatter with relative paths', () => {
  const workspaceRoot = '/home/user/project';

  it('REPRO: relative paths should be made absolute', () => {
    const args = {target_file: 'agentsmithy/llm/providers/openai/models.py'};
    const result = formatToolCallWithPath('read_file', args, workspaceRoot);

    // Currently returns relative path
    console.log('Current path:', result.path);
    console.log('Display path:', result.displayPath);

    // Path should be absolute for data-file attribute
    expect(result.path).toBe('/home/user/project/agentsmithy/llm/providers/openai/models.py');
    expect(result.displayPath).toBe('agentsmithy/llm/providers/openai/models.py');
  });

  it('keeps absolute paths unchanged', () => {
    const args = {target_file: '/home/user/project/src/file.ts'};
    const result = formatToolCallWithPath('read_file', args, workspaceRoot);

    expect(result.path).toBe('/home/user/project/src/file.ts');
    expect(result.displayPath).toBe('src/file.ts');
  });

  it('handles paths outside workspace correctly', () => {
    const args = {target_file: '/etc/passwd'};
    const result = formatToolCallWithPath('read_file', args, workspaceRoot);

    // Should keep absolute path as-is (validation happens later in _handleOpenFile)
    expect(result.path).toBe('/etc/passwd');
  });
});
