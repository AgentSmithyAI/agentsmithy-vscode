import {vi} from 'vitest';
import * as vscode from 'vscode';
import type {ChatWebviewProvider} from '../chatWebviewProvider';
import type {ApiService} from '../api/ApiService';

// Helper types
export type WebviewLike = {
  postMessage: (message: unknown) => Promise<boolean>;
  onDidReceiveMessage?: (cb: (msg: unknown) => void) => void;
  asWebviewUri?: (uri: any) => any;
  options?: any;
  html?: string;
};

export type DisposableLike = {dispose: () => void};

export type WebviewViewLike = {
  webview: WebviewLike;
  onDidChangeVisibility: (cb: () => void) => DisposableLike;
  onDidDispose: (cb: () => void) => void;
};

/**
 * Helper function to boot webview for testing
 */
export const bootWebview = (provider: ChatWebviewProvider) => {
  const postMessage = vi.fn(async () => true);
  const webview: WebviewLike = {
    postMessage,
    asWebviewUri: vi.fn((uri: any) => uri),
  };

  let handler: ((msg: unknown) => void) | undefined;
  webview.onDidReceiveMessage = (cb: (msg: unknown) => void) => {
    handler = cb;
  };

  (vscode.workspace as any).openTextDocument = vi.fn();

  const webviewView: WebviewViewLike = {
    webview,
    onDidChangeVisibility: () => ({dispose: vi.fn()}),
    onDidDispose: (cb: () => void) => cb(),
  };

  provider.resolveWebviewView(webviewView as unknown as any, {} as any, {} as any);
  return {postMessage, send: (msg: unknown) => handler?.(msg)};
};

/**
 * Helper to create mock session status
 */
export const mockSessionStatus = (api: ApiService, sessionId = 's1') => {
  return vi.spyOn(api, 'getSessionStatus').mockResolvedValue({
    active_session: sessionId,
    session_ref: 'ref1',
    has_unapproved: false,
    last_approved_at: null,
    changed_files: [],
  });
};

/**
 * Helper to mock workspace methods needed by ConfigService and other services
 */
export const mockWorkspaceMethods = () => {
  (vscode.workspace as any).onDidChangeConfiguration = vi.fn(() => ({dispose: vi.fn()}));
  (vscode.workspace as any).getConfiguration = vi.fn(() => ({
    get: vi.fn((key: string) => {
      if (key === 'serverUrl') return 'http://localhost:8000';
      return undefined;
    }),
  }));
  (vscode.workspace as any).createFileSystemWatcher = vi.fn(() => ({
    onDidChange: vi.fn(() => ({dispose: vi.fn()})),
    onDidCreate: vi.fn(() => ({dispose: vi.fn()})),
    onDidDelete: vi.fn(() => ({dispose: vi.fn()})),
    dispose: vi.fn(),
  }));
  (vscode.workspace as any).openTextDocument = vi.fn();
};

/**
 * Helper to wait for async operations
 */
export const waitForAsync = () => new Promise((resolve) => setTimeout(resolve, 10));
