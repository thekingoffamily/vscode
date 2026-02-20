/*---------------------------------------------------------------------------------------------
 *  Alice IDE - VS Code Extension
 *  Opens chat panel with YandexGPT (Алиса) integration
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

const VIEW_TYPE = 'aliceIde.chatView';

function getWebviewContent(apiUrl: string): string {
	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<style>
		* { margin: 0; padding: 0; box-sizing: border-box; }
		body {
			font-family: var(--vscode-font-family);
			background: var(--vscode-editor-background);
			color: var(--vscode-editor-foreground);
			height: 100vh;
			display: flex;
			flex-direction: column;
			padding: 12px;
		}
		#messages { flex: 1; overflow-y: auto; margin-bottom: 12px; }
		.msg { margin-bottom: 12px; padding: 8px 12px; border-radius: 6px; }
		.msg.user { background: var(--vscode-input-background); }
		.msg.assistant { background: var(--vscode-textBlockQuote-background); }
		.msg-role { font-size: 11px; opacity: 0.8; margin-bottom: 4px; }
		pre { background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 4px; overflow-x: auto; margin: 8px 0; }
		#input { width: 100%; padding: 8px 12px; border: 1px solid var(--vscode-input-border); border-radius: 6px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); font-family: inherit; resize: none; margin-bottom: 8px; }
		button { padding: 8px 16px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 6px; cursor: pointer; }
		button:hover { background: var(--vscode-button-hoverBackground); }
		button:disabled { opacity: 0.5; cursor: not-allowed; }
		.apply-btn { font-size: 11px; margin-top: 4px; }
	</style>
</head>
<body>
	<div id="messages"></div>
	<textarea id="input" rows="2" placeholder="Спросите Алису о коде..."></textarea>
	<button id="send">Отправить</button>
	<script>
		const apiUrl = ${JSON.stringify(apiUrl)};
		const vscode = acquireVsCodeApi();
		const messagesEl = document.getElementById('messages');
		const inputEl = document.getElementById('input');

		function addMsg(role, content, codeBlock) {
			const div = document.createElement('div');
			div.className = 'msg ' + role;
			const escaped = content.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\\n/g, '<br>').replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre>$1</pre>');
			div.innerHTML = '<div class="msg-role">' + (role === 'user' ? 'Вы' : 'Алиса') + '</div><div>' + escaped + '</div>' + (codeBlock ? '<button class="apply-btn" data-code="' + encodeURIComponent(codeBlock) + '">Применить</button>' : '');
			div.querySelector('.apply-btn')?.addEventListener('click', e => {
				const btn = e.currentTarget;
				if (btn?.dataset?.code) vscode.postMessage({ type: 'applyCode', code: decodeURIComponent(btn.dataset.code) });
			});
			messagesEl.appendChild(div);
			messagesEl.scrollTop = messagesEl.scrollHeight;
		}

		let codeContext = '';
		window.addEventListener('message', e => {
			const m = e.data;
			if (m.type === 'addMessage') addMsg(m.role, m.content, m.codeBlock);
			if (m.type === 'setCodeContext') codeContext = m.code || '';
		});

		async function send() {
			const msg = inputEl.value.trim();
			if (!msg) return;
			inputEl.value = '';
			addMsg('user', msg);
			const history = [];
			document.querySelectorAll('.msg').forEach(el => {
				const role = el.classList.contains('user') ? 'user' : 'assistant';
				const contentEl = el.querySelector('.msg-role')?.nextElementSibling;
				if (contentEl) history.push({ role, content: contentEl.textContent });
			});
			try {
				const res = await fetch(apiUrl + '/chat', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ message: msg, code_context: codeContext || null, chat_history: history.slice(0, -1).slice(-4) })
				});
				const data = await res.json();
				if (data.response) {
					const match = data.response.match(/\`\`\`[\\w]*\\n?([\\s\\S]*?)\`\`\`/);
					addMsg('assistant', data.response, match ? match[1].trim() : null);
				} else throw new Error(data.detail || 'Error');
			} catch (e) {
				addMsg('assistant', 'Ошибка: ' + e.message + '. Запущен ли бэкенд на ' + apiUrl + '?', null);
			}
		}

		document.getElementById('send').onclick = send;
		inputEl.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
	</script>
</body>
</html>`;
}

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('aliceIde.openChat', () => {
			const config = vscode.workspace.getConfiguration('aliceIde');
			const apiUrl = config.get<string>('apiUrl', 'http://localhost:8000');

			const panel = vscode.window.createWebviewPanel(
				VIEW_TYPE,
				'Alice IDE — Чат с Алисой',
				vscode.ViewColumn.Beside,
				{ enableScripts: true }
			);

			panel.webview.html = getWebviewContent(apiUrl);

			// Sync code context when editor changes
			const updateCodeContext = () => {
				const editor = vscode.window.activeTextEditor;
				if (editor) {
					const sel = editor.selection;
					const text = sel.isEmpty ? editor.document.getText() : editor.document.getText(sel);
					panel.webview.postMessage({ type: 'setCodeContext', code: text || '' });
				}
			};

			const disposable = vscode.window.onDidChangeActiveTextEditor(updateCodeContext);
			vscode.window.onDidChangeTextEditorSelection(updateCodeContext);
			updateCodeContext();

			panel.webview.onDidReceiveMessage(
				(msg) => {
					if (msg.type === 'applyCode' && msg.code) {
						const editor = vscode.window.activeTextEditor;
						if (editor) {
							const sel = editor.selection;
							const range = sel.isEmpty ? new vscode.Range(0, 0, editor.document.lineCount, 0) : sel;
							editor.edit((eb) => eb.replace(range, msg.code));
						}
					}
				},
				null,
				context.subscriptions
			);

			panel.onDidDispose(() => disposable.dispose());
		})
	);
}

export function deactivate() {}
