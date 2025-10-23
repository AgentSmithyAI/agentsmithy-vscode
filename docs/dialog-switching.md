# Dialog Switching Architecture

## Overview

This document describes the dialog switching architecture that allows users to switch between conversations while streams are active, without losing data or breaking the UI state.

## Problem Statement

**Requirements:**

- User can send a message and start a stream
- User can switch to another dialog while stream is active
- Stream events must continue rendering in the background dialog (not the visible one)
- Send/Stop button spinner should only appear for the active dialog
- Auto-scroll should only work for the active dialog
- When user switches back to streaming dialog, everything works as if they never left (auto-scroll, text, spinner)
- Inactive dialogs without active streams should be unloaded from memory
- Dialog containers should be lazy-loaded (created only when user switches to them)

## Architecture

### Core Concept: Virtual Dialog Views

The system creates **separate isolated DOM containers** for each dialog. Only the active dialog's container is visible at any time. Each container maintains its own rendering state, scroll position, and stream state independently.

### Key Components

#### 1. `DialogView`

**Purpose:** Encapsulates everything needed for a single dialog's UI.

**Responsibilities:**

- Owns a dedicated DOM container (`.dialog-view-container`)
- Manages its own `MessageRenderer` for rendering messages
- Manages its own `ScrollManager` for scroll behavior
- Manages its own `StreamingStateManager` for tracking stream state
- Tracks whether it's currently active (visible)
- Can be shown/hidden independently

**Lifecycle:**

```typescript
constructor(dialogId, workspaceRoot, vscode, parentContainer) {
  // 1. Create DOM container
  this.container = createElement('div.dialog-view-container')
  this.container.dataset.dialogId = dialogId
  this.container.style.display = 'none' // Hidden by default

  // 2. Create messages container inside
  messagesContainer = createElement('div.messages')
  this.container.appendChild(messagesContainer)

  // 3. Initialize managers for this specific dialog
  this.renderer = new MessageRenderer(messagesContainer, ...)
  this.streamingState = new StreamingStateManager()
  this.scrollManager = new ScrollManager(messagesContainer, ...)
}
```

**Key Methods:**

- `show()` / `hide()` - Toggle visibility
- `hasActiveStream()` - Check if stream is running
- `destroy()` - Clean up and remove from DOM

#### 2. `DialogViewManager`

**Purpose:** Manages multiple `DialogView` instances.

**Responsibilities:**

- Creates dialog views on-demand (lazy loading)
- Switches between dialogs (hide old, show new)
- Tracks the currently active dialog
- Implements memory management strategy
- Periodically cleans up inactive views

**Memory Management Strategy:**

- Keep ALL dialogs with active streams (regardless of count)
- Keep the currently active dialog
- Keep up to `MAX_INACTIVE_VIEWS` (3) recently used inactive dialogs
- Remove excess inactive dialogs without streams

**Cleanup Logic:**

```typescript
cleanupInactiveViews() {
  for each view:
    if (view.dialogId === activeDialogId) → KEEP
    else if (view.hasActiveStream()) → KEEP
    else → CANDIDATE FOR REMOVAL

  if (candidates.length > MAX_INACTIVE_VIEWS):
    remove (candidates.length - MAX_INACTIVE_VIEWS) oldest views
}
```

**Cleanup Triggers:**

- Debounced: 5 seconds after dialog switch
- Periodic: Every 30 seconds

#### 3. `MessageHandler`

**Purpose:** Routes events to the correct dialog view based on `dialogId`.

**Key Logic:**

```typescript
handle(message: WebviewOutMessage) {
  // Check if message has dialogId
  if (dialogViewManager && message.dialogId) {
    handleForDialog(message.dialogId, message)
    return
  }

  // Fallback to legacy handling (for backward compatibility)
  handleLegacy(message)
}

handleForDialog(dialogId: string, message: WebviewOutMessage) {
  // Get or create the dialog view
  const view = dialogViewManager.getOrCreateView(dialogId)
  const isActive = view.getIsActive()

  // Process message using view's own managers
  switch (message.type) {
    case APPEND_TO_ASSISTANT:
      view.renderer.append(...)
      // Only scroll if THIS dialog is active
      if (isActive) {
        view.scrollManager.scrollIntoViewIfAtBottom(...)
      }
      break

    case START_ASSISTANT_MESSAGE:
      view.streamingState.setProcessing(true, dialogId)
      // Only update UI button if THIS dialog is active
      if (isActive) {
        uiController.setProcessing(true)
      }
      break
  }
}
```

**Handled Events in `handleForDialog`:**

