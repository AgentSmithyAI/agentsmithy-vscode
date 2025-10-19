import type {SSEEvent} from './StreamService';

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
        if (event.type === 'done') {
          return;
        }
      }
    }
  }

  private processLine(line: string): SSEEvent | null {
    // Blank line indicates end of one SSE message
    if (line === '') {
      const dataPayload = this.eventLines
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');

      if (dataPayload) {
        try {
          const raw: unknown = JSON.parse(dataPayload);
          const event = this.normalizeEvent(raw);
          this.eventLines = [];
          return event;
        } catch {
          // Skip invalid JSON
        }
      }
      this.eventLines = [];
      return null;
    }

    // Try to parse per-line JSON immediately
    if (line.startsWith('data:')) {
      const candidate = line.slice(5).trimStart();
      if (candidate.startsWith('{') && candidate.endsWith('}')) {
        try {
          const raw: unknown = JSON.parse(candidate);
          const event = this.normalizeEvent(raw);
          if (event) {
            return event;
          }
        } catch {
          /* noop */
        }
      }
      this.eventLines.push(line);
    }

    return null;
  }

  reset(): void {
    this.buffer = '';
    this.eventLines = [];
  }
}
