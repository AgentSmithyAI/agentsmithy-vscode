/**
 * Shared VSCode API mocks for testing
 */
import {vi} from 'vitest';

/**
 * Mock implementation of VSCode EventEmitter
 */
export class MockEventEmitter<T = void> {
  private listeners: Array<(e: T) => unknown> = [];

  event = (listener: (e: T) => unknown) => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        const index = this.listeners.indexOf(listener);
        if (index > -1) {
          this.listeners.splice(index, 1);
        }
      },
    };
  };

  fire(data: T extends void ? never : T = undefined as never) {
    for (const listener of this.listeners) {
      listener(data as T);
    }
  }

  dispose() {
    this.listeners = [];
  }
}

/**
 * Create a complete vscode module mock
 */
export const createVSCodeMock = () => ({
  EventEmitter: MockEventEmitter,
  ViewColumn: {
    One: 1,
    Two: 2,
    Three: 3,
  },
  Uri: {
    parse: (value: string) => ({
      scheme: 'file',
      path: value,
      toString: () => value,
    }),
    file: (path: string) => ({
      scheme: 'file',
      path,
      fsPath: path,
      toString: () => path,
    }),
    joinPath: (base: any, ...pathSegments: string[]) => ({
      scheme: base.scheme || 'file',
      path: [base.path, ...pathSegments].join('/'),
      fsPath: [base.path, ...pathSegments].join('/'),
      toString: () => [base.path, ...pathSegments].join('/'),
    }),
  },
  commands: {
    executeCommand: vi.fn(),
    registerCommand: vi.fn(),
  },
  window: {
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showInputBox: vi.fn(),
    showQuickPick: vi.fn(),
    onDidChangeActiveTextEditor: vi.fn(() => ({dispose: vi.fn()})),
    createOutputChannel: vi.fn(() => ({
      append: vi.fn(),
      appendLine: vi.fn(),
      clear: vi.fn(),
      show: vi.fn(),
      dispose: vi.fn(),
    })),
    createWebviewPanel: vi.fn(() => ({
      webview: {
        html: '',
        postMessage: vi.fn(),
        onDidReceiveMessage: vi.fn(),
      },
      reveal: vi.fn(),
      onDidDispose: vi.fn(),
      dispose: vi.fn(),
    })),
    // Will be set by tests when needed
    activeTextEditor: undefined as any,
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn(),
      update: vi.fn(),
      has: vi.fn(),
      inspect: vi.fn(),
    })),
    onDidChangeConfiguration: vi.fn(() => ({dispose: vi.fn()})),
    createFileSystemWatcher: vi.fn(() => ({
      onDidChange: vi.fn(() => ({dispose: vi.fn()})),
      onDidCreate: vi.fn(() => ({dispose: vi.fn()})),
      onDidDelete: vi.fn(() => ({dispose: vi.fn()})),
      dispose: vi.fn(),
    })),
    // Optional helpers used by some extension paths; safe defaults
    openTextDocument: vi.fn(),
  },
});

/**
 * Type-safe mock function creator with better intellisense
 */
export const mockFn = <T extends (...args: any[]) => any>(): vi.MockedFunction<T> => {
  return vi.fn() as vi.MockedFunction<T>;
};

/**
 * Create a typed mock for ApiService or other interfaces
 */
export const createMock = <T extends Record<string, any>>(
  overrides: Partial<{[K in keyof T]: T[K] extends (...args: any[]) => any ? ReturnType<typeof mockFn> : T[K]}> = {},
): T => {
  return overrides as T;
};
