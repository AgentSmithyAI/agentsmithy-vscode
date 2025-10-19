import { formatToolCallWithPath } from '../toolFormatter';

describe('toolFormatter', () => {
  const workspaceRoot = '/home/user/project';

  describe('file operations', () => {
    it('formats read_file tool call', () => {
      const result = formatToolCallWithPath('read_file', {target_file: '/home/user/project/src/test.ts'}, workspaceRoot);
      expect(result).toEqual({
        prefix: 'Reading: ',
        path: '/home/user/project/src/test.ts',
        displayPath: 'src/test.ts',
        text: 'Reading: src/test.ts',
      });
    });

    it('formats write tool calls', () => {
      const result = formatToolCallWithPath('write', {file_path: '/home/user/project/output.txt'}, workspaceRoot);
      expect(result).toEqual({
        prefix: 'Writing: ',
        path: '/home/user/project/output.txt',
        displayPath: 'output.txt',
        text: 'Writing: output.txt',
      });
    });

    it('formats delete_file tool call', () => {
      const result = formatToolCallWithPath('delete_file', {target_file: '/home/user/project/old.js'}, workspaceRoot);
      expect(result).toEqual({
        prefix: 'Deleting: ',
        path: '/home/user/project/old.js',
        displayPath: 'old.js',
        text: 'Deleting: old.js',
      });
    });

    it('formats edit tool calls', () => {
      const result = formatToolCallWithPath('search_replace', {file_path: '/home/user/project/main.ts'}, workspaceRoot);
      expect(result).toEqual({
        prefix: 'Editing: ',
        path: '/home/user/project/main.ts',
        displayPath: 'main.ts',
        text: 'Editing: main.ts',
      });
    });

    it('formats multiedit tool call', () => {
      const result = formatToolCallWithPath('multiedit', {path: '/home/user/project/app.ts'}, workspaceRoot);
      expect(result).toEqual({
        prefix: 'Multi-edit: ',
        path: '/home/user/project/app.ts',
        displayPath: 'app.ts',
        text: 'Multi-edit: app.ts',
      });
    });

    it('formats edit_notebook tool call', () => {
      const result = formatToolCallWithPath(
        'edit_notebook',
        {target_notebook: '/home/user/project/analysis.ipynb'},
        workspaceRoot,
      );
      expect(result).toEqual({
        prefix: 'Editing notebook: ',
        path: '/home/user/project/analysis.ipynb',
        displayPath: 'analysis.ipynb',
        text: 'Editing notebook: analysis.ipynb',
      });
    });
  });

  describe('path extraction', () => {
    it('extracts path from different argument names', () => {
      expect(formatToolCallWithPath('read_file', {path: 'a.ts'}, workspaceRoot).displayPath).toBe('a.ts');
      expect(formatToolCallWithPath('read_file', {file: 'b.ts'}, workspaceRoot).displayPath).toBe('b.ts');
      expect(formatToolCallWithPath('read_file', {target_file: 'c.ts'}, workspaceRoot).displayPath).toBe('c.ts');
      expect(formatToolCallWithPath('read_file', {file_path: 'd.ts'}, workspaceRoot).displayPath).toBe('d.ts');
    });

    it('handles paths array by taking first element', () => {
      const result = formatToolCallWithPath(
        'read_file',
        {paths: ['/home/user/project/first.ts', '/home/user/project/second.ts']},
        workspaceRoot,
      );
      expect(result.displayPath).toBe('first.ts');
    });

    it('returns unknown when no path found', () => {
      const result = formatToolCallWithPath('read_file', {}, workspaceRoot);
      expect(result.displayPath).toBe('unknown');
    });
  });

  describe('linter operations', () => {
    it('formats read_lints with single file', () => {
      const result = formatToolCallWithPath(
        'read_lints',
        {paths: ['/home/user/project/src/main.ts']},
        workspaceRoot,
      );
      expect(result).toEqual({
        prefix: 'Reading linter errors for ',
        path: '/home/user/project/src/main.ts',
        displayPath: 'src/main.ts',
        suffix: '',
        text: 'Reading linter errors for src/main.ts',
      });
    });

    it('formats read_lints with multiple files', () => {
      const result = formatToolCallWithPath(
        'read_lints',
        {
          paths: [
            '/home/user/project/src/a.ts',
            '/home/user/project/src/b.ts',
            '/home/user/project/src/c.ts',
          ],
        },
        workspaceRoot,
      );
      expect(result.suffix).toBe(' and 2 more');
      expect(result.text).toBe('Reading linter errors for src/a.ts, src/b.ts, src/c.ts');
    });

    it('handles read_lints with no paths', () => {
      const result = formatToolCallWithPath('read_lints', {}, workspaceRoot);
      expect(result).toEqual({text: 'Reading linter errors'});
    });
  });

  describe('directory operations', () => {
    it('formats list_dir tool call', () => {
      const result = formatToolCallWithPath('list_dir', {target_directory: '/home/user/project/src'}, workspaceRoot);
      expect(result.text).toBe('List: /home/user/project/src');
    });

    it('handles list_files with different argument names', () => {
      expect(formatToolCallWithPath('list_files', {path: 'src'}, workspaceRoot).text).toBe('List: src');
      expect(formatToolCallWithPath('list_dir', {directory: 'lib'}, workspaceRoot).text).toBe('List: lib');
    });
  });

  describe('command operations', () => {
    it('formats run_terminal_cmd tool call', () => {
      const result = formatToolCallWithPath('run_terminal_cmd', {command: 'npm test'}, workspaceRoot);
      expect(result.text).toBe('Running: npm test');
    });

    it('handles missing command', () => {
      const result = formatToolCallWithPath('run_command', {}, workspaceRoot);
      expect(result.text).toBe('Running: unknown');
    });
  });

  describe('search operations', () => {
    it('formats grep search', () => {
      const result = formatToolCallWithPath('grep', {pattern: 'TODO'}, workspaceRoot);
      expect(result.text).toBe('Search: TODO');
    });

    it('formats codebase_search', () => {
      const result = formatToolCallWithPath('codebase_search', {query: 'authentication logic'}, workspaceRoot);
      expect(result.text).toBe('Search: authentication logic');
    });

    it('formats glob_file_search with all parameters', () => {
      const result = formatToolCallWithPath(
        'glob_file_search',
        {
          glob_pattern: '*.ts',
          file_pattern: '**/*.test.ts',
          target_directory: 'src',
        },
        workspaceRoot,
      );
      expect(result.text).toBe('Search: *.ts (glob: **/*.test.ts) in src');
    });

    it('handles search with regex parameter', () => {
      const result = formatToolCallWithPath('search_files', {regex: '\\w+Service'}, workspaceRoot);
      expect(result.text).toContain('\\w+Service');
    });
  });

  describe('web operations', () => {
    it('formats web_search tool call', () => {
      const result = formatToolCallWithPath('web_search', {search_term: 'typescript generics'}, workspaceRoot);
      expect(result.text).toBe('Web search: typescript generics');
    });

    it('handles different web search parameter names', () => {
      expect(formatToolCallWithPath('web_search', {query: 'test'}, workspaceRoot).text).toBe('Web search: test');
      expect(formatToolCallWithPath('web_search', {q: 'test'}, workspaceRoot).text).toBe('Web search: test');
      expect(formatToolCallWithPath('web_search', {keywords: 'test'}, workspaceRoot).text).toBe('Web search: test');
    });

    it('formats web_fetch tool call', () => {
      const result = formatToolCallWithPath('web_fetch', {url: 'https://example.com/api'}, workspaceRoot);
      expect(result.text).toBe('Fetching: https://example.com/api');
    });
  });

  describe('misc operations', () => {
    it('formats todo_write tool call', () => {
      const result = formatToolCallWithPath('todo_write', {todos: []}, workspaceRoot);
      expect(result.text).toBe('Updating todo list');
    });

    it('formats update_memory tool call', () => {
      const result = formatToolCallWithPath('update_memory', {action: 'create'}, workspaceRoot);
      expect(result.text).toBe('Updating memory: create');
    });
  });

  describe('unknown tools', () => {
    it('formats unknown tool with arguments', () => {
      const result = formatToolCallWithPath('custom_tool', {first_arg: 'value1', second_arg: 'value2'}, workspaceRoot);
      expect(result.text).toBe('custom_tool: value1');
    });

    it('handles unknown tool without arguments', () => {
      const result = formatToolCallWithPath('unknown_tool', undefined, workspaceRoot);
      expect(result.text).toBe('unknown_tool');
    });

    it('handles undefined tool name', () => {
      const result = formatToolCallWithPath(undefined, {}, workspaceRoot);
      expect(result.text).toBe('unknown');
    });

    it('handles empty arguments object', () => {
      const result = formatToolCallWithPath('some_tool', {}, workspaceRoot);
      expect(result.text).toBe('some_tool');
    });
  });

  describe('case insensitivity', () => {
    it('handles uppercase tool names', () => {
      const result = formatToolCallWithPath('READ_FILE', {target_file: 'test.ts'}, workspaceRoot);
      expect(result.prefix).toBe('Reading: ');
    });

    it('handles mixed case tool names', () => {
      const result = formatToolCallWithPath('Write_File', {file_path: 'test.ts'}, workspaceRoot);
      expect(result.prefix).toBe('Writing: ');
    });
  });
});

