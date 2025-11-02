# Scroll, History Loading, and Memory Management

## Overview

This document describes how chat history is loaded, unloaded, and how scroll behavior (auto-scroll, infinite scroll) works in the AgentSmithy VSCode extension.

## Key Components

- **`ScrollManager`** (`src/webview/src/ScrollManager.ts`) — manages scroll detection, triggers history loading, handles DOM pruning
- **`HistoryService`** (`src/services/HistoryService.ts`) — manages pagination cursors, tracks exhausted boundaries
- **`MessageRenderer`** (`src/webview/src/renderer.ts`) — renders messages, provides `pruneByIdx()` for DOM cleanup
- **`ChatWebviewProvider`** (`src/chatWebviewProvider.ts`) — coordinates between webview and API

---

## 1. History Loading (Infinite Scroll Up)

### How It Works

When user scrolls near the top of the chat, older history is automatically loaded and prepended to the DOM.

### Flow

1. **User scrolls up** → `ScrollManager` detects `scrollTop <= TOP_TRIGGER_THRESHOLD (100px)`
2. **Trigger armed?** → Check `topTriggerArmed` flag (prevents repeated requests)
3. **Send request** → Webview posts `LOAD_MORE_HISTORY` message to extension
4. **Extension loads** → `HistoryService.loadPrevious(dialogId)` calls API with `before=<cursor>`
5. **API response** → Server returns events and `has_more` flag
6. **Prepend to DOM** → Extension sends `HISTORY_PREPEND_EVENTS`, webview inserts at top
7. **Adjust scroll** → `scrollTop` is adjusted to maintain visual position: `scrollTop += (newHeight - oldHeight)`
8. **Finish** → `ScrollManager.finishHistoryLoad()` resets `isLoadingHistory`, disarms trigger

### Cursor Tracking

- **`_historyCursor`** — the `before` parameter for next `loadPrevious()` request
- After each successful load, cursor is updated to `resp.first_idx` from server
- This ensures we always request the next older page

### Arming/Disarming Trigger

- **Armed** — trigger can fire when scrolling up near top
- **Disarmed** — prevents immediate re-trigger after history load
- **Re-arm conditions:**
  - User scrolls down past `REARM_THRESHOLD (300px)` from top
  - Pruning happens (see below)

---

## 2. DOM Pruning (Memory Management)

### Why Prune?

To avoid infinite memory growth, we keep only the most recent `MAX_MESSAGES_IN_DOM (20)` indexed messages in the DOM. Older messages are removed when user scrolls down.

### When Pruning Happens

- **Trigger:** User scrolls near bottom (`scrollHeight - scrollTop - clientHeight <= BOTTOM_PRUNE_THRESHOLD (200px)`)
- **What's removed:** Oldest messages from the top of DOM until only `MAX_MESSAGES_IN_DOM` indexed messages remain

### Pruning Flow

1. **Detect near bottom** → `isNearBottomForPrune()` returns true
2. **Prune** → `renderer.pruneByIdx(MAX_MESSAGES_IN_DOM)` removes oldest elements
3. **Get new first index** → After DOM updates (via `requestAnimationFrame`), get first remaining `data-idx`
4. **Notify extension** → Send `VISIBLE_FIRST_IDX` with new first index
5. **Re-arm trigger** → Set `topTriggerArmed = true` to allow loading history again

### Critical: Order of Operations

```typescript
pruneOldMessages() {
  // 1. FIRST: Remove old messages from DOM
  this.renderer.pruneByIdx(MAX_MESSAGES_IN_DOM);

  // 2. THEN: Get the actual first index that remains
  requestAnimationFrame(() => {
    this.cachedFirstVisibleIdx = this.getFirstLoadedIdx();

    // 3. SEND to extension so cursor can be updated
    this.vscode.postMessage({
      type: WEBVIEW_IN_MSG.VISIBLE_FIRST_IDX,
      idx: this.cachedFirstVisibleIdx
    });
  });

  // 4. Re-arm trigger for next scroll up
  this.topTriggerArmed = true;
}
```

**Why this order matters:**

- If we send `visibleFirstIdx` BEFORE pruning, extension gets stale index
- After pruning, first idx in DOM changes (old messages removed)
- Extension needs actual post-prune index to update cursor correctly

---

## 3. Cursor Reset Logic

### Problem: After Pruning, How to Reload Same Chunk?

**Scenario:**

1. Load latest history → cursor = 146
2. Scroll up, load previous → cursor = 16 (reached start), `has_more=false`
3. Scroll down → prune removes idx 16-145, first idx now = 146
4. Scroll up again → need to reload idx 16-145!

