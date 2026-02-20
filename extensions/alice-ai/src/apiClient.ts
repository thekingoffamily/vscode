/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Alice IDE Contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as https from 'https';
import * as http from 'http';

interface ChatMessage {
	role: string;
	content: string;
}

interface ChatRequest {
	messages: ChatMessage[];
	current_file?: string;
	current_code?: string;
	selected_code?: string;
	language?: string;
	workspace_path?: string;
	use_rag: boolean;
	stream: boolean;
}

interface IndexResult {
	indexed_files: number;
	total_chunks: number;
	workspace_path: string;
	status: string;
}

export class AliceApiClient {
	private endpoint: string;

	constructor(endpoint: string) {
		this.endpoint = endpoint.replace(/\/$/, '');
	}

	async chat(
		messages: ChatMessage[],
		options: {
			currentFile?: string;
			currentCode?: string;
			selectedCode?: string;
			language?: string;
			workspacePath?: string;
		} = {}
	): Promise<string> {
		const body: ChatRequest = {
			messages,
			current_file: options.currentFile,
			current_code: options.currentCode,
			selected_code: options.selectedCode,
			language: options.language,
			workspace_path: options.workspacePath,
			use_rag: true,
			stream: false,
		};

		const result = await this.post('/api/chat', body);
		return result.content || '';
	}

	async chatStream(
		messages: ChatMessage[],
		options: {
			currentFile?: string;
			currentCode?: string;
			selectedCode?: string;
			language?: string;
			workspacePath?: string;
		} = {},
		onChunk: (text: string) => void
	): Promise<string> {
		const body: ChatRequest = {
			messages,
			current_file: options.currentFile,
			current_code: options.currentCode,
			selected_code: options.selectedCode,
			language: options.language,
			workspace_path: options.workspacePath,
			use_rag: true,
			stream: true,
		};

		return new Promise<string>((resolve, reject) => {
			const url = new URL(`${this.endpoint}/api/chat`);
			const isHttps = url.protocol === 'https:';
			const lib = isHttps ? https : http;

			const postData = JSON.stringify(body);
			const reqOptions = {
				hostname: url.hostname,
				port: url.port || (isHttps ? 443 : 80),
				path: url.pathname,
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(postData),
				},
			};

			const req = lib.request(reqOptions, (res) => {
				let fullText = '';
				let buffer = '';

				res.on('data', (chunk: Buffer) => {
					buffer += chunk.toString();
					const lines = buffer.split('\n');
					buffer = lines.pop() || '';

					for (const line of lines) {
						const trimmed = line.trim();
						if (!trimmed || !trimmed.startsWith('data: ')) {
							continue;
						}
						const dataStr = trimmed.slice(6);
						if (dataStr === '[DONE]') {
							continue;
						}
						try {
							const data = JSON.parse(dataStr);
							if (data.content) {
								fullText = data.content;
								onChunk(data.content);
							}
						} catch {
							// Skip malformed
						}
					}
				});

				res.on('end', () => {
					resolve(fullText);
				});

				res.on('error', reject);
			});

			req.on('error', reject);
			req.write(postData);
			req.end();
		});
	}

	async indexWorkspace(workspacePath: string): Promise<IndexResult> {
		return this.post('/api/index', { workspace_path: workspacePath });
	}

	async health(): Promise<Record<string, unknown>> {
		return this.get('/api/health');
	}

	private async post(path: string, body: unknown): Promise<any> {
		return new Promise((resolve, reject) => {
			const url = new URL(`${this.endpoint}${path}`);
			const isHttps = url.protocol === 'https:';
			const lib = isHttps ? https : http;

			const postData = JSON.stringify(body);
			const options = {
				hostname: url.hostname,
				port: url.port || (isHttps ? 443 : 80),
				path: url.pathname,
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(postData),
				},
			};

			const req = lib.request(options, (res) => {
				let data = '';
				res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
				res.on('end', () => {
					try {
						resolve(JSON.parse(data));
					} catch {
						resolve({ content: data });
					}
				});
				res.on('error', reject);
			});

			req.on('error', reject);
			req.write(postData);
			req.end();
		});
	}

	private async get(path: string): Promise<any> {
		return new Promise((resolve, reject) => {
			const url = new URL(`${this.endpoint}${path}`);
			const isHttps = url.protocol === 'https:';
			const lib = isHttps ? https : http;

			lib.get(url.href, (res) => {
				let data = '';
				res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
				res.on('end', () => {
					try {
						resolve(JSON.parse(data));
					} catch {
						resolve({ raw: data });
					}
				});
				res.on('error', reject);
			}).on('error', reject);
		});
	}
}
