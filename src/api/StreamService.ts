import {SSEStreamReader} from './SSEStreamReader';
import {SSE_EVENT_TYPES as E, ERROR_NAMES} from '../constants';

export interface AgentSmithyMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatContext {
  current_file?: {
    path: string;
    language: string;
    content: string;
    selection?: string;
  };
}

export interface ChatRequest {
  messages: AgentSmithyMessage[];
  context?: ChatContext;
  stream: boolean;
  dialog_id?: string;
}

export interface SSEEvent {
  type:
    | typeof E.CHAT_START
    | typeof E.CHAT
    | typeof E.CHAT_END
    | typeof E.REASONING_START
    | typeof E.REASONING
    | typeof E.REASONING_END
    | typeof E.TOOL_CALL
    | typeof E.FILE_EDIT
    | typeof E.ERROR
    | typeof E.DONE;
  content?: string;
  dialog_id?: string;
  error?: string;
  done?: boolean;
  name?: string;
  args?: unknown;
  file?: string;
  diff?: string;
  checkpoint?: string;
}

/**
 * Service for SSE streaming from AgentSmithy server
 */
export class StreamService {
  private abortController?: AbortController;
  private readonly endpoint = '/api/chat';

  constructor(
    private readonly baseUrl: string,
    private readonly normalizeEvent: (raw: unknown) => SSEEvent | null,
  ) {}

  /**
   * Abort current stream
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = undefined;
    }
  }

  /**
   * Stream chat responses
   */
  async *streamChat(request: ChatRequest): AsyncGenerator<SSEEvent> {
    this.abort();
    this.abortController = new AbortController();

    const response = await this.createRequest(request);
    const reader = this.getReader(response);
    const sseReader = new SSEStreamReader(this.normalizeEvent);
    const decoder = new TextDecoder();

    try {
      for await (const chunk of this.readStream(reader, decoder)) {
        for (const event of sseReader.processChunk(chunk)) {
          yield event;
          if (event.type === E.DONE) {
            return;
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === ERROR_NAMES.ABORT) {
        throw error;
      }
      throw error;
    } finally {
      reader.releaseLock();
      this.abortController = undefined;
    }
  }

  private async createRequest(request: ChatRequest): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${this.endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
      body: JSON.stringify({...request, stream: true}),
      signal: this.abortController?.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response;
  }

  private getReader = (response: Response): ReadableStreamDefaultReader<Uint8Array> => {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }
    return reader;
  };

  private async *readStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    decoder: {decode: (input?: Uint8Array, options?: {stream?: boolean}) => string},
  ): AsyncGenerator<string> {
    for (;;) {
      const readResult = await reader.read();
      const done: boolean = Boolean((readResult as {done?: boolean}).done);
      const value: Uint8Array | undefined = (readResult as {value?: Uint8Array}).value;

      if (done) {
        break;
      }

      yield decoder.decode(value ?? new Uint8Array(), {stream: true});
    }
  }
}
