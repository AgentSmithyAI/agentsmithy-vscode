Focus behavior in AgentSmithy chat webview

Summary

- We persist input focus only when it was actually focused at the moment the webview lost focus or became hidden.
- We restore the caret/selection exactly where it was; no jumping to the end.
- We never steal focus from VS Code if the user interacted elsewhere meanwhile.
- We DO NOT override default browser paste behavior.

Rules

1. Snapshot on blur/hidden
   - On window blur and document.visibilityState === 'hidden', if the active element is the message input, we record:
     - shouldRestoreInputFocus = true
     - lastSelection = { start, end, direction }
   - If any other element was focused, we don't set the restore flag.

2. Restore on focus/visible
   - On window focus or document.visibilityState === 'visible', we restore if shouldRestoreInputFocus === true.
   - We call focus() on the input and setSelectionRange(start, end, direction) from the snapshot.
   - After restore we clear shouldRestoreInputFocus.

3. Avoid extension-driven focus
   - The extension no longer sends FOCUS_INPUT messages on visibility/window focus. The webview decides whether to restore focus.
   - This prevents stealing focus from the editor/code area or any other VS Code UI part when returning to VS Code.

4. Paste behavior (important!)
   - We intentionally DO NOT modify cursor position after paste.
   - The browser natively places the caret at the END OF THE PASTED FRAGMENT (not the end of all text).
   - This is the correct behavior for inserting text in the middle of existing content.
   - Example: If textarea has "Hello World" and user pastes "Beautiful " at position 6,
     the result is "Hello Beautiful World" with caret after "Beautiful " (position 16),
     NOT at the end of all text (position 21).
   - Previously there was code that moved caret to end of entire textarea after paste,
     which broke middle-insertion workflows. This was removed.

Edge cases

- If the user clicked somewhere else inside the webview before leaving, the input blur will clear the restore intent.
- If selection length changed due to input value edits from other events, we clamp to the nearest valid range internally.
- If the browser doesn't support selectionDirection in setSelectionRange, we fall back to start/end.

Developer notes

- Webview: src/webview/src/index.ts (setupFocusPersistence, selection snapshot/restore)
- Extension: src/chatWebviewProvider.ts (stopped posting FOCUS_INPUT on visibility/window focus)

Testing

- Add tests covering:
  - Restores caret at previous position after alt+tab back.
  - Does not restore when focus was outside the message input on blur/hidden.
  - Does not restore when user focused a different element before coming back.
  - Keeps selection range (start!=end) intact.
  - Paste in middle of text keeps caret at end of pasted fragment (not end of all text).