- Streaming: `START_ASSISTANT_MESSAGE`, `APPEND_TO_ASSISTANT`, `END_ASSISTANT_MESSAGE`
- Reasoning: `START_REASONING`, `APPEND_TO_REASONING`, `END_REASONING`
- Tools: `SHOW_TOOL_CALL`, `SHOW_FILE_EDIT`
- Errors: `SHOW_ERROR`, `SHOW_INFO`
- History: `HISTORY_REPLACE_ALL`, `HISTORY_PREPEND_EVENTS`
- Scroll: `SCROLL_TO_BOTTOM`, `HISTORY_SET_LOAD_MORE_ENABLED`
- Stream control: `END_STREAM`

#### 4. `StreamingStateManager`

**Purpose:** Tracks streaming state and associates it with a specific dialog.

**Fields:**

- `currentStreamDialogId: string | null` - ID of dialog with active stream
- `isProcessing: boolean` - Whether any stream is currently active
- `currentAssistantMessage: HTMLElement | null` - Currently streaming message element
- `currentReasoningBlock: ReasoningBlock | null` - Currently streaming reasoning block

**Key Methods:**

```typescript
setProcessing(processing: boolean, dialogId?: string) {
  this.isProcessing = processing
  if (processing && dialogId) {
    this.currentStreamDialogId = dialogId
  } else if (!processing) {
    this.currentStreamDialogId = null
  }
}

getCurrentStreamDialogId(): string | null {
  return this.currentStreamDialogId
}
```

#### 5. Extension Side: `EventHandlers`

**Purpose:** Attach `dialogId` to all outgoing messages.

**Changes:**

```typescript
constructor(postMessage: PostMessage, dialogId?: string) {
  this.dialogId = dialogId
}

// Every message now includes dialogId
handleChatStart() {
  postMessage({type: 'startAssistantMessage', dialogId: this.dialogId})
}

handleChat(event) {
  postMessage({type: 'appendToAssistant', content: ..., dialogId: this.dialogId})
}
```

**In `ChatWebviewProvider._handleSendMessage()`:**

```typescript
const eventHandlers = new StreamEventHandlers(
  (msg) => this._postMessage(msg),
  this._historyService.currentDialogId, // Pass current dialog ID!
);
```

### DOM Structure

```html
<div class="chat-container">
  <div class="chat-header"><!-- Dialog selector --></div>

  <!-- Container for all dialog views -->
  <div id="dialogViews" class="dialog-views-container">
    <!-- Dialog containers are created dynamically: -->
    <div class="dialog-view-container" data-dialog-id="abc123" style="display: block">
      <div class="messages" id="messages-abc123">
        <!-- Messages for dialog abc123 -->
      </div>
    </div>
    <div class="dialog-view-container" data-dialog-id="def456" style="display: none">
      <div class="messages" id="messages-def456">
        <!-- Messages for dialog def456 -->
      </div>
    </div>
  </div>

  <!-- Fallback container for backward compatibility -->
  <div id="messages" class="messages" style="display: none">
    <!-- Used when dialogId is not available -->
  </div>

  <div class="input-container"><!-- Input & send button --></div>
</div>
```

### CSS: The Critical Part

**The Challenge:** Making scrolling work with nested flex containers and absolute positioning.

**Solution:**

```css
/* Parent: Must constrain children */
.dialog-views-container {
  flex: 1;
  min-height: 0; /* CRITICAL: Allow flex child to shrink */
  overflow: hidden; /* CRITICAL: Prevent this level from scrolling */
  position: relative; /* For absolute children */
}

/* Dialog container: Fills parent completely */
.dialog-view-container {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* Messages: This is what actually scrolls */
.dialog-view-container .messages {
  flex: 1 1 auto; /* Grow to fill space */
  min-height: 0; /* CRITICAL: Allow shrinking in flex */
  max-height: 100%; /* CRITICAL: Don't exceed parent */
  overflow-y: auto; /* Enable vertical scroll */
  overflow-x: hidden; /* No horizontal scroll */
}
```

**Why `min-height: 0` is critical:**
Without it, flex children have implicit `min-height: auto`, which means they'll grow to fit content and never trigger `overflow`. With `min-height: 0`, the child is constrained by parent size and overflow kicks in.

### Event Flow

#### Scenario 1: Normal Message Flow

```
1. User types in dialog A
2. ChatWebview.sendMessage()
   → Gets activeView from DialogViewManager
   → Uses activeView's renderer to add user message
   → activeView.streamingState.setProcessing(true, dialogId)
3. Extension.StreamService sends request
4. Extension.EventHandlers receives stream
   → Adds dialogId to each message
5. ChatWebview receives messages
   → MessageHandler.handle(message)
   → Sees message.dialogId
   → MessageHandler.handleForDialog(dialogId, message)
   → Gets correct DialogView by dialogId
   → Routes to view.renderer, view.streamingState, etc.
```

