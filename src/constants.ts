export const COMMANDS = {
  OPEN_CHAT: 'agentsmithy.openChat',
  SEND_SELECTION: 'agentsmithy.sendSelection',
  MOVE_TO_SECONDARY: 'agentsmithy.moveToSecondarySidebar',
} as const;

export const VIEWS = {
  CHAT: 'agentsmithy.chatView',
  CONTAINER: 'agentsmithy',
} as const;

export const CONFIG_KEYS = {
  SERVER_URL: 'agentsmithy.serverUrl',
  SHOW_REASONING: 'agentsmithy.showReasoning',
} as const;

export const DEFAULT_SERVER_URL = 'http://localhost:8765';

export const ERROR_MESSAGES = {
  LOAD_HISTORY: 'Failed to load history',
  NO_ACTIVE_EDITOR: 'No active editor',
  NO_SELECTION: 'No text selected',
  NO_RESPONSE: 'No response from server',
  CONNECTION_ERROR: 'Connection error',
  INVALID_FILE_PATH: 'Invalid file path',
  OPEN_CHAT: 'Open Chat',
  REQUEST_CANCELLED: 'Request cancelled',
} as const;

export const TIMEOUTS = {
  WEBVIEW_INIT: 500,
  PROCESSING_SAFETY: 30000,
} as const;

export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 20,
} as const;

export const STATUS_FILE_PATH = '.agentsmithy/status.json';

export const WELCOME_MESSAGE =
  'AgentSmithy is ready! Open the chat from the sidebar or use Command Palette → "AgentSmithy: Open Chat"';

export const MOVE_TO_SECONDARY_MESSAGE =
  'To move AgentSmithy to secondary sidebar: Right-click on AgentSmithy icon in activity bar → "Move to Secondary Side Bar"';

// Error names
export const ERROR_NAMES = {
  ABORT: 'AbortError',
} as const;

// Global state keys
export const STATE_KEYS = {
  WELCOME_SHOWN: 'agentsmithy.welcomeShown',
} as const;

// HTML element IDs for webview
export const DOM_IDS = {
  MESSAGES: 'messages',
  WELCOME_PLACEHOLDER: 'welcomePlaceholder',
  MESSAGE_INPUT: 'messageInput',
  SEND_BUTTON: 'sendButton',
  DIALOG_VIEWS: 'dialogViews',
  SETTINGS_BTN: 'settingsBtn',
  MODEL_SELECTOR_BTN: 'modelSelectorBtn',
  MODEL_DROPDOWN: 'modelDropdown',
  MODEL_SELECTOR_TEXT: 'modelSelectorText',
} as const;

// CSS class names
export const CSS_CLASSES = {
  CHAT_CONTAINER: 'chat-container',
  MESSAGES: 'messages',
  WELCOME_PLACEHOLDER: 'welcome-placeholder',
  INPUT_CONTAINER: 'input-container',
  REASONING_TOGGLE: 'reasoning-toggle',
  FILE_LINK: 'file-link',
  MODEL_ITEM: 'model-item',
  MODEL_NAME: 'model-name',
  RESTORE_CHECKPOINT_BTN: 'restore-checkpoint-btn',
} as const;

// SSE event types
export const SSE_EVENT_TYPES = {
  USER: 'user',
  CHAT_START: 'chat_start',
  CHAT: 'chat',
  CHAT_END: 'chat_end',
  REASONING_START: 'reasoning_start',
  REASONING: 'reasoning',
  REASONING_END: 'reasoning_end',
  TOOL_CALL: 'tool_call',
  FILE_EDIT: 'file_edit',
  ERROR: 'error',
  DONE: 'done',
} as const;

export const WEBVIEW_DEFAULTS = {
  MODEL_ID: 'gpt5',
} as const;
