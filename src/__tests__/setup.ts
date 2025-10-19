/**
 * Global test setup for Vitest
 */
import {beforeEach, vi} from 'vitest';
import {createVSCodeMock} from './mocks/vscode';

// Mock vscode module globally
vi.mock('vscode', () => createVSCodeMock());

// Reset all mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});
