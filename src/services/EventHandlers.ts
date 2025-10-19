import * as vscode from 'vscode';
import type {SSEEvent} from '../api/StreamService';
import {ERROR_MESSAGES, SSE_EVENT_TYPES as E} from '../constants';

export type PostMessage = (msg: unknown) => void;

/**
 * Handles different types of SSE events from the chat stream
 */
export class StreamEventHandlers {
  private chatBuffer = '';
  private readonly openedFiles = new Set<string>();

  constructor(private readonly postMessage: PostMessage) {}

  async handleEvent(event: SSEEvent): Promise<void> {
    switch (event.type) {
      case E.CHAT_START:
        this.handleChatStart();
        break;
      case E.CHAT:
        this.handleChat(event);
        break;
      case E.CHAT_END:
        this.handleChatEnd();
        break;
      case E.REASONING_START:
        this.handleReasoningStart();
        break;
      case E.REASONING:
        this.handleReasoning(event);
        break;
      case E.REASONING_END:
        this.handleReasoningEnd();
        break;
      case E.TOOL_CALL:
        this.handleToolCall(event);
        break;
      case E.FILE_EDIT:
        await this.handleFileEdit(event);
        break;
      case E.ERROR:
        this.handleError(event);
        break;
      case E.DONE:
        // Handled by caller
        break;
    }
  }

  private handleChatStart(): void {
    this.chatBuffer = '';
    this.postMessage({type: 'startAssistantMessage'});
  }

  private handleChat(event: SSEEvent): void {
    if (event.content !== undefined) {
      this.chatBuffer += event.content;
      this.postMessage({
        type: 'appendToAssistant',
        content: String(event.content),
      });
    }
  }

  private handleChatEnd(): void {
    this.postMessage({type: 'endAssistantMessage'});
  }

  private handleReasoningStart(): void {
    this.postMessage({type: 'startReasoning'});
  }

  private handleReasoning(event: SSEEvent): void {
    if (event.content) {
      this.postMessage({
        type: 'appendToReasoning',
        content: String(event.content),
      });
    }
  }

  private handleReasoningEnd(): void {
    this.postMessage({type: 'endReasoning'});
  }

  private handleToolCall(event: SSEEvent): void {
    this.postMessage({
      type: 'showToolCall',
      tool: event.name,
      args: event.args,
    });
  }

  private async handleFileEdit(event: SSEEvent): Promise<void> {
    if (typeof event.file === 'string') {
      this.postMessage({
        type: 'showFileEdit',
        file: event.file,
        diff: typeof event.diff === 'string' ? event.diff : undefined,
      });

      // Auto-open edited file
      if (!this.openedFiles.has(event.file)) {
        this.openedFiles.add(event.file);
        try {
          const uri = vscode.Uri.file(String(event.file));
          const doc = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(doc, {preview: false});
        } catch {
          // noop
        }
      }
    }
  }

  private handleError(event: SSEEvent): void {
    this.postMessage({
      type: 'showError',
      error: String(event.error ?? 'Unknown error'),
    });
  }

  handleNoResponse(): void {
    this.postMessage({
      type: 'showError',
      error: ERROR_MESSAGES.NO_RESPONSE,
    });
    this.postMessage({
      type: 'endAssistantMessage',
    });
  }

  handleAbort(): void {
    this.postMessage({
      type: 'showInfo',
      message: ERROR_MESSAGES.REQUEST_CANCELLED,
    });
  }

  handleConnectionError(error: Error): void {
    this.postMessage({
      type: 'showError',
      error: String(error.message),
    });
    this.postMessage({
      type: 'endAssistantMessage',
    });
  }

  finalize(): void {
    this.postMessage({
      type: 'endStream',
    });
  }

  reset(): void {
    this.chatBuffer = '';
    this.openedFiles.clear();
  }
}