**Solution: `setVisibleFirstIdx()` in `HistoryService`**

```typescript
setVisibleFirstIdx(idx) {
  const topMovedDown = idx > prevCursor;

  if (topMovedDown) {
    // Pruning removed older messages, cursor moves forward
    this._historyCursor = idx;
    this._lastExhaustedBefore = undefined; // Allow reloading that chunk
  } else if (idx >= this._latestFirstIdx) {
    // User returned to latest page, reset to initial state
    this._historyCursor = this._latestFirstIdx;
    this._lastExhaustedBefore = this._latestHasMore ? undefined : this._latestFirstIdx;
  }
}
```

### Exhausted Boundary Tracking

- **`_lastExhaustedBefore`** — stores the `before` value where server returned `has_more=false`
- **`hasMore` logic** — `cursor >= exhaustedBefore` (not `>`)
  - When `cursor == exhaustedBefore`, we allow one more try (to reload after pruning)
  - When `cursor < exhaustedBefore`, we block (already tried that range)
- **Reset on prune** — when top moves down, `_lastExhaustedBefore = undefined`

---

## 4. Auto-Scroll Behavior

### When Auto-Scroll Happens

- User is "at bottom" (`scrollHeight - scrollTop - clientHeight <= BOTTOM_AUTOSCROLL_THRESHOLD (40px)`)
- User hasn't manually scrolled up (`!userScrollLocked`)
- Content grows (new message, streaming, etc.)

### User Intent Lock

**Purpose:** Prevent auto-scroll when user intentionally scrolls up to read history.

**Lock conditions:**

- User scrolls up while interacting (wheel, touch, keyboard)
- AND moves away from bottom threshold

**Unlock conditions:**

- User scrolls back near bottom (within 40px)
- Explicit `scrollToBottom()` call

### User Interaction Detection

```typescript
// Track user-initiated scrolls vs programmatic ones
this.messagesContainer.addEventListener('wheel', setInteracting);
this.messagesContainer.addEventListener('touchstart', setInteracting);
this.messagesContainer.addEventListener('mousedown', setInteracting);
window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', ...].includes(e.key)) {
    setInteracting();
  }
});
```

**Why this matters:**

- Programmatic scrolls (e.g., adjusting position after prepending history) shouldn't lock auto-scroll
- Only real user scrolls up should disable auto-scroll

---

## 5. Complete Scroll Cycle: "Up → Down → Up"

### Step-by-Step Example

```
Initial state:
- DOM contains messages idx 146-303 (latest page)
- cursor = 146
- exhaustedBefore = undefined
- hasMore = true
```

#### Step 1: Scroll Up (Load Previous)

```
1. User scrolls to scrollTop = 50 (< TOP_TRIGGER_THRESHOLD)
2. ScrollManager: topTriggerArmed=true → fires trigger
3. Sends LOAD_MORE_HISTORY to extension
4. HistoryService.loadPrevious(before=146)
5. API: GET /history?limit=20&before=146
6. Server responds: first_idx=16, has_more=false, events=[idx 16-145]
7. Update state:
   - cursor = 16
   - exhaustedBefore = 16 (since has_more=false)
   - hasMore = (16 >= 16) = true
8. Webview receives HISTORY_PREPEND_EVENTS
9. Insert events at top, adjust scrollTop
10. ScrollManager.finishHistoryLoad() → topTriggerArmed=false
```

#### Step 2: Scroll Down (Prune Old)

```
1. User scrolls down to scrollTop = 800
2. Near bottom? (scrollHeight - 800 - clientHeight <= 200) = true
3. ScrollManager.pruneOldMessages():
   - renderer.pruneByIdx(20) removes idx 16-145
   - requestAnimationFrame(() => {
       firstIdx = getFirstLoadedIdx() = 146
       Send VISIBLE_FIRST_IDX(146)
     })
   - topTriggerArmed = true (re-arm!)
4. Extension receives VISIBLE_FIRST_IDX(146)
5. HistoryService.setVisibleFirstIdx(146):
   - topMovedDown? (146 > 16) = true
   - cursor = 146
   - exhaustedBefore = undefined (reset!)
   - hasMore = true
6. Extension sends HISTORY_SET_LOAD_MORE_ENABLED(true)
7. ScrollManager.setCanLoadMore(true)
```

#### Step 3: Scroll Up Again (Reload Same Chunk)

