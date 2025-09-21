import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

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
    type: 'chat_start' | 'chat' | 'chat_end' | 'reasoning_start' | 'reasoning' | 'reasoning_end' | 'tool_call' | 'file_edit' | 'error' | 'done';
    content?: string;
    dialog_id?: string;
    error?: string;
    done?: boolean;
    name?: string;
    args?: any;
    file?: string;
    diff?: string;
    checkpoint?: string;
}

export class AgentSmithyClient {
    private baseUrl: string;
    private abortController?: AbortController;
    
    constructor(baseUrl?: string) {
        this.baseUrl = baseUrl || this.getServerUrl();
    }
    
    private getServerUrl(): string {
        // Try to read from .agentsmithy/status.json in workspace
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            const statusPath = path.join(workspaceRoot, '.agentsmithy', 'status.json');
            
            try {
                if (fs.existsSync(statusPath)) {
                    const statusContent = fs.readFileSync(statusPath, 'utf8');
                    const status = JSON.parse(statusContent);
                    if (status.port) {
                        return `http://localhost:${status.port}`;
                    }
                }
            } catch (error) {
                // Silently fallback to config
            }
        }
        
        // Fallback to configuration or default
        const config = vscode.workspace.getConfiguration('agentsmithy');
        return config.get<string>('serverUrl', 'http://localhost:11434');
    }
    
    abort() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = undefined;
        }
    }

	private normalizeEvent(raw: any): SSEEvent | null {
		if (!raw || typeof raw !== 'object') {
			return null;
		}
		const type = raw.type as string | undefined;
		// Normalize patch/diff/file_edit to a unified file_edit event
		if (type === 'patch' || type === 'diff' || type === 'file_edit') {
			const file = raw.file || raw.path || raw.file_path;
			const diff = raw.diff || raw.patch;
			const checkpoint = raw.checkpoint;
			return { type: 'file_edit', file, diff, checkpoint };
		}
		// Pass through known types with minimal mapping
		switch (type) {
			case 'chat_start':
				return { type: 'chat_start' } as SSEEvent;
			case 'chat':
				return { type: 'chat', content: raw.content } as SSEEvent;
			case 'chat_end':
				return { type: 'chat_end' } as SSEEvent;
			case 'reasoning_start':
				return { type: 'reasoning_start' } as SSEEvent;
			case 'reasoning':
				return { type: 'reasoning', content: raw.content } as SSEEvent;
			case 'reasoning_end':
				return { type: 'reasoning_end' } as SSEEvent;
			case 'tool_call':
				return { type: 'tool_call', name: raw.name, args: raw.args } as SSEEvent;
			case 'error':
				return { type: 'error', error: raw.error || raw.message } as SSEEvent;
			case 'done':
				return { type: 'done', dialog_id: raw.dialog_id } as SSEEvent;
			default:
				// Old protocol: content without type => treat as chat chunk
				if (typeof raw.content === 'string' && !type) {
					return { type: 'chat', content: raw.content } as SSEEvent;
				}
				return null;
		}
	}
    
    async *streamChat(request: ChatRequest): AsyncGenerator<SSEEvent> {
        // Cancel any previous request
        this.abort();
        
        // Create new abort controller for this request
        this.abortController = new AbortController();
        
        const response = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream',
                'Cache-Control': 'no-cache'
            },
            body: JSON.stringify({ ...request, stream: true }),
            signal: this.abortController.signal
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error('No response body');
        }
        
		const decoder = new TextDecoder();
		let buffer = '';
		let eventLines: string[] = [];
		
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split(/\r?\n/);
				buffer = lines.pop() || '';
				
				for (const line of lines) {
					// Blank line indicates end of one SSE message
					if (line === '') {
						const dataPayload = eventLines
							.filter(l => l.startsWith('data:'))
							.map(l => l.slice(5).trimStart())
							.join('\n');
						if (dataPayload) {
						try {
							const raw = JSON.parse(dataPayload);
							const event = this.normalizeEvent(raw);
							if (event) {
								yield event;
								if (event.type === 'done') {
									// Don't return here - let the stream end naturally
									// return;
								}
							}
						} catch (e) {
                                // Skip invalid JSON
                            }
						}
						eventLines = [];
						continue;
					}
					// Accumulate data lines; handle both 'data:' and 'data: '
					if (line.startsWith('data:')) {
						// Try to parse per-line JSON immediately (many servers send one JSON per line)
						const candidate = line.slice(5).trimStart();
						let emitted = false;
						if (candidate.startsWith('{') && candidate.endsWith('}')) {
							try {
								const raw = JSON.parse(candidate);
								const event = this.normalizeEvent(raw);
								if (event) {
									yield event;
									emitted = true;
									if (event.type === 'done') {
										// Don't return here - let the stream end naturally
										// return;
									}
								}
							} catch {}
						}
						if (!emitted) {
							eventLines.push(line);
						}
					}
					// Ignore comments (lines starting with ':') and other fields for now
				}
			}
		} catch (error) {
			// Re-throw abort errors to be handled by caller
			if (error instanceof Error && error.name === 'AbortError') {
				throw error;
			}
			throw error;
		} finally {
			reader.releaseLock();
			// Clear abort controller when done
			if (this.abortController?.signal.aborted) {
				this.abortController = undefined;
			}
		}
    }
    
    getCurrentFileContext(): ChatContext | undefined {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return undefined;
        }
        
        const document = editor.document;
        const selection = editor.selection;
        
        return {
            current_file: {
                path: document.fileName,
                language: document.languageId,
                content: document.getText(),
                selection: !selection.isEmpty ? document.getText(selection) : undefined
            }
        };
    }
}