#### Scenario 2: Switch During Stream

```
1. Stream active in dialog A
2. User clicks to switch to dialog B
3. Extension sends DIALOG_SWITCHED
4. ChatWebview.handleDialogSwitch(dialogB.id)
   → DialogViewManager.switchToDialog(dialogB.id)
     → dialogA.hide() - Sets display: none
     → dialogB.show() - Sets display: block (creates if needed)
     → activeDialogId = dialogB.id
   → Update UI: Check dialogB.streamingState.isProcessing()
   → If dialogB has no stream: show Send button
   → messagesContainer.style.display = 'none' (hide legacy)
5. Stream events continue arriving for dialog A
   → MessageHandler sees message.dialogId = dialogA.id
   → Routes to dialogA.renderer (even though hidden)
   → dialogA.streamingState continues updating
   → Auto-scroll skipped (isActive = false)
   → UI button NOT updated (isActive = false)
6. User switches back to dialog A
   → DialogViewManager.switchToDialog(dialogA.id)
   → dialogB.hide(), dialogA.show()
   → Check dialogA.streamingState.isProcessing() → true
   → Update UI button to spinner
   → Auto-scroll resumes working
```

#### Scenario 3: History Loading with dialogId

```
1. Extension sends HISTORY_REPLACE_ALL with dialogId
2. Before DIALOG_SWITCHED arrives (currentDialogId still null!)
3. MessageHandler.handle(message)
   → Sees message.dialogId
   → handleForDialog(message.dialogId, message)
   → Creates DialogView if needed
   → Renders all history events
4. Later: DIALOG_SWITCHED arrives
   → handleDialogSwitch(dialogId)
   → DialogViewManager.switchToDialog(dialogId)
   → View already exists with rendered history!
   → Just shows it
```

## Memory Management Implementation

### When Views are Created

- **Lazy:** Only when `getOrCreateView(dialogId)` is called
- **Triggers:**
  - User switches to dialog
  - Stream event arrives for dialog
  - History loads for dialog

### When Views are Destroyed

- **Automatic cleanup runs:**
  - 5 seconds after dialog switch (debounced)
  - Every 30 seconds (periodic check)
- **Cleanup criteria:**
  ```typescript
  Remove view if:
    - NOT active dialog
    - AND NOT has active stream
    - AND exceeds MAX_INACTIVE_VIEWS (3) limit
  ```

### Memory Footprint

Each `DialogView` contains:

- DOM container with messages (~lightweight when empty)
- `MessageRenderer` instance
- `ScrollManager` instance
- `StreamingStateManager` instance

Keeping 3 inactive views = ~minimal overhead (few KB per view)

## Testing

### Test Coverage

**New test files:**

- `DialogView.test.ts` - 14 tests (100% coverage)
- `DialogViewManager.test.ts` - 20 tests with integration scenarios
- `MessageHandler.test.ts` - 6 integration tests for routing

**Total:** 228 tests passing

### Critical Test Scenarios

1. **Dialog switching during active stream**
   - Stream continues in background
   - State preserved when switching back
2. **UI updates only for active dialog**
   - Spinner shows only in active dialog
   - Auto-scroll works only in active dialog
3. **History routing with dialogId**
   - History loads into correct dialog before switch
   - Multiple dialogs can load history simultaneously
4. **Memory cleanup**
   - Inactive views without streams are removed
   - Active and streaming views are preserved
5. **Scroll behavior**
   - Each dialog has independent scroll state
   - Scroll position preserved when switching

## Known Issues & Solutions

### Issue 1: Scroll Not Working

**Symptom:** Messages container doesn't scroll, content goes off-screen.

**Root Cause:** Flex children without `min-height: 0` ignore parent height constraints.

**Solution:**

```css
.dialog-views-container {
  min-height: 0; /* Allow flex child to shrink */
  overflow: hidden; /* This level must NOT scroll */
}

.dialog-view-container .messages {
  min-height: 0; /* Allow shrinking */
  max-height: 100%; /* Respect parent bounds */
  overflow-y: auto; /* This level MUST scroll */
}
```

### Issue 2: History Loading Before Dialog Switch

**Symptom:** History loads into wrong container, then gets cleared on switch.

**Root Cause:** Events arrive in order:

1. `HISTORY_REPLACE_ALL` (no currentDialogId set yet!)
2. `DIALOG_SWITCHED` (sets currentDialogId)

**Solution:** All history messages include `dialogId` for early routing:

