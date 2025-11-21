/**
 * @vitest-environment jsdom
 */
import {beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {WEBVIEW_IN_MSG} from '../../../shared/messages';

let ChatWebview: typeof import('../index').ChatWebview;

beforeAll(async () => {
  (window as any).__AGENTSMITHY_TEST__ = true;
  ChatWebview = (await import('../index')).ChatWebview;
});

describe('ChatWebview handleServerStatus', () => {
  const createSubject = () => {
    const instance = Object.create(ChatWebview.prototype) as ChatWebview & {
      serverStatusOverlay: HTMLElement | null;
      vscode: {postMessage: ReturnType<typeof vi.fn>};
    };
    instance.serverStatusOverlay = null;
    instance.vscode = {postMessage: vi.fn()};
    return instance;
  };

  beforeEach(() => {
    document.body.innerHTML = '<div class="chat-container"></div>';
  });

  it('shows launching overlay with message', () => {
    const subject = createSubject();
    (subject as any).handleServerStatus('launching', 'Loading...');

    const overlay = document.getElementById('serverStatusOverlay');
    expect(overlay).not.toBeNull();
    expect(overlay?.textContent).toContain('Loading...');
    expect(subject.vscode.postMessage).not.toHaveBeenCalled();
  });

  it('renders error overlay and wires settings button', () => {
    const subject = createSubject();
    (subject as any).handleServerStatus('error', 'Broken');

    const button = document.querySelector('[data-action="open-settings"]') as HTMLButtonElement;
    expect(button).not.toBeNull();
    button!.click();
    expect(subject.vscode.postMessage).toHaveBeenCalledWith({type: WEBVIEW_IN_MSG.OPEN_SETTINGS});
  });

  it('removes existing overlay when status becomes ready', () => {
    const subject = createSubject();
    (subject as any).handleServerStatus('launching', 'Loading...');
    expect(document.getElementById('serverStatusOverlay')).not.toBeNull();

    (subject as any).handleServerStatus('ready');
    expect(document.getElementById('serverStatusOverlay')).toBeNull();
  });
});
