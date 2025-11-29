/**
 * @vitest-environment jsdom
 */
import {describe, it, expect, beforeEach, vi} from 'vitest';
import {SessionActionsUI} from '../SessionActionsUI';
import type {VSCodeAPI} from '../types';

function setRect(el: Element, height: number) {
  (el as any).getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    width: 300,
    height,
    top: 0,
    right: 300,
    bottom: height,
    left: 0,
    toJSON() {},
  });
}

function setScrollHeight(el: Element, h: number) {
  Object.defineProperty(el, 'scrollHeight', {value: h, configurable: true});
}

describe('SessionActionsUI changes panel resize snap/hysteresis', () => {
  let ui: SessionActionsUI;
  let mockVscode: VSCodeAPI;
  let approveBtn: HTMLButtonElement;
  let resetBtn: HTMLButtonElement;
  let panelEl: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    (window as any).innerHeight = 1000; // generous viewport for tests

    // base skeleton required by SessionActionsUI
    const panel = document.createElement('div');
    panel.id = 'sessionActions';
    document.body.appendChild(panel);

    approveBtn = document.createElement('button');
    approveBtn.id = 'sessionApproveBtn';
    document.body.appendChild(approveBtn);

    resetBtn = document.createElement('button');
    resetBtn.id = 'sessionResetBtn';
    document.body.appendChild(resetBtn);

    const changes = document.createElement('div');
    changes.id = 'sessionChanges';
    document.body.appendChild(changes);

    mockVscode = {
      postMessage: vi.fn(),
      getState: vi.fn().mockReturnValue({}),
      setState: vi.fn(),
    };

    ui = new SessionActionsUI(mockVscode, '/workspace');

    // render panel with 2 items (default target uses header + body.scrollHeight)
    ui.updateSessionStatus(true, [
      {path: 'a', status: 'modified', additions: 1, deletions: 0, diff: null} as any,
      {path: 'b', status: 'modified', additions: 0, deletions: 1, diff: null} as any,
    ]);

    panelEl = document.getElementById('sessionChanges')!;

    const header = panelEl.querySelector('.session-changes-header') as HTMLElement;
    const body = panelEl.querySelector('.session-changes-body') as HTMLElement;
    const firstItem = panelEl.querySelector('.session-change-item') as HTMLElement;

    // mock geometry
    setRect(header, 20);
    setRect(firstItem, 24);
    setScrollHeight(body, 48); // 2 rows * 24

    // initial container height before drag
    setRect(panelEl, 200);
  });

  function getTopResizer(): HTMLElement {
    const r = document.querySelector('.session-changes-resizer.top') as HTMLElement | null;
    if (!r) throw new Error('resizer not found');
    return r;
  }

  function mousedownAt(y: number) {
    const e = new MouseEvent('mousedown', {clientY: y, bubbles: true});
    getTopResizer().dispatchEvent(e);
  }

  function mousemoveTo(y: number) {
    const e = new MouseEvent('mousemove', {clientY: y, bubbles: true});
    document.dispatchEvent(e);
  }

  function mouseup() {
    const e = new MouseEvent('mouseup', {bubbles: true});
    document.dispatchEvent(e);
  }

  it('snaps to default when within SNAP_PX and latches (no jitter)', () => {
    // Compute expected default: header(20) + body.scrollHeight(48) = 68
    const expectedDefault = 68;

    // Start drag from top at Y=300, startHeight mocked as 200
    mousedownAt(300);

    // Move to within 8px from default => should snap
    // origin=top => newH = startHeight - dy. We want applied near default 68.
    // Solve for clientY: newH = 200 - (y - 300) = 68 + 4 (within SNAP 8) => y = 200 - 72 + 300 = 428
    mousemoveTo(428); // delta 128 => newH ~72 -> within 4px of 68, should snap to 68

    // height should be exactly snapped to default
    expect(panelEl.style.height).toBe(`${expectedDefault}px`);
    expect((panelEl as any).dataset.snapped).toBe('1');

    // still moving inside hysteresis window should keep snapped
    mousemoveTo(420); // difference now 12px from 68 (< UNSNAP 16) => stays snapped
    expect(panelEl.style.height).toBe(`${expectedDefault}px`);
    expect((panelEl as any).dataset.snapped).toBe('1');
  });

  it('unsnaps only after exceeding UNSNAP_PX and persists explicit height', () => {
    const expectedDefault = 68;
    // maxAllowed = window.innerHeight (1000) * 0.4 = 400
    const expectedMaxAllowed = 400;

    mousedownAt(300);
    // Snap first
    mousemoveTo(428);
    expect(panelEl.style.height).toBe(`${expectedDefault}px`);

    // Now move far enough to unsnap: > 16px from default
    mousemoveTo(450); // move more down => newH <=> compute: 200 - (450 - 300) = 50 => 18px away -> unsnap

    // After unsnap, height becomes applied (rounded), not forced to default
    expect(parseInt(panelEl.style.height, 10)).toBe(50);
    expect((panelEl as any).dataset.snapped).toBeUndefined();

    // Release mouse -> should persist explicit height and set maxHeight to max allowed (not 'none')
    mouseup();

    expect(mockVscode.setState).toHaveBeenCalled();
    const stateArg = (mockVscode.setState as any).mock.calls.at(-1)[0];
    expect(stateArg.sessionChangesHeight).toBeGreaterThanOrEqual(50);
    expect(panelEl.style.maxHeight).toBe(`${expectedMaxAllowed}px`);
  });

  it('when released while snapped, clears persisted height and applies default maxHeight', () => {
    const expectedDefault = 68;

    // Pretend there was a previously saved override to ensure it is cleared
    (mockVscode.getState as any).mockReturnValue({sessionChangesHeight: 123});

    mousedownAt(300);
    mousemoveTo(428); // snap
    mouseup();

    // setState should be called with object without sessionChangesHeight
    expect(mockVscode.setState).toHaveBeenCalled();
    const last = (mockVscode.setState as any).mock.calls.at(-1)[0];
    expect('sessionChangesHeight' in last).toBe(false);

    // Visual sizing should be via maxHeight
    expect(panelEl.style.height).toBe('');
    expect(panelEl.style.maxHeight).toBe(`${expectedDefault}px`);
  });
});
