/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Alice IDE Contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AliceApiClient } from './apiClient';

export class AliceChatViewProvider implements vscode.WebviewViewProvider {
	private webviewView?: vscode.WebviewView;
	private readonly extensionUri: vscode.Uri;
	private readonly apiClient: AliceApiClient;
	private chatHistory: Array<{ role: string; content: string }> = [];

	constructor(extensionUri: vscode.Uri, apiClient: AliceApiClient) {
		this.extensionUri = extensionUri;
		this.apiClient = apiClient;
	}

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	): void {
		this.webviewView = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.extensionUri],
		};

		webviewView.webview.html = this.getHtml();

		webviewView.webview.onDidReceiveMessage(async (message) => {
			switch (message.type) {
				case 'sendMessage':
					await this.handleChatMessage(message.text);
					break;
				case 'applyCode':
					await this.handleApplyCode(message.code);
					break;
				case 'copyCode':
					await vscode.env.clipboard.writeText(message.code);
					vscode.window.showInformationMessage('Code copied to clipboard');
					break;
				case 'clearChat':
					this.chatHistory = [];
					break;
			}
		});
	}

	focusInput(): void {
		if (this.webviewView) {
			this.webviewView.show?.(true);
			this.webviewView.webview.postMessage({ type: 'focusInput' });
		}
	}

	async sendMessage(text: string): Promise<void> {
		if (this.webviewView) {
			this.webviewView.show?.(true);
			this.webviewView.webview.postMessage({ type: 'setInput', text });
			await this.handleChatMessage(text);
		}
	}

	private async handleChatMessage(text: string): Promise<void> {
		if (!this.webviewView || !text.trim()) {
			return;
		}

		this.chatHistory.push({ role: 'user', content: text });
		this.webviewView.webview.postMessage({
			type: 'addMessage',
			role: 'user',
			content: text,
		});

		this.webviewView.webview.postMessage({ type: 'startStreaming' });

		try {
			const editor = vscode.window.activeTextEditor;
			const options: Record<string, string | undefined> = {};

			if (editor) {
				options.currentFile = editor.document.uri.fsPath;
				options.currentCode = editor.document.getText();
				options.language = editor.document.languageId;

				if (!editor.selection.isEmpty) {
					options.selectedCode = editor.document.getText(editor.selection);
				}
			}

			const folders = vscode.workspace.workspaceFolders;
			if (folders && folders.length > 0) {
				options.workspacePath = folders[0].uri.fsPath;
			}

			const fullResponse = await this.apiClient.chatStream(
				this.chatHistory,
				options,
				(chunk) => {
					this.webviewView?.webview.postMessage({
						type: 'streamChunk',
						content: chunk,
					});
				}
			);

			this.chatHistory.push({ role: 'assistant', content: fullResponse });
			this.webviewView.webview.postMessage({ type: 'endStreaming' });
		} catch (err) {
			this.webviewView.webview.postMessage({
				type: 'streamError',
				error: String(err),
			});
		}
	}

	private async handleApplyCode(code: string): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showWarningMessage('Alice AI: No active editor to apply code');
			return;
		}

		const selection = editor.selection;
		if (!selection.isEmpty) {
			await editor.edit(editBuilder => {
				editBuilder.replace(selection, code);
			});
			vscode.window.showInformationMessage('Alice AI: Code applied to selection');
		} else {
			await editor.edit(editBuilder => {
				editBuilder.insert(editor.selection.active, code);
			});
			vscode.window.showInformationMessage('Alice AI: Code inserted at cursor position');
		}
	}

	private getHtml(): string {
		return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
	:root {
		--bg: var(--vscode-editor-background);
		--fg: var(--vscode-editor-foreground);
		--border: var(--vscode-panel-border);
		--accent: #a855f7;
		--accent-bg: rgba(168, 85, 247, 0.1);
		--input-bg: var(--vscode-input-background);
		--input-border: var(--vscode-input-border);
		--input-fg: var(--vscode-input-foreground);
		--btn-bg: var(--vscode-button-background);
		--btn-fg: var(--vscode-button-foreground);
		--btn-hover: var(--vscode-button-hoverBackground);
	}
	* { margin: 0; padding: 0; box-sizing: border-box; }
	body {
		font-family: var(--vscode-font-family);
		font-size: var(--vscode-font-size);
		color: var(--fg);
		background: var(--bg);
		height: 100vh;
		display: flex;
		flex-direction: column;
	}
	.messages {
		flex: 1;
		overflow-y: auto;
		padding: 12px;
	}
	.message {
		margin-bottom: 16px;
		animation: fadeIn 200ms ease;
	}
	@keyframes fadeIn {
		from { opacity: 0; transform: translateY(4px); }
		to { opacity: 1; transform: translateY(0); }
	}
	.msg-header {
		font-size: 11px;
		font-weight: 600;
		margin-bottom: 4px;
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.msg-header.user { color: #58a6ff; }
	.msg-header.assistant { color: var(--accent); }
	.msg-body {
		font-size: 13px;
		line-height: 1.6;
		word-wrap: break-word;
	}
	.msg-body code {
		background: rgba(110, 118, 129, 0.2);
		padding: 1px 4px;
		border-radius: 3px;
		font-family: var(--vscode-editor-font-family);
		font-size: 12px;
	}
	.msg-body pre {
		margin: 8px 0;
		border-radius: 6px;
		overflow: hidden;
	}
	.msg-body pre code {
		display: block;
		padding: 10px;
		background: rgba(0,0,0,0.3);
		font-size: 12px;
		line-height: 1.5;
		overflow-x: auto;
		white-space: pre;
	}
	.code-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 4px 10px;
		background: rgba(0,0,0,0.2);
		font-size: 11px;
		color: rgba(255,255,255,0.5);
	}
	.code-actions { display: flex; gap: 4px; }
	.code-actions button {
		font-size: 10px;
		padding: 2px 6px;
		border: 1px solid rgba(255,255,255,0.2);
		border-radius: 3px;
		background: transparent;
		color: rgba(255,255,255,0.6);
		cursor: pointer;
	}
	.code-actions button:hover {
		background: var(--accent-bg);
		color: var(--accent);
		border-color: var(--accent);
	}
	.typing { display: flex; gap: 4px; padding: 8px 0; }
	.typing span {
		width: 6px; height: 6px; border-radius: 50%;
		background: var(--accent);
		animation: blink 1.4s infinite ease-in-out both;
	}
	.typing span:nth-child(2) { animation-delay: 0.2s; }
	.typing span:nth-child(3) { animation-delay: 0.4s; }
	@keyframes blink {
		0%, 80%, 100% { transform: scale(0.4); opacity: 0.4; }
		40% { transform: scale(1); opacity: 1; }
	}
	.input-area {
		padding: 10px;
		border-top: 1px solid var(--border);
	}
	.input-row {
		display: flex;
		gap: 6px;
		align-items: flex-end;
	}
	textarea {
		flex: 1;
		resize: none;
		border: 1px solid var(--input-border);
		border-radius: 4px;
		background: var(--input-bg);
		color: var(--input-fg);
		padding: 8px;
		font-family: var(--vscode-font-family);
		font-size: 13px;
		min-height: 38px;
		max-height: 150px;
		outline: none;
	}
	textarea:focus { border-color: var(--accent); }
	.btn-send {
		width: 34px;
		height: 34px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--accent);
		color: white;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		font-size: 16px;
	}
	.btn-send:hover { opacity: 0.85; }
	.btn-send:disabled { opacity: 0.5; cursor: not-allowed; }
	.welcome {
		padding: 20px;
		text-align: center;
		color: rgba(255,255,255,0.5);
		font-size: 12px;
		line-height: 1.6;
	}
	.welcome h3 { color: var(--accent); margin-bottom: 8px; font-size: 14px; }
	.toolbar {
		display: flex;
		justify-content: flex-end;
		padding: 4px 8px;
		border-bottom: 1px solid var(--border);
	}
	.toolbar button {
		background: transparent;
		border: none;
		color: rgba(255,255,255,0.4);
		cursor: pointer;
		font-size: 12px;
		padding: 2px 6px;
	}
	.toolbar button:hover { color: var(--fg); }
</style>
</head>
<body>
<div class="toolbar">
	<button id="btnClear" title="Clear chat">Clear</button>
</div>
<div class="messages" id="messages">
	<div class="welcome">
		<h3>Alice AI</h3>
		<p>AI-помощник на базе YandexGPT</p>
		<p style="margin-top:8px">Ctrl+Shift+A — открыть чат<br>
		Выделите код и выберите команду Alice из контекстного меню</p>
	</div>
</div>
<div class="input-area">
	<div class="input-row">
		<textarea id="input" placeholder="Спросите Alice..." rows="2"></textarea>
		<button class="btn-send" id="btnSend" title="Send (Ctrl+Enter)">▶</button>
	</div>
</div>
<script>
(function() {
	const vscode = acquireVsCodeApi();
	const messagesEl = document.getElementById('messages');
	const inputEl = document.getElementById('input');
	const btnSend = document.getElementById('btnSend');
	const btnClear = document.getElementById('btnClear');
	let currentStreamEl = null;
	let isStreaming = false;

	function send() {
		const text = inputEl.value.trim();
		if (!text || isStreaming) return;
		vscode.postMessage({ type: 'sendMessage', text: text });
		inputEl.value = '';
		inputEl.style.height = 'auto';
	}

	inputEl.addEventListener('keydown', function(e) {
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			send();
		}
	});

	inputEl.addEventListener('input', function() {
		this.style.height = 'auto';
		this.style.height = Math.min(this.scrollHeight, 150) + 'px';
	});

	btnSend.addEventListener('click', send);

	btnClear.addEventListener('click', function() {
		vscode.postMessage({ type: 'clearChat' });
		messagesEl.innerHTML = '<div class="welcome"><h3>Alice AI</h3><p>Чат очищен</p></div>';
	});

	function escapeHtml(text) {
		const d = document.createElement('div');
		d.textContent = text;
		return d.innerHTML;
	}

	function renderMd(text) {
		let h = escapeHtml(text);
		h = h.replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g, function(m, lang, code) {
			return '<div class="code-block">'
				+ '<div class="code-header"><span>' + (lang||'code') + '</span>'
				+ '<div class="code-actions">'
				+ '<button onclick="copyCode(this)">Copy</button>'
				+ '<button onclick="applyCode(this)">Apply</button>'
				+ '</div></div>'
				+ '<pre><code>' + code + '</code></pre></div>';
		});
		h = h.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
		h = h.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
		h = h.replace(/\\n/g, '<br>');
		return h;
	}

	function addMessage(role, content) {
		const welcome = messagesEl.querySelector('.welcome');
		if (welcome) welcome.remove();

		const div = document.createElement('div');
		div.className = 'message';
		div.innerHTML = '<div class="msg-header ' + role + '">'
			+ (role === 'user' ? '👤 Вы' : '🤖 Alice AI')
			+ '</div><div class="msg-body">' + renderMd(content) + '</div>';
		messagesEl.appendChild(div);
		messagesEl.scrollTop = messagesEl.scrollHeight;
		return div;
	}

	window.copyCode = function(btn) {
		const code = btn.closest('.code-block').querySelector('code').textContent;
		vscode.postMessage({ type: 'copyCode', code: code });
		btn.textContent = 'Copied!';
		setTimeout(function() { btn.textContent = 'Copy'; }, 1500);
	};

	window.applyCode = function(btn) {
		const code = btn.closest('.code-block').querySelector('code').textContent;
		vscode.postMessage({ type: 'applyCode', code: code });
		btn.textContent = 'Applied!';
		setTimeout(function() { btn.textContent = 'Apply'; }, 1500);
	};

	window.addEventListener('message', function(event) {
		const msg = event.data;
		switch (msg.type) {
			case 'addMessage':
				addMessage(msg.role, msg.content);
				break;
			case 'startStreaming':
				isStreaming = true;
				btnSend.disabled = true;
				const div = addMessage('assistant', '');
				currentStreamEl = div.querySelector('.msg-body');
				currentStreamEl.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
				break;
			case 'streamChunk':
				if (currentStreamEl) {
					currentStreamEl.innerHTML = renderMd(msg.content);
					messagesEl.scrollTop = messagesEl.scrollHeight;
				}
				break;
			case 'endStreaming':
				isStreaming = false;
				btnSend.disabled = false;
				currentStreamEl = null;
				break;
			case 'streamError':
				isStreaming = false;
				btnSend.disabled = false;
				if (currentStreamEl) {
					currentStreamEl.innerHTML = '<span style="color:#f85149">Error: ' + escapeHtml(msg.error) + '</span>';
				}
				currentStreamEl = null;
				break;
			case 'focusInput':
				inputEl.focus();
				break;
			case 'setInput':
				inputEl.value = msg.text;
				break;
		}
	});
})();
</script>
</body>
</html>`;
	}
}