```
1. User scrolls up to scrollTop = 50
2. ScrollManager: topTriggerArmed=true → fires trigger
3. Sends LOAD_MORE_HISTORY
4. HistoryService.loadPrevious(before=146)
   - Check: exhaustedBefore=undefined → allowed
   - OR: cursor(146) > exhaustedBefore → allowed
5. API: GET /history?limit=20&before=146
6. Server responds: first_idx=16, has_more=false, events=[idx 16-145]
7. Same events loaded again! ✅
8. Webview prepends them to DOM
```

---

## 6. Edge Cases & Fixes

### Bug 1: History Not Loading After "Up → Down → Up"

**Symptom:** After scrolling up (loading old messages), scrolling down (pruning), then up again, no request is sent.

**Root cause:** Multiple issues:

1. `topTriggerArmed` wasn't re-armed after pruning
2. `visibleFirstIdx` wasn't sent after pruning
3. `hasMore` used `>` instead of `>=`, blocking when `cursor == exhaustedBefore`

**Fix:**

- Prune always re-arms: `topTriggerArmed = true`
- Prune always sends new `visibleFirstIdx` via `requestAnimationFrame`
- `hasMore` uses `>=` to allow retrying at boundary

### Bug 2: Wrong Cursor After Pruning

**Symptom:** Extension uses wrong `before` value after pruning, creating gaps in history.

**Root cause:** `visibleFirstIdx` was sent BEFORE pruning, so extension got old index.

**Fix:** Send `visibleFirstIdx` AFTER pruning completes (via `requestAnimationFrame`).

### Bug 3: `hasMore` Stayed False After Pruning

**Symptom:** After reaching history start (`has_more=false`), even after pruning, `hasMore` remained false.

**Root cause:** Boolean `_historyHasMore` flag was never reset.

**Fix:**

- Replaced with `_lastExhaustedBefore` (numeric boundary)
- When pruning moves cursor forward, boundary is cleared
- `hasMore` computed as `cursor >= exhaustedBefore`

---

## 7. Thresholds

```typescript
TOP_TRIGGER_THRESHOLD = 100; // px from top to trigger history load
REARM_THRESHOLD = 300; // px user must scroll away from top to re-arm
BOTTOM_PRUNE_THRESHOLD = 200; // px from bottom to trigger pruning
BOTTOM_AUTOSCROLL_THRESHOLD = 40; // px from bottom for auto-scroll decisions
MAX_MESSAGES_IN_DOM = 20; // max indexed messages to keep in DOM
```

### Why Different Thresholds?

- **Prune threshold (200px)** — more relaxed, triggers when clearly near bottom
- **Auto-scroll threshold (40px)** — tighter, only when very close to bottom
- **Rearm threshold (300px)** — prevents immediate re-trigger after history load

---

## 8. Testing

### Key Test Scenarios

1. **Basic history loading** — scroll up triggers request, prepends events
2. **Re-arming after load** — trigger disarms, user must scroll down 300px to re-arm
3. **Pruning near bottom** — scrolling near bottom triggers pruning
4. **Back-forward-back cycle** — scroll up → down (prune) → up again loads correctly
5. **Cursor reset** — returning to latest page resets cursor to initial snapshot
6. **User intent lock** — scrolling up disables auto-scroll until user returns to bottom

### Test Files

- `src/webview/src/__tests__/ScrollManager.test.ts` — scroll behavior, pruning, re-arming
- `src/services/__tests__/HistoryService.test.ts` — cursor logic, pagination, exhausted boundaries
- `src/webview/src/__tests__/autoscroll.behavior.test.ts` — auto-scroll lock/unlock

---

## 9. API Contract

### Messages: Webview → Extension

- **`LOAD_MORE_HISTORY`** — request previous page of history
- **`VISIBLE_FIRST_IDX`** — report first visible index after pruning or scroll

### Messages: Extension → Webview

- **`HISTORY_REPLACE_ALL`** — replace entire history (initial load)
- **`HISTORY_PREPEND_EVENTS`** — prepend older events to top
- **`HISTORY_SET_LOAD_MORE_ENABLED`** — enable/disable loading (based on `hasMore`)
- **`SCROLL_TO_BOTTOM`** — explicitly scroll to bottom

### API Endpoint

```
GET /api/dialogs/{dialogId}/history?limit=20&before={idx}
```

**Response:**

```json
{
  "dialog_id": "...",
  "events": [...],
  "total_events": 304,
  "has_more": true,
  "first_idx": 146,
  "last_idx": 165
}
```

- **`first_idx`** — index of first event in returned chunk
- **`has_more`** — whether there are older events available (before `first_idx`)
- **`before`** param — if omitted, returns latest page; if provided, returns events before that index

---

## 10. Memory Management Strategy

### Limits

