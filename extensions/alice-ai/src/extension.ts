/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Alice IDE Contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AliceChatViewProvider } from './chatViewProvider';
import { AliceApiClient } from './apiClient';

let apiClient: AliceApiClient;

export function activate(context: vscode.ExtensionContext): void {
	const config = vscode.workspace.getConfiguration('alice-ai');
	const endpoint = config.get<string>('apiEndpoint', 'http://localhost:8090');

	apiClient = new AliceApiClient(endpoint);

	const chatProvider = new AliceChatViewProvider(context.extensionUri, apiClient);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('alice-ai.chatView', chatProvider, {
			webviewOptions: { retainContextWhenHidden: true }
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('alice-ai.askAlice', () => {
			chatProvider.focusInput();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('alice-ai.explainCode', () => {
			const code = getSelectedCode();
			if (code) {
				chatProvider.sendMessage(`Объясни этот код:\n\`\`\`\n${code}\n\`\`\``);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('alice-ai.fixCode', () => {
			const code = getSelectedCode();
			if (code) {
				chatProvider.sendMessage(`Исправь ошибки в этом коде:\n\`\`\`\n${code}\n\`\`\``);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('alice-ai.refactorCode', () => {
			const code = getSelectedCode();
			if (code) {
				chatProvider.sendMessage(`Отрефактори этот код:\n\`\`\`\n${code}\n\`\`\``);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('alice-ai.generateTests', () => {
			const code = getSelectedCode();
			if (code) {
				chatProvider.sendMessage(`Напиши тесты для этого кода:\n\`\`\`\n${code}\n\`\`\``);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('alice-ai.indexWorkspace', async () => {
			const folders = vscode.workspace.workspaceFolders;
			if (!folders || folders.length === 0) {
				vscode.window.showWarningMessage('Alice AI: No workspace folder open');
				return;
			}
			try {
				await vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					title: 'Alice AI: Indexing workspace...',
					cancellable: false,
				}, async () => {
					const result = await apiClient.indexWorkspace(folders[0].uri.fsPath);
					vscode.window.showInformationMessage(
						`Alice AI: Indexed ${result.indexed_files} files (${result.total_chunks} chunks)`
					);
				});
			} catch (err) {
				vscode.window.showErrorMessage(`Alice AI: Indexing failed — ${err}`);
			}
		})
	);

	if (config.get<boolean>('autoIndex', false)) {
		vscode.commands.executeCommand('alice-ai.indexWorkspace');
	}
}

function getSelectedCode(): string | undefined {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showWarningMessage('Alice AI: No active editor');
		return undefined;
	}
	const selection = editor.selection;
	if (selection.isEmpty) {
		vscode.window.showWarningMessage('Alice AI: No code selected');
		return undefined;
	}
	return editor.document.getText(selection);
}

export function deactivate(): void {
	// Cleanup
}
