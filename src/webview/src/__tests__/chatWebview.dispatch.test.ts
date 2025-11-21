/**
 * @vitest-environment jsdom
 */
import {beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {WEBVIEW_IN_MSG, WEBVIEW_OUT_MSG} from '../../../shared/messages';
import {DOM_IDS} from '../../../constants';

let ChatWebview: typeof import('../index').ChatWebview;

beforeAll(async () => {
  (window as any).__AGENTSMITHY_TEST__ = true;
  ChatWebview = (await import('../index')).ChatWebview;
});

describe('ChatWebview message routing & controls', () => {
  const createSubject = () => {
    const subject = Object.create(ChatWebview.prototype) as ChatWebview & {
      vscode: {postMessage: ReturnType<typeof vi.fn>};
      messageHandler: {handle: ReturnType<typeof vi.fn>};
      dialogsUI: {
        updateDialogs: ReturnType<typeof vi.fn>;
        showLoading: ReturnType<typeof vi.fn>;
        showError: ReturnType<typeof vi.fn>;
      };
      sessionActionsUI: {updateSessionStatus: ReturnType<typeof vi.fn>};
      dialogViewManager: {
        getActiveView: ReturnType<typeof vi.fn>;
      };
      scrollManager: {requestFirstVisibleIdx: ReturnType<typeof vi.fn>};
    };

    subject.vscode = {postMessage: vi.fn()};
    subject.messageHandler = {handle: vi.fn()};
    subject.dialogsUI = {
      updateDialogs: vi.fn(),
      showLoading: vi.fn(),
      showError: vi.fn(),
    };
    subject.sessionActionsUI = {
      updateSessionStatus: vi.fn(),
    };
    subject.dialogViewManager = {
      getActiveView: vi.fn().mockReturnValue(null),
    };
    subject.scrollManager = {
      requestFirstVisibleIdx: vi.fn(),
    };

    return subject;
  };

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('wires settings button to OPEN_SETTINGS command', () => {
    const subject = createSubject();
    document.body.innerHTML = `<button id="${DOM_IDS.SETTINGS_BTN}">Settings</button>`;

    (subject as any).setupModelSelector();

    const btn = document.getElementById(DOM_IDS.SETTINGS_BTN);
    btn?.dispatchEvent(new Event('click'));

    expect(subject.vscode.postMessage).toHaveBeenCalledWith({type: WEBVIEW_IN_MSG.OPEN_SETTINGS});
  });

  it('routes SERVER_STATUS message through handleServerStatus', () => {
    const subject = createSubject();
    const spy = vi.spyOn(subject as any, 'handleServerStatus').mockImplementation(() => {});

    (subject as any).handleMessage({type: WEBVIEW_OUT_MSG.SERVER_STATUS, status: 'launching', message: 'Boot'});

    expect(spy).toHaveBeenCalledWith('launching', 'Boot');
  });

  it('requests dialogs reload when SHOW_TOOL_CALL set_dialog_title arrives', () => {
    const subject = createSubject();

    (subject as any).handleMessage({type: WEBVIEW_OUT_MSG.SHOW_TOOL_CALL, tool: 'set_dialog_title'} as any);

    expect(subject.vscode.postMessage).toHaveBeenCalledWith({type: WEBVIEW_IN_MSG.LOAD_DIALOGS});
    expect(subject.messageHandler.handle).toHaveBeenCalled();
  });

  it('requests visible idx from active view when available', () => {
    const subject = createSubject();
    const requestFromView = vi.fn();
    subject.dialogViewManager.getActiveView.mockReturnValue({
      getScrollManager: () => ({
        requestFirstVisibleIdx: requestFromView,
      }),
    });

    (subject as any).handleMessage({type: WEBVIEW_OUT_MSG.GET_VISIBLE_FIRST_IDX});

    expect(requestFromView).toHaveBeenCalled();
    expect(subject.scrollManager.requestFirstVisibleIdx).not.toHaveBeenCalled();
  });

  it('falls back to legacy scroll manager when no dialog view', () => {
    const subject = createSubject();

    (subject as any).handleMessage({type: WEBVIEW_OUT_MSG.GET_VISIBLE_FIRST_IDX});

    expect(subject.scrollManager.requestFirstVisibleIdx).toHaveBeenCalled();
  });

  it('forwards session status updates to SessionActionsUI', () => {
    const subject = createSubject();

    (subject as any).handleMessage({
      type: WEBVIEW_OUT_MSG.SESSION_STATUS_UPDATE,
      hasUnapproved: true,
      changedFiles: ['foo'],
    } as any);

    expect(subject.sessionActionsUI.updateSessionStatus).toHaveBeenCalledWith(true, ['foo']);
  });

  it('propagates dialog list updates', () => {
    const subject = createSubject();
    const payload = {dialogs: [{id: '1'}], currentDialogId: '1'};

    (subject as any).handleMessage({type: WEBVIEW_OUT_MSG.DIALOGS_UPDATE, ...payload} as any);

    expect(subject.dialogsUI.updateDialogs).toHaveBeenCalledWith(payload.dialogs, payload.currentDialogId);
  });

  it('propagates dialog errors and loading states', () => {
    const subject = createSubject();

    (subject as any).handleMessage({type: WEBVIEW_OUT_MSG.DIALOGS_LOADING});
    (subject as any).handleMessage({type: WEBVIEW_OUT_MSG.DIALOGS_ERROR, error: 'boom'});

    expect(subject.dialogsUI.showLoading).toHaveBeenCalled();
    expect(subject.dialogsUI.showError).toHaveBeenCalledWith('boom');
  });
});