- Keep at most `MAX_MESSAGES_IN_DOM = 20` indexed messages in DOM
- Prune automatically when user scrolls near bottom
- Re-arm history loading after pruning

### What Gets Pruned

```typescript
pruneByIdx(maxIdxCount) {
  // Count index-bearing elements (user/chat messages with data-idx)
  // Remove oldest until count <= maxIdxCount
  // Also removes associated non-indexed blocks (tool calls, reasoning, etc.)
}
```

**Important:** Only messages with `data-idx` are counted. Other elements (tool calls, errors, etc.) are removed together with their preceding indexed message.

### What Happens After Pruning

1. Oldest messages removed from DOM
2. First index in DOM increases (e.g., from 16 to 146)
3. Extension updates cursor to new first index
4. `_lastExhaustedBefore` is cleared (allows reloading pruned chunk)
5. `hasMore` becomes true again
6. User can scroll up to reload the same chunk

---

## 11. Auto-Scroll Details

### Goals

- During streaming, keep user glued to bottom to see new content
- If user scrolls up to read, don't interfere
- When user returns to bottom, resume auto-scroll

### Implementation

```typescript
// Check if near bottom for auto-scroll
isNearBottomForAutoScroll(): boolean {
  const distance = scrollHeight - scrollTop - clientHeight;
  return distance <= BOTTOM_AUTOSCROLL_THRESHOLD; // 40px
}

// Check if at bottom (considering user lock)
isAtBottom(): boolean {
  return this.isNearBottomForAutoScroll() && !this.userScrollLocked;
}
```

### User Lock Mechanism

**Lock (disable auto-scroll):**

- User is interacting (wheel, touch, keyboard)
- AND scrolling up
- AND not near bottom

**Unlock (resume auto-scroll):**

- User scrolls back near bottom (within 40px)
- Explicit `scrollToBottom()` call

### Double RequestAnimationFrame

Auto-scroll uses double `requestAnimationFrame` to ensure DOM updates are complete:

```typescript
scrollToBottom() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    });
  });
}
```

**Why?** After DOM mutations (inserting messages, rendering markdown), layout may not be finalized in a single frame. Double rAF ensures we scroll to the actual final height.

---

## 12. Historical Context: Bugs Fixed

### Original Bug (Reported by User)

**Symptom:** After scroll up (load history) → scroll down (prune) → scroll up again, beginning of chat didn't load.

**Timeline:**

1. First `loadPrevious(before=146)` → got idx 16-145, `has_more=false`
2. Scroll down → pruning happened but:
   - `visibleFirstIdx` sent BEFORE pruning (sent 16 instead of 146)
   - `topTriggerArmed` not re-armed
   - `hasMore` remained false (cursor=16, exhaustedBefore=16, `16 > 16` = false)
3. Scroll up → trigger didn't fire OR request blocked by `hasMore=false`

**Fixes Applied:**

1. Send `visibleFirstIdx` AFTER pruning (via `requestAnimationFrame`)
2. Re-arm trigger in `pruneOldMessages()`: `topTriggerArmed = true`
3. Change `hasMore` logic from `>` to `>=` to allow retry at boundary
4. Replace boolean `_historyHasMore` with numeric `_lastExhaustedBefore`

---

## 13. Developer Guidelines

### When Adding New Message Types

If new message type should be pruned:

- Add `data-idx` attribute for indexed messages (user/chat)
- Don't add `data-idx` for auxiliary blocks (tool calls, errors)
- Auxiliary blocks are removed together with preceding indexed message

### When Modifying Scroll Behavior

- Always test "up → down → up" cycle
- Check that pruning doesn't break history reloading
- Verify auto-scroll lock/unlock with user scrolling
- Test with both short history (fits in one page) and long history (multiple pages)

### Common Pitfalls

1. **Sending state updates BEFORE DOM updates** — use `requestAnimationFrame`
2. **Not re-arming trigger** — history loading gets stuck
3. **Using `>` instead of `>=` for boundary checks** — blocks legitimate retries
4. **Pruning when `hasMore=false`** — loses data that can't be reloaded

---

## 14. Future Improvements

### Potential Optimizations

1. **Client-side cache** — store pruned chunks in memory (Map<idx, html>) to restore without API call
2. **Virtual scrolling** — render only visible messages, keep full history in memory but not DOM
3. **Progressive loading** — load smaller chunks more frequently for smoother UX
4. **Smarter pruning** — prune based on actual DOM height, not just message count

### Considerations

- Current approach is simple and works for most use cases
- Memory usage is bounded by `MAX_MESSAGES_IN_DOM`
- Network requests are minimized (same chunk loaded max 2x in "up → down → up" cycle)
