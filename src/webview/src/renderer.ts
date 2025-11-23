import {formatToolCallWithPath} from './toolFormatter';
import {HistoryEvent, ReasoningBlock} from './types';
import {escapeHtml, formatDiff, linkifyUrls, stripProjectPrefix} from './utils';
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';

const COPY_ICON = `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M4 4l1-1h5.414L14 6.586V14l-1 1H5l-1-1V4zm9 3l-3-3H5v10h8V7z"/><path d="M3 1L2 2v10l1 1V2h6.414l-1-1H3z"/></svg>`;
const CHECK_ICON = `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/></svg>`;

export interface ScrollManagerLike {
  isAtBottom: () => boolean;
  handleContentShrink?: () => void;
}

export class MessageRenderer {
  private scrollManager?: ScrollManagerLike;
  private md = new MarkdownIt({
    breaks: true,
    linkify: true,
    html: false,
    highlight: function (str, lang) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(str, {language: lang}).value;
        } catch (__) {}
      }

      return ''; // use external default escaping
    },
  });

  constructor(
    private messagesContainer: HTMLElement,
    private welcomePlaceholder: HTMLElement | null,
    private workspaceRoot: string,
  ) {
    // Override fence rule to add language label
    this.md.renderer.rules.fence = (tokens, idx, options, _env, _self) => {
      const token = tokens[idx];
      const info = token.info ? token.info.trim() : '';
      let langName = '';
      let highlighted = '';

      if (info) {
        langName = info.split(/\s+/)[0];
      }

      if (options.highlight) {
        highlighted = options.highlight(token.content, langName, '') || escapeHtml(token.content);
      } else {
        highlighted = escapeHtml(token.content);
      }

      // If language is present, wrap in a container with a header
      const langDisplay = langName || '';
      return `<div class="code-block-wrapper">
             <div class="code-block-header">
               <span class="code-language">${escapeHtml(langDisplay)}</span>
               <button class="copy-code-btn" title="Copy code">
                  ${COPY_ICON}
               </button>
             </div>
             <pre><code class="hljs ${langName ? 'language-' + escapeHtml(langName) : ''}">${highlighted}</code></pre>
           </div>`;
    };

    this.messagesContainer.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const button = target.closest('.copy-code-btn');
      if (button) {
        e.stopPropagation();
        void this.copyCodeToClipboard(button as HTMLElement);
      }
    });
  }

  private async copyCodeToClipboard(button: HTMLElement): Promise<void> {
    const wrapper = button.closest('.code-block-wrapper');
    if (!wrapper) {
      return;
    }

    const codeElement = wrapper.querySelector('code');
    if (!codeElement) {
      return;
    }

    const text = codeElement.textContent || '';

    try {
      await navigator.clipboard.writeText(text);

      // Feedback
      button.innerHTML = CHECK_ICON;
      button.classList.add('copied');

      setTimeout(() => {
        button.innerHTML = COPY_ICON;
        button.classList.remove('copied');
      }, 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }

  private isPrepending = false;
  private suppressAutoScroll = false;

  setScrollManager(scrollManager: ScrollManagerLike): void {
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
      if (child instanceof HTMLElement && child.dataset && child.dataset.idx) {
        idxCount++;
      }
    }
    if (idxCount <= maxIdxCount) return;

    // Remove from the top until idxCount <= maxIdxCount
    const toRemove: Element[] = [];
    let needToRemove = idxCount - maxIdxCount;
    for (const child of Array.from(this.messagesContainer.children)) {
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

    if (this.isPrepending) {
      this.messagesContainer.insertBefore(node, this.messagesContainer.firstChild);
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
    const t = text ?? '';
    return this.md.render(t);
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
        textDiv.innerHTML = this.renderMarkdown(content);
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
        this.scrollManager?.handleContentShrink?.();
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
      toRemove.push(child);
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
