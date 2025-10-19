import * as vscode from 'vscode';
import {ApiService} from './api/ApiService';
import {ChatWebviewProvider} from './chatWebviewProvider';
import {registerCommands} from './commands';
import {COMMANDS, ERROR_MESSAGES, STATE_KEYS, VIEWS, WELCOME_MESSAGE} from './constants';
import {ConfigService} from './services/ConfigService';
import {HistoryService} from './services/HistoryService';
import {StreamService} from './api/StreamService';

export const activate = (context: vscode.ExtensionContext) => {
  // Create services
  const configService = new ConfigService();
  const serverUrl = configService.getServerUrl();

  const apiService = new ApiService(serverUrl);
  const normalizer = (raw: unknown) => {
    if (raw === null || typeof raw !== 'object') {
      return null;
    }
    const obj = raw as Record<string, unknown>;
    const get = (k: string): unknown => obj[k];
    const type = typeof get('type') === 'string' ? (get('type') as string) : undefined;

    // Normalize patch/diff/file_edit
    if (type === 'patch' || type === 'diff' || type === 'file_edit') {
      const fileVal = get('file') ?? get('path') ?? get('file_path');
      const diffVal = get('diff') ?? get('patch');
      const checkpointVal = get('checkpoint');
      return {
        type: 'file_edit',
        file: typeof fileVal === 'string' ? fileVal : undefined,
        diff: typeof diffVal === 'string' ? diffVal : undefined,
        checkpoint: typeof checkpointVal === 'string' ? checkpointVal : undefined,
      } as const;
    }

    switch (type) {
      case 'chat_start':
        return {type: 'chat_start'} as const;
      case 'chat': {
        const c = get('content');
        return {type: 'chat', content: typeof c === 'string' ? c : ''} as const;
      }
      case 'chat_end':
        return {type: 'chat_end'} as const;
      case 'reasoning_start':
        return {type: 'reasoning_start'} as const;
      case 'reasoning': {
        const c = get('content');
        return {type: 'reasoning', content: typeof c === 'string' ? c : ''} as const;
      }
      case 'reasoning_end':
        return {type: 'reasoning_end'} as const;
      case 'tool_call': {
        const name = get('name');
        const args = get('args');
        return {
          type: 'tool_call',
          name: typeof name === 'string' ? name : '',
          args: args,
        } as const;
      }
      case 'error': {
        const errVal = get('error');
        const msgVal = get('message');
        const err = typeof errVal === 'string' ? errVal : typeof msgVal === 'string' ? msgVal : 'Unknown error';
        return {type: 'error', error: err} as const;
      }
      case 'done': {
        const did = get('dialog_id');
        const dialog_id = typeof did === 'string' ? did : undefined;
        return {type: 'done', dialog_id} as const;
      }
      default: {
        const c = get('content');
        const content = typeof c === 'string' ? c : undefined;
        if (content && !type) {
          return {type: 'chat', content} as const;
        }
        return null;
      }
    }
  };
  const streamService = new StreamService(serverUrl, normalizer);
  const historyService = new HistoryService(apiService);

  // Note: When server URL changes, we recreate service instances,
  // but existing providers will continue using old instances.
  // This is acceptable as config changes are rare.

  // Register the webview provider
  const provider = new ChatWebviewProvider(context.extensionUri, streamService, historyService, configService);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEWS.CHAT, provider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
  );

  // Register commands using Command Pattern
  registerCommands(context, provider);

  // Show a welcome message
  const hasShownWelcome = Boolean(context.globalState.get(STATE_KEYS.WELCOME_SHOWN, false));

  if (hasShownWelcome === false) {
    void vscode.window.showInformationMessage(WELCOME_MESSAGE, ERROR_MESSAGES.OPEN_CHAT).then((selection) => {
      if (selection === ERROR_MESSAGES.OPEN_CHAT) {
        void vscode.commands.executeCommand(COMMANDS.OPEN_CHAT);
      }
    });

    void context.globalState.update(STATE_KEYS.WELCOME_SHOWN, true);
  }
};

// VSCode does not require a deactivate export; intentionally omitted.
