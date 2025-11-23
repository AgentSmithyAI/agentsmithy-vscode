/**
 * @vitest-environment jsdom
 */
import {beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {WEBVIEW_IN_MSG, WEBVIEW_OUT_MSG} from '../../../shared/messages';
import {DOM_IDS, CSS_CLASSES} from '../../../constants';

let ChatWebview: typeof import('../index').ChatWebview;

beforeAll(async () => {
  (window as any).__AGENTSMITHY_TEST__ = true;
  ChatWebview = (await import('../index')).ChatWebview;
});

describe('ChatWebview - Workload Selection', () => {
  const createSubject = () => {
    // Partial mock of ChatWebview
    const subject = Object.create(ChatWebview.prototype) as ChatWebview & {
      vscode: {postMessage: ReturnType<typeof vi.fn>};
      messageHandler: {handle: ReturnType<typeof vi.fn>};
    };

    subject.vscode = {postMessage: vi.fn()};
    subject.messageHandler = {handle: vi.fn()};

    return subject;
  };

  beforeEach(() => {
    document.body.innerHTML = `
      <div class="model-selector">
          <button class="model-selector-btn" id="${DOM_IDS.MODEL_SELECTOR_BTN}">
              <span class="model-selector-text" id="${DOM_IDS.MODEL_SELECTOR_TEXT}">GPT-4</span>
          </button>
          <div class="model-dropdown hidden" id="${DOM_IDS.MODEL_DROPDOWN}" style="display: none;"></div>
      </div>
    `;
  });

  it('toggles dropdown on button click', () => {
    const subject = createSubject();
    (subject as any).setupModelSelector();

    const btn = document.getElementById(DOM_IDS.MODEL_SELECTOR_BTN)!;
    const dropdown = document.getElementById(DOM_IDS.MODEL_DROPDOWN)!;

    // Click to open
    btn.click();
    expect(dropdown.style.display).toBe('block');

    // Click to close
    btn.click();
    expect(dropdown.style.display).toBe('none');
  });

  it('selects model from dropdown and sends message', () => {
    const subject = createSubject();
    (subject as any).setupModelSelector();

    const dropdown = document.getElementById(DOM_IDS.MODEL_DROPDOWN)!;
    // Simulate populated dropdown
    dropdown.innerHTML = `
      <div class="${CSS_CLASSES.MODEL_ITEM}" data-model="gpt-5">
        <span class="${CSS_CLASSES.MODEL_NAME}">GPT-5 Preview</span>
      </div>
    `;

    // Open dropdown first
    const btn = document.getElementById(DOM_IDS.MODEL_SELECTOR_BTN)!;
    btn.click();

    const item = dropdown.querySelector('.' + CSS_CLASSES.MODEL_ITEM) as HTMLElement;
    item.click();

    expect(subject.vscode.postMessage).toHaveBeenCalledWith({
      type: WEBVIEW_IN_MSG.SELECT_WORKLOAD,
      workload: 'gpt-5',
    });

    // Updates UI text immediately
    const text = document.getElementById(DOM_IDS.MODEL_SELECTOR_TEXT);
    expect(text?.textContent).toBe('GPT-5 Preview');

    // Closes dropdown
    expect(dropdown.style.display).toBe('none');
  });

  it('updates workloads list from server message', () => {
    const subject = createSubject();
    // We need to bind updateWorkloads to the subject or call it directly via handleMessage
    // handleMessage calls updateWorkloads internally

    const workloads = [
      {name: 'gpt-4', displayName: 'GPT-4'},
      {name: 'gpt-5', displayName: 'GPT-5'},
    ];

    (subject as any).handleMessage({
      type: WEBVIEW_OUT_MSG.WORKLOADS_UPDATE,
      workloads,
      selected: 'gpt-5',
    });

    const dropdown = document.getElementById(DOM_IDS.MODEL_DROPDOWN)!;
    const items = dropdown.querySelectorAll('.' + CSS_CLASSES.MODEL_ITEM);
    expect(items.length).toBe(2);

    const secondItem = items[1];
    expect(secondItem.classList.contains('active')).toBe(true);
    expect(secondItem.getAttribute('data-model')).toBe('gpt-5');

    const text = document.getElementById(DOM_IDS.MODEL_SELECTOR_TEXT);
    expect(text?.textContent).toBe('GPT-5');
  });

  it('closes dropdown when clicking outside', () => {
    const subject = createSubject();
    (subject as any).setupModelSelector();

    const btn = document.getElementById(DOM_IDS.MODEL_SELECTOR_BTN)!;
    const dropdown = document.getElementById(DOM_IDS.MODEL_DROPDOWN)!;

    // Open
    btn.click();
    expect(dropdown.style.display).toBe('block');

    // Click outside
    document.body.click();
    expect(dropdown.style.display).toBe('none');
  });
});
