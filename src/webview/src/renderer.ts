import {formatToolCallWithPath} from './toolFormatter';
import {HistoryEvent, ReasoningBlock} from './types';
import {escapeHtml, formatDiff, linkifyUrls, stripProjectPrefix} from './utils';

declare const marked: {
  parse: (text: string, options?: {breaks?: boolean; gfm?: boolean}) => string;
  Renderer: new () => unknown;
  setOptions: (options: unknown) => void;
};

export class MessageRenderer {
  private scrollManager?: {isAtBottom: () => boolean};

  constructor(
    private messagesContainer: HTMLElement,
    private loadMoreBtn: HTMLElement | null,
    private welcomePlaceholder: HTMLElement | null,
    private workspaceRoot: string,
  ) {}

  private isPrepending = false;
  private suppressAutoScroll = false;

  setScrollManager(scrollManager: {isAtBottom: () => boolean}): void {
    this.scrollManager = scrollManager;
  }

  setPrepending(value: boolean): void {
    this.isPrepending = value;
  }

  setSuppressAutoScroll(value: boolean): void {
    this.suppressAutoScroll = value;
  }

  // Remove oldest DOM nodes so that only the last `maxIdxCount` index-bearing
  // messages (user/chat with data-idx) remain. Removes associated non-indexed
  // blocks preceding the next indexed message as well.
  pruneByIdx(maxIdxCount: number): void {
    if (!maxIdxCount || maxIdxCount <= 0) return;
    // Count index-bearing elements
    let idxCount = 0;
    for (const child of Array.from(this.messagesContainer.children)) {
      if (child === this.loadMoreBtn) continue;
      if (child instanceof HTMLElement && child.dataset && child.dataset.idx) {
        idxCount++;
      }
    }
    if (idxCount <= maxIdxCount) return;

    // Remove from the top until idxCount <= maxIdxCount
    const toRemove: Element[] = [];
    let needToRemove = idxCount - maxIdxCount;
    for (const child of Array.from(this.messagesContainer.children)) {
      if (child === this.loadMoreBtn) continue;
      toRemove.push(child);
      if (child instanceof HTMLElement && child.dataset && child.dataset.idx) {
        needToRemove--;
        if (needToRemove <= 0) break;
      }
    }
    for (const el of toRemove) {
      el.remove();
    }
  }

