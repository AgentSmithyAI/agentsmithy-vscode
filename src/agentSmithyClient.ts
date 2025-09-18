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
    
    async *streamChat(request: ChatRequest): AsyncGenerator<SSEEvent> {
        const response = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream',
                'Cache-Control': 'no-cache'
            },
            body: JSON.stringify({ ...request, stream: true })
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
								const event = JSON.parse(dataPayload) as SSEEvent;
								yield event;
								if (event.type === 'done') {
									return;
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
								const event = JSON.parse(candidate) as SSEEvent;
								yield event;
								emitted = true;
								if (event.type === 'done') {
									return;
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
		} finally {
			reader.releaseLock();
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