```typescript
// Extension side
_loadLatestHistoryPage(dialogId, replace) {
  postMessage({
    type: HISTORY_REPLACE_ALL,
    events: [...],
    dialogId  // Now included!
  })
}

// Webview side
handleForDialog(dialogId, message) {
  const view = getOrCreateView(dialogId)  // Create if needed
  // Load history into THIS view
}
```

### Issue 3: Auto-Scroll in Background Dialogs

**Symptom:** When stream runs in background dialog, it tries to scroll invisible container.

**Solution:** Check `isActive` before scrolling:

```typescript
handleForDialog(dialogId, message) {
  const view = getOrCreateView(dialogId)
  const isActive = view.getIsActive()

  case APPEND_TO_ASSISTANT:
    streamingState.appendToAssistant(content)
    // Only scroll if this dialog is visible
    if (isActive) {
      scrollManager.scrollIntoViewIfAtBottom(element)
    }
}
```

### Issue 4: Spinner Shows for Wrong Dialog

**Symptom:** Spinner appears when background dialog starts streaming.

**Solution:** Update UI button only for active dialog:

```typescript
case START_ASSISTANT_MESSAGE:
  streamingState.setProcessing(true, dialogId)
  // Only update button if THIS dialog is active
  if (isActive) {
    uiController.setProcessing(true)
  }
```

## Performance Considerations

### Lazy Loading

- Dialog containers created only when accessed
- No upfront cost for dialogs that are never viewed

### Cleanup Strategy

- **Debounced cleanup:** Wait 5s after switch to avoid thrashing
- **Periodic cleanup:** Every 30s to catch edge cases
- **Stream-aware:** Never remove dialogs with active streams

### DOM Impact

- Each dialog view: ~1-2 KB overhead when empty
- 3 cached inactive views: ~3-6 KB total
- Negligible compared to message content

## Message Types

All streaming and history messages include optional `dialogId` for routing:

```typescript
type WebviewOutMessage =
  | {type: 'startAssistantMessage'; dialogId?: string}
  | {type: 'appendToAssistant'; content: string; dialogId?: string}
  | {type: 'endAssistantMessage'; dialogId?: string}
  | {type: 'startReasoning'; dialogId?: string}
  | {type: 'appendToReasoning'; content: string; dialogId?: string}
  | {type: 'endReasoning'; dialogId?: string}
  | {type: 'showToolCall'; tool?: string; args?: unknown; dialogId?: string}
  | {type: 'showFileEdit'; file: string; diff?: string; dialogId?: string}
  | {type: 'showError'; error: string; dialogId?: string}
  | {type: 'showInfo'; message: string; dialogId?: string}
  | {type: 'endStream'; dialogId?: string}
  | {type: 'historyReplaceAll'; events: HistoryEvent[]; dialogId?: string}
  | {type: 'historyPrependEvents'; events: HistoryEvent[]; dialogId?: string}
  | {type: 'scrollToBottom'; dialogId?: string}
  | {type: 'historySetLoadMoreEnabled'; enabled: boolean; dialogId?: string};
// ...
```

## Backward Compatibility

- **Legacy container preserved:** `#messages` still exists for fallback
- **Optional dialogId:** Messages without `dialogId` use legacy path
- **All existing tests pass:** No breaking changes to existing behavior
- **Graceful degradation:** If DialogViewManager fails, falls back to legacy

## Future Improvements

1. **Persist view state in VSCode storage**
   - Save scroll position per dialog
   - Restore on next load
2. **Configurable cache limits**
   - User setting for `MAX_INACTIVE_VIEWS`
   - Memory-based eviction policy
3. **Stream indicator in dropdown**
   - Visual indicator showing which dialogs have active streams
   - Prevent accidental cleanup
4. **Pre-loading adjacent dialogs**
   - Predictive loading based on access patterns
   - Background history fetch
5. **Virtual scrolling for large histories**
   - Render only visible messages
   - Paginate on scroll

## Debug Tips

### Check View State

```javascript
// In browser console
window.dialogViewManager.getLoadedDialogIds();
window.dialogViewManager.getActiveDialogId();
window.dialogViewManager.getActiveView().hasActiveStream();
```

### Verify Scroll Setup

```javascript
const view = window.dialogViewManager.getActiveView();
const messages = view.container.querySelector('.messages');
console.log({
  scrollHeight: messages.scrollHeight,
  clientHeight: messages.clientHeight,
  scrollTop: messages.scrollTop,
  canScroll: messages.scrollHeight > messages.clientHeight,
});
```

### Check Event Routing

Add logging in `MessageHandler.handleForDialog()` to verify events route correctly.