  private scrollIntoViewIfBottom(node: HTMLElement): void {
    if (!this.suppressAutoScroll && this.scrollManager?.isAtBottom()) {
      // Use double rAF to ensure DOM updates are complete, properly handling ::after spacer
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
        });
      });
    }
  }

  private insertNode(node: HTMLElement): void {
    // Take a snapshot of bottom state BEFORE DOM mutations to avoid losing closeness due to height growth
    const shouldAutoScroll = !this.suppressAutoScroll && (this.scrollManager?.isAtBottom() ?? false);

    const anchor =
      this.loadMoreBtn && this.loadMoreBtn.parentNode === this.messagesContainer
        ? this.loadMoreBtn.nextSibling
        : this.messagesContainer.firstChild;
    if (this.isPrepending) {
      this.messagesContainer.insertBefore(node, anchor);
    } else {
      this.messagesContainer.appendChild(node);
      if (shouldAutoScroll) {
        // Use double rAF to ensure DOM updates are complete
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
          });
        });
      }
    }
  }

  private hideWelcome(): void {
    if (this.welcomePlaceholder) {
      this.welcomePlaceholder.style.display = 'none';
    }
  }

  renderMarkdown(text: string): string {
    const t = text === undefined || text === null ? '' : String(text);
    if (typeof marked !== 'undefined') {
      return marked.parse(t, {breaks: true, gfm: true});
    }
    return escapeHtml(t).replace(/\n/g, '<br>');
  }

  addMessage(role: 'user' | 'assistant', content: string, checkpoint?: string): HTMLElement {
    this.hideWelcome();

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message ' + (role === 'user' ? 'user-message' : 'assistant-message');

    if (content) {
      if (role === 'assistant') {
        messageDiv.innerHTML = this.renderMarkdown(content);
      } else {
        const textDiv = document.createElement('div');
        textDiv.className = 'user-message-text';
        textDiv.innerHTML = linkifyUrls(escapeHtml(content));
        messageDiv.appendChild(textDiv);

        // Add restore checkpoint button for user messages if checkpoint is present
        if (checkpoint) {
          const restoreBtn = document.createElement('button');
          restoreBtn.className = 'restore-checkpoint-btn';
          restoreBtn.setAttribute('data-checkpoint', checkpoint);
          restoreBtn.title = 'Restore to this state';
          restoreBtn.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
            <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
          </svg>`;
          messageDiv.appendChild(restoreBtn);
        }
      }
    }
    this.insertNode(messageDiv);
    return messageDiv;
  }

  addToolCall(toolName: string | undefined, args: unknown): void {
    this.hideWelcome();

    const toolDiv = document.createElement('div');
    toolDiv.className = 'tool-call';

    const formattedInfo = formatToolCallWithPath(toolName, args as Record<string, unknown>, this.workspaceRoot);

    if (formattedInfo.path && formattedInfo.path !== 'unknown') {
      toolDiv.innerHTML =
        '• ' +
        formattedInfo.prefix +
        '<a class="file-link" data-file="' +
        encodeURIComponent(formattedInfo.path) +
        '">' +
        escapeHtml(formattedInfo.displayPath || '') +
        '</a>' +
        (formattedInfo.suffix || '');
    } else if (formattedInfo.url && formattedInfo.url !== 'unknown') {
      toolDiv.innerHTML =
        '• ' +
        formattedInfo.prefix +
        '<a href="' +
        escapeHtml(formattedInfo.url) +
        '" target="_blank" rel="noopener noreferrer">' +
        escapeHtml(formattedInfo.url) +
        '</a>';
    } else {
      const escapedText = escapeHtml(formattedInfo.text);
      toolDiv.innerHTML = '• ' + linkifyUrls(escapedText);
    }

    this.insertNode(toolDiv);
  }

  addFileEdit(file: string, diff?: string): void {
    this.hideWelcome();

    const editDiv = document.createElement('div');
    editDiv.className = 'file-edit';

    const header = document.createElement('div');
    header.className = 'file-header';
    const pathLink = document.createElement('a');
    pathLink.className = 'file-link';
    pathLink.setAttribute('data-file', encodeURIComponent(file));
    pathLink.textContent = stripProjectPrefix(file, this.workspaceRoot) || file;
    header.appendChild(pathLink);

    const openLink = document.createElement('a');
    openLink.className = 'file-link';
    openLink.setAttribute('data-file', encodeURIComponent(file));
    openLink.textContent = 'Open';
    openLink.style.marginLeft = '8px';
    header.appendChild(openLink);

    editDiv.appendChild(header);

    if (diff) {
      const formatted = formatDiff(diff);
      editDiv.innerHTML +=
        '<details class="diff-block"><summary>Show diff</summary>' +
        '<div class="diff"><pre>' +
        formatted +
        '</pre></div>' +
        '</details>';
    }
    this.insertNode(editDiv);
  }

  createReasoningBlock(): ReasoningBlock {
    this.hideWelcome();

    const reasoningDiv = document.createElement('div');
    reasoningDiv.className = 'reasoning-block';

    const header = document.createElement('div');
    header.className = 'reasoning-header';
    header.innerHTML = '<span class="reasoning-toggle">▼</span> Thinking...';
    header.style.cursor = 'pointer';

    const content = document.createElement('div');
    content.className = 'reasoning-content';
    content.style.display = 'block';
    content.textContent = ' ';

    header.addEventListener('click', () => {
      const wasExpanded = content.style.display !== 'none';
      content.style.display = wasExpanded ? 'none' : 'block';
      const toggle = header.querySelector('.reasoning-toggle');
      if (toggle) {
        toggle.textContent = wasExpanded ? '▶' : '▼';
      }
      // If collapsing while user is near bottom, snapping prevents drift upward
      if (wasExpanded && this.scrollManager && typeof this.scrollManager.isAtBottom === 'function') {
        // We can't call scrollManager.scrollToBottom directly; request via content shrink hook
        const sm: any = this.scrollManager as any;
        if (typeof sm.handleContentShrink === 'function') {
          sm.handleContentShrink();
        }
      }
    });

    reasoningDiv.appendChild(header);
    reasoningDiv.appendChild(content);
    this.insertNode(reasoningDiv);

    return {block: reasoningDiv, content: content, header: header};
  }

  showError(error: string): void {
    this.hideWelcome();

    const errorDiv = document.createElement('div');
    errorDiv.className = 'error';
    errorDiv.textContent = '❌ Error: ' + error;
    this.messagesContainer.appendChild(errorDiv);
    this.scrollIntoViewIfBottom(errorDiv);
  }

  showInfo(message: string): void {
    this.hideWelcome();

    const infoDiv = document.createElement('div');
    infoDiv.className = 'info';
    infoDiv.textContent = 'ℹ️ ' + message;
    this.messagesContainer.appendChild(infoDiv);
    this.scrollIntoViewIfBottom(infoDiv);
  }

  renderHistoryEvent(evt: HistoryEvent): void {
    switch (evt.type) {
      case 'user': {
        const el = this.addMessage(
          'user',
          evt && typeof evt.content !== 'undefined' ? evt.content : '',
          evt && typeof evt.checkpoint === 'string' ? evt.checkpoint : undefined,
        );
        if (el && evt && typeof evt.idx === 'number') {
          (el as HTMLElement).dataset.idx = String(evt.idx);
        }
        break;
      }
      case 'chat': {
        const el = this.addMessage('assistant', evt && typeof evt.content !== 'undefined' ? evt.content : '');
        if (el && evt && typeof evt.idx === 'number') {
          (el as HTMLElement).dataset.idx = String(evt.idx);
        }
        break;
      }
      case 'reasoning': {
        const rb = this.createReasoningBlock();
        rb.content.innerHTML = this.renderMarkdown(evt && typeof evt.content !== 'undefined' ? evt.content : '');
        rb.content.style.display = 'none';
        const toggle = rb.header.querySelector('.reasoning-toggle');
        if (toggle) {
          toggle.textContent = '▶';
        }
        break;
      }
      case 'tool_call':
        this.addToolCall(evt ? evt.name : undefined, evt ? evt.args : undefined);
        break;
      case 'file_edit':
        this.addFileEdit(evt ? (evt.file as string) : '', evt ? evt.diff : undefined);
        break;
    }
  }

  clearMessages(): void {
    const toRemove: Element[] = [];
    for (const child of Array.from(this.messagesContainer.children)) {
      if (child !== this.loadMoreBtn) {
        toRemove.push(child);
      }
    }
    toRemove.forEach((n) => n.remove());
  }

  scrollToBottom(): void {
    // Use double rAF to ensure all DOM updates are complete
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
      });
    });
  }
}
