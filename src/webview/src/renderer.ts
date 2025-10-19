import {formatToolCallWithPath} from './toolFormatter';
import {HistoryEvent, ReasoningBlock} from './types';
import {escapeHtml, formatDiff, linkifyUrls, stripProjectPrefix} from './utils';

declare const marked: {
  parse: (text: string, options?: {breaks?: boolean; gfm?: boolean}) => string;
  Renderer: new () => unknown;
  setOptions: (options: unknown) => void;
};

export class MessageRenderer {
  constructor(
    private messagesContainer: HTMLElement,
    private loadMoreBtn: HTMLElement | null,
    private welcomePlaceholder: HTMLElement | null,
    private workspaceRoot: string,
  ) {}

  private isPrepending = false;
  private suppressAutoScroll = false;

  setPrepending(value: boolean): void {
    this.isPrepending = value;
  }

  setSuppressAutoScroll(value: boolean): void {
    this.suppressAutoScroll = value;
  }

  private insertNode(node: HTMLElement): void {
    const anchor =
      this.loadMoreBtn && this.loadMoreBtn.parentNode === this.messagesContainer
        ? this.loadMoreBtn.nextSibling
        : this.messagesContainer.firstChild;
    if (this.isPrepending) {
      this.messagesContainer.insertBefore(node, anchor);
    } else {
      this.messagesContainer.appendChild(node);
      if (!this.suppressAutoScroll) {
        node.scrollIntoView({behavior: 'smooth', block: 'end'});
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

  addMessage(role: 'user' | 'assistant', content: string): HTMLElement {
    this.hideWelcome();

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message ' + (role === 'user' ? 'user-message' : 'assistant-message');
    if (content) {
      if (role === 'assistant') {
        messageDiv.innerHTML = this.renderMarkdown(content);
      } else {
        const escapedContent = escapeHtml(content);
        messageDiv.innerHTML = linkifyUrls(escapedContent);
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
      const isExpanded = content.style.display !== 'none';
      content.style.display = isExpanded ? 'none' : 'block';
      const toggle = header.querySelector('.reasoning-toggle');
      if (toggle) {
        toggle.textContent = isExpanded ? '▶' : '▼';
      }
    });

    reasoningDiv.appendChild(header);
    reasoningDiv.appendChild(content);
    this.insertNode(reasoningDiv);
    reasoningDiv.scrollIntoView({behavior: 'smooth', block: 'end'});

    return {block: reasoningDiv, content: content, header: header};
  }

  showError(error: string): void {
    this.hideWelcome();

    const errorDiv = document.createElement('div');
    errorDiv.className = 'error';
    errorDiv.textContent = '❌ Error: ' + error;
    this.messagesContainer.appendChild(errorDiv);
    errorDiv.scrollIntoView({behavior: 'smooth', block: 'end'});
  }

  showInfo(message: string): void {
    this.hideWelcome();

    const infoDiv = document.createElement('div');
    infoDiv.className = 'info';
    infoDiv.textContent = 'ℹ️ ' + message;
    this.messagesContainer.appendChild(infoDiv);
    infoDiv.scrollIntoView({behavior: 'smooth', block: 'end'});
  }

  renderHistoryEvent(evt: HistoryEvent): void {
    switch (evt.type) {
      case 'user':
        this.addMessage('user', evt && typeof evt.content !== 'undefined' ? evt.content : '');
        break;
      case 'chat':
        this.addMessage('assistant', evt && typeof evt.content !== 'undefined' ? evt.content : '');
        break;
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
    const toRemove: Node[] = [];
    for (const child of Array.from(this.messagesContainer.children)) {
      if (child !== this.loadMoreBtn) {
        toRemove.push(child);
      }
    }
    toRemove.forEach((n) => n.remove());
  }

  scrollToBottom(): void {
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }
}
