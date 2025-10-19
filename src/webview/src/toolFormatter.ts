import { stripProjectPrefix } from './utils';

interface ToolFormattedInfo {
  prefix?: string;
  path?: string;
  displayPath?: string;
  suffix?: string;
  url?: string;
  text: string;
}

export const formatToolCallWithPath = (
  toolName: string | undefined,
  args: Record<string, unknown> | undefined,
  workspaceRoot: string
): ToolFormattedInfo => {
  const name = toolName ? toolName.toLowerCase() : '';
  const a = args || {};

  const extractPath = (): string | null => {
    return (
      (a.path as string) ||
      (a.file as string) ||
      (a.target_file as string) ||
      (a.file_path as string) ||
      (a.target_notebook as string) ||
      ((a.paths as string[]) && (a.paths as string[])[0]) ||
      null
    );
  };

  const path = extractPath();
  const displayPath = path ? stripProjectPrefix(path, workspaceRoot) : null;

  switch (name) {
    case 'read_file':
      return {
        prefix: 'Reading: ',
        path: path || undefined,
        displayPath: displayPath || 'unknown',
        text: 'Reading: ' + (displayPath || 'unknown'),
      };

    case 'write_file':
    case 'write_to_file':
    case 'write':
      return {
        prefix: 'Writing: ',
        path: path || undefined,
        displayPath: displayPath || 'unknown',
        text: 'Writing: ' + (displayPath || 'unknown'),
      };

    case 'delete_file':
      return {
        prefix: 'Deleting: ',
        path: path || undefined,
        displayPath: displayPath || 'unknown',
        text: 'Deleting: ' + (displayPath || 'unknown'),
      };

    case 'create_file':
      return {
        prefix: 'Creating: ',
        path: path || undefined,
        displayPath: displayPath || 'unknown',
        text: 'Creating: ' + (displayPath || 'unknown'),
      };

    case 'replace_in_file':
    case 'edit':
    case 'str_replace':
    case 'search_replace':
      return {
        prefix: 'Editing: ',
        path: path || undefined,
        displayPath: displayPath || 'unknown',
        text: 'Editing: ' + (displayPath || 'unknown'),
      };

    case 'multiedit':
      return {
        prefix: 'Multi-edit: ',
        path: path || undefined,
        displayPath: displayPath || 'unknown',
        text: 'Multi-edit: ' + (displayPath || 'unknown'),
      };

    case 'edit_notebook':
      return {
        prefix: 'Editing notebook: ',
        path: path || undefined,
        displayPath: displayPath || 'unknown',
        text: 'Editing notebook: ' + (displayPath || 'unknown'),
      };

    case 'read_lints':
      if (a.paths && Array.isArray(a.paths) && a.paths.length > 0) {
        const firstPath = a.paths[0] as string;
        return {
          prefix: 'Reading linter errors for ',
          path: firstPath,
          displayPath: stripProjectPrefix(firstPath, workspaceRoot),
          suffix: a.paths.length > 1 ? ' and ' + (a.paths.length - 1) + ' more' : '',
          text: 'Reading linter errors for ' + (a.paths as string[]).map((p) => stripProjectPrefix(p, workspaceRoot)).join(', '),
        };
      }
      return {text: 'Reading linter errors'};

    case 'list_files':
    case 'list_dir':
      return {text: 'List: ' + ((a.path as string) || (a.directory as string) || (a.target_directory as string) || 'unknown')};

    case 'run_command':
    case 'run_terminal_cmd':
      return {text: 'Running: ' + ((a.command as string) || 'unknown')};

    case 'search':
    case 'grep_search':
    case 'grep':
    case 'codebase_search':
      return {text: 'Search: ' + ((a.query as string) || (a.pattern as string) || (a.regex as string) || 'unknown')};

    case 'search_files':
    case 'glob_file_search': {
      const query =
        (a.regex as string) || (a.pattern as string) || (a.query as string) || (a.glob_pattern as string) || 'unknown';
      const pathArg = (a.path as string) || (a.directory as string) || (a.target_directory as string);
      const filePattern = a.file_pattern as string;
      let result = 'Search: ' + query;
      if (filePattern) {
        result += ' (glob: ' + filePattern + ')';
      }
      if (pathArg) {
        result += ' in ' + pathArg;
      }
      return {text: result};
    }

    case 'todo_write':
      return {text: 'Updating todo list'};

    case 'web_search': {
      const q =
        (a.query as string) ||
        (a.search_term as string) ||
        (a.q as string) ||
        (a.keywords as string) ||
        (a.term as string) ||
        (a.text as string);
      return {text: 'Web search: ' + (q || 'unknown')};
    }

    case 'web_fetch':
    case 'fetch_url':
      return {text: 'Fetching: ' + ((a.url as string) || (a.uri as string) || 'unknown')};

    case 'update_memory':
      return {text: 'Updating memory: ' + ((a.action as string) || 'unknown')};

    default: {
      if (a && typeof a === 'object') {
        const keys = Object.keys(a);
        if (keys.length > 0) {
          const firstKey = keys[0];
          return {text: toolName + ': ' + String(a[firstKey])};
        }
      }
      return {text: toolName || 'unknown'};
    }
  }
};

