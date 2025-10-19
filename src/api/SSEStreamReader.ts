import type {SSEEvent} from './StreamService';
import {SSE_EVENT_TYPES as E} from '../constants';

/**
 * Parses Server-Sent Events (SSE) stream
 */
export class SSEStreamReader {
  private buffer = '';
  private eventLines: string[] = [];

  constructor(private readonly normalizeEvent: (raw: unknown) => SSEEvent | null) {}

  /**
   * Process chunk of data from SSE stream
   */
  *processChunk(chunk: string): Generator<SSEEvent> {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const event = this.processLine(line);
      if (event) {
        yield event;
        if (event.type === E.DONE) {
          return;
        }
      }
    }
  }

  private processLine(line: string): SSEEvent | null {
    // Blank line indicates end of one SSE message
    if (line === '') {
      return this.flushEventLines();
    }

    if (line.startsWith('data:')) {
      return this.handleDataLine(line);
    }

    return null;
  }

  private flushEventLines(): SSEEvent | null {
    const dataPayload = this.eventLines
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');

    this.eventLines = [];

    if (!dataPayload) {
      return null;
    }

    try {
      const raw: unknown = JSON.parse(dataPayload);
      return this.normalizeEvent(raw);
    } catch {
      // Skip invalid JSON
      return null;
    }
  }

  private handleDataLine(line: string): SSEEvent | null {
    const candidate = line.slice(5).trimStart();

    if (candidate.startsWith('{') && candidate.endsWith('}')) {
      try {
        const raw: unknown = JSON.parse(candidate);
        const event = this.normalizeEvent(raw);
        if (event) {
          return event;
        }
      } catch {
        // fallthrough to buffer line
      }
    }

    this.eventLines.push(line);
    return null;
  }

  reset(): void {
    this.buffer = '';
    this.eventLines = [];
  }
}
