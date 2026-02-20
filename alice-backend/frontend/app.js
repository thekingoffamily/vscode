/**
 * Alice IDE — Frontend Application
 * AI-Powered Code Editor using YandexGPT
 */

(function () {
    'use strict';

    const API_BASE = window.location.origin;

    const state = {
        editor: null,
        currentFile: null,
        currentLanguage: 'plaintext',
        openFiles: new Map(),
        chatHistory: [],
        isStreaming: false,
        settings: {
            apiUrl: API_BASE,
            workspace: '/workspace',
            theme: 'dark',
        },
    };

    // ── Monaco Editor Setup ──

    function initMonaco() {
        require.config({
            paths: {
                vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs',
            },
        });

        require(['vs/editor/editor.main'], function () {
            monaco.editor.defineTheme('alice-dark', {
                base: 'vs-dark',
                inherit: true,
                rules: [
                    { token: 'comment', foreground: '6e7681', fontStyle: 'italic' },
                    { token: 'keyword', foreground: 'ff7b72' },
                    { token: 'string', foreground: 'a5d6ff' },
                    { token: 'number', foreground: '79c0ff' },
                    { token: 'type', foreground: 'ffa657' },
                    { token: 'function', foreground: 'd2a8ff' },
                    { token: 'variable', foreground: 'ffa657' },
                ],
                colors: {
                    'editor.background': '#0d1117',
                    'editor.foreground': '#e6edf3',
                    'editor.lineHighlightBackground': '#161b2277',
                    'editorLineNumber.foreground': '#6e7681',
                    'editorLineNumber.activeForeground': '#e6edf3',
                    'editor.selectionBackground': '#264f78',
                    'editor.inactiveSelectionBackground': '#264f7844',
                    'editorCursor.foreground': '#a855f7',
                    'editorWhitespace.foreground': '#21262d',
                    'editorIndentGuide.background': '#21262d',
                    'editorIndentGuide.activeBackground': '#30363d',
                },
            });

            state.editor = monaco.editor.create(document.getElementById('monacoEditor'), {
                value: '',
                language: 'plaintext',
                theme: 'alice-dark',
                fontSize: 14,
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                fontLigatures: true,
                minimap: { enabled: true, scale: 1 },
                scrollBeyondLastLine: false,
                renderWhitespace: 'selection',
                bracketPairColorization: { enabled: true },
                guides: { bracketPairs: true, indentation: true },
                smoothScrolling: true,
                cursorBlinking: 'smooth',
                cursorSmoothCaretAnimation: 'on',
                padding: { top: 12 },
                lineNumbers: 'on',
                wordWrap: 'off',
                tabSize: 4,
                insertSpaces: true,
                automaticLayout: true,
            });

            state.editor.onDidChangeCursorPosition(function (e) {
                document.getElementById('cursorPosition').textContent =
                    `Строка ${e.position.lineNumber}, Столбец ${e.position.column}`;
            });

            state.editor.addAction({
                id: 'alice-ask',
                label: 'Ask Alice AI',
                keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyL],
                run: function () {
                    document.getElementById('chatInput').focus();
                },
            });

            state.editor.addAction({
                id: 'alice-explain',
                label: 'Alice: Explain Selection',
                contextMenuGroupId: 'alice',
                contextMenuOrder: 1,
                run: function (ed) {
                    const selection = ed.getModel().getValueInRange(ed.getSelection());
                    if (selection) {
                        sendChatMessage(`Объясни этот код:\n\`\`\`\n${selection}\n\`\`\``);
                    }
                },
            });

            state.editor.addAction({
                id: 'alice-fix',
                label: 'Alice: Fix Selection',
                contextMenuGroupId: 'alice',
                contextMenuOrder: 2,
                run: function (ed) {
                    const selection = ed.getModel().getValueInRange(ed.getSelection());
                    if (selection) {
                        sendChatMessage(`Исправь этот код:\n\`\`\`\n${selection}\n\`\`\``);
                    }
                },
            });

            state.editor.addAction({
                id: 'alice-refactor',
                label: 'Alice: Refactor Selection',
                contextMenuGroupId: 'alice',
                contextMenuOrder: 3,
                run: function (ed) {
                    const selection = ed.getModel().getValueInRange(ed.getSelection());
                    if (selection) {
                        sendChatMessage(`Отрефактори этот код:\n\`\`\`\n${selection}\n\`\`\``);
                    }
                },
            });
        });
    }

    // ── File Explorer ──

    async function loadFileTree(path) {
        try {
            const url = path ? `${API_BASE}/api/files?path=${encodeURIComponent(path)}` : `${API_BASE}/api/files`;
            const resp = await fetch(url);
            if (!resp.ok) throw new Error('Failed to load files');
            const files = await resp.json();
            renderFileTree(files, document.getElementById('fileTree'), 0);
        } catch (err) {
            document.getElementById('fileTree').innerHTML =
                '<div class="loading-placeholder">Не удалось загрузить файлы</div>';
        }
    }

    function renderFileTree(items, container, depth) {
        container.innerHTML = '';
        for (const item of items) {
            const div = document.createElement('div');
            div.className = `file-item ${item.is_directory ? 'directory' : ''}`;
            div.style.paddingLeft = `${12 + depth * 16}px`;

            if (item.is_directory) {
                const arrow = document.createElement('span');
                arrow.className = 'dir-arrow';
                arrow.textContent = '▶';
                div.appendChild(arrow);

                const icon = document.createElement('span');
                icon.textContent = '📁';
                icon.className = 'file-icon';
                div.appendChild(icon);

                const name = document.createElement('span');
                name.textContent = item.name;
                div.appendChild(name);

                const childContainer = document.createElement('div');
                childContainer.style.display = 'none';
                container.appendChild(div);
                container.appendChild(childContainer);

                let loaded = false;
                if (item.children && item.children.length > 0) {
                    renderFileTree(item.children, childContainer, depth + 1);
                    loaded = true;
                }

                div.addEventListener('click', async function () {
                    const isOpen = childContainer.style.display !== 'none';
                    childContainer.style.display = isOpen ? 'none' : 'block';
                    arrow.classList.toggle('open', !isOpen);
                    if (!isOpen && !loaded) {
                        try {
                            const resp = await fetch(`${API_BASE}/api/files?path=${encodeURIComponent(item.path)}`);
                            const children = await resp.json();
                            renderFileTree(children, childContainer, depth + 1);
                            loaded = true;
                        } catch (e) { /* ignore */ }
                    }
                });
            } else {
                const icon = document.createElement('span');
                icon.textContent = getFileIcon(item.name);
                icon.className = 'file-icon';
                div.appendChild(icon);

                const name = document.createElement('span');
                name.textContent = item.name;
                div.appendChild(name);

                container.appendChild(div);

                div.addEventListener('click', function () {
                    openFile(item.path);
                });
            }
        }
    }

    function getFileIcon(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        const icons = {
            py: '🐍', js: '📜', ts: '💎', vue: '💚', html: '🌐',
            css: '🎨', json: '📋', md: '📝', yaml: '⚙️', yml: '⚙️',
            go: '🔵', rs: '🦀', java: '☕', cpp: '⚡', c: '⚡',
            sh: '💻', sql: '🗃️', xml: '📄', dockerfile: '🐳',
        };
        return icons[ext] || '📄';
    }

    async function openFile(path) {
        try {
            const resp = await fetch(`${API_BASE}/api/file?path=${encodeURIComponent(path)}`);
            if (!resp.ok) throw new Error('Failed to open file');
            const data = await resp.json();

            state.currentFile = path;
            state.currentLanguage = data.language;

            const langMap = {
                python: 'python', javascript: 'javascript', typescript: 'typescript',
                vue: 'html', html: 'html', css: 'css', json: 'json',
                markdown: 'markdown', yaml: 'yaml', go: 'go', rust: 'rust',
            };
            const monacoLang = langMap[data.language] || 'plaintext';

            document.getElementById('welcomeScreen').style.display = 'none';
            document.getElementById('monacoContainer').style.display = 'block';

            if (state.editor) {
                const model = monaco.editor.createModel(data.content, monacoLang);
                state.editor.setModel(model);
            }

            state.openFiles.set(path, data);
            updateTabs(path);
            updateContext();

            document.getElementById('currentFileTitle').textContent = path;
            document.getElementById('languageDisplay').textContent = data.language;

            showToast(`Открыт: ${path}`, 'info');
        } catch (err) {
            showToast(`Ошибка: ${err.message}`, 'error');
        }
    }

    function updateTabs(activePath) {
        const tabsEl = document.getElementById('editorTabs');
        tabsEl.innerHTML = '';

        for (const [path] of state.openFiles) {
            const tab = document.createElement('div');
            tab.className = `tab ${path === activePath ? 'active' : ''}`;
            tab.dataset.path = path;

            const name = document.createElement('span');
            name.textContent = path.split('/').pop();
            tab.appendChild(name);

            const close = document.createElement('span');
            close.className = 'tab-close';
            close.textContent = '×';
            close.addEventListener('click', function (e) {
                e.stopPropagation();
                closeTab(path);
            });
            tab.appendChild(close);

            tab.addEventListener('click', function () {
                openFile(path);
            });

            tabsEl.appendChild(tab);
        }
    }

    function closeTab(path) {
        state.openFiles.delete(path);
        if (state.currentFile === path) {
            if (state.openFiles.size > 0) {
                const nextPath = state.openFiles.keys().next().value;
                openFile(nextPath);
            } else {
                state.currentFile = null;
                document.getElementById('welcomeScreen').style.display = 'flex';
                document.getElementById('monacoContainer').style.display = 'none';
                document.getElementById('currentFileTitle').textContent = 'Добро пожаловать';
                updateTabs(null);
            }
        } else {
            updateTabs(state.currentFile);
        }
    }

    // ── Chat System ──

    function updateContext() {
        const contextEl = document.getElementById('chatContext');
        const badge = document.getElementById('contextBadge');
        if (state.currentFile) {
            contextEl.style.display = 'flex';
            badge.textContent = `📄 ${state.currentFile}`;
        } else {
            contextEl.style.display = 'none';
        }
    }

    async function sendChatMessage(text) {
        if (!text || !text.trim() || state.isStreaming) return;

        const userMessage = text.trim();
        state.chatHistory.push({ role: 'user', content: userMessage });
        appendMessage('user', userMessage);

        const chatInput = document.getElementById('chatInput');
        chatInput.value = '';
        chatInput.style.height = 'auto';

        state.isStreaming = true;
        document.getElementById('btnSend').disabled = true;

        const assistantDiv = appendMessage('assistant', '');
        const bodyEl = assistantDiv.querySelector('.message-body');
        showTypingIndicator(bodyEl);

        try {
            let selectedCode = null;
            let currentCode = null;

            if (state.editor) {
                const sel = state.editor.getSelection();
                if (sel && !sel.isEmpty()) {
                    selectedCode = state.editor.getModel().getValueInRange(sel);
                }
                currentCode = state.editor.getValue();
            }

            const resp = await fetch(`${API_BASE}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: state.chatHistory,
                    current_file: state.currentFile,
                    current_code: currentCode,
                    selected_code: selectedCode,
                    language: state.currentLanguage,
                    workspace_path: state.settings.workspace,
                    use_rag: true,
                    stream: true,
                }),
            });

            if (!resp.ok) throw new Error(`API error: ${resp.status}`);

            const reader = resp.body.getReader();
            const decoder = new TextDecoder();
            let fullResponse = '';
            let buffer = '';

            bodyEl.innerHTML = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data: ')) continue;
                    const dataStr = trimmed.slice(6);

                    if (dataStr === '[DONE]') continue;

                    try {
                        const data = JSON.parse(dataStr);
                        if (data.error) {
                            bodyEl.innerHTML = `<span style="color: var(--error)">Ошибка: ${escapeHtml(data.error)}</span>`;
                            continue;
                        }
                        if (data.content) {
                            fullResponse = data.content;
                            bodyEl.innerHTML = renderMarkdown(fullResponse);
                        }
                    } catch (e) { /* skip malformed JSON */ }
                }
            }

            if (fullResponse) {
                state.chatHistory.push({ role: 'assistant', content: fullResponse });
                bodyEl.innerHTML = renderMarkdown(fullResponse);
                attachCodeBlockActions(bodyEl);
            }

        } catch (err) {
            bodyEl.innerHTML = `<span style="color: var(--error)">Ошибка: ${escapeHtml(err.message)}</span>`;
        } finally {
            state.isStreaming = false;
            document.getElementById('btnSend').disabled = false;
            scrollChatToBottom();
        }
    }

    function appendMessage(role, content) {
        const messagesEl = document.getElementById('chatMessages');

        const welcomeEl = messagesEl.querySelector('.chat-welcome');
        if (welcomeEl) welcomeEl.remove();

        const div = document.createElement('div');
        div.className = 'message';

        const header = document.createElement('div');
        header.className = `message-header ${role}`;
        header.innerHTML = role === 'user'
            ? '<span>👤</span><span>Вы</span>'
            : '<span>🤖</span><span>Alice AI</span>';
        div.appendChild(header);

        const body = document.createElement('div');
        body.className = 'message-body';
        body.innerHTML = content ? renderMarkdown(content) : '';
        div.appendChild(body);

        messagesEl.appendChild(div);
        scrollChatToBottom();

        if (content) {
            attachCodeBlockActions(body);
        }

        return div;
    }

    function showTypingIndicator(el) {
        el.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
    }

    function scrollChatToBottom() {
        const messagesEl = document.getElementById('chatMessages');
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    // ── Markdown Rendering ──

    function renderMarkdown(text) {
        let html = escapeHtml(text);

        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, function (match, lang, code) {
            const langLabel = lang || 'code';
            return `<div class="code-block-wrapper" data-lang="${langLabel}">`
                + `<div class="code-block-header">`
                + `<span>${escapeHtml(langLabel)}</span>`
                + `<div class="code-block-actions">`
                + `<button class="btn-copy" onclick="window.aliceCopyCode(this)">Копировать</button>`
                + `<button class="btn-apply" onclick="window.aliceApplyCode(this)">Применить</button>`
                + `</div></div>`
                + `<pre><code>${code}</code></pre></div>`;
        });

        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
        html = html.replace(/\n/g, '<br>');

        return html;
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function attachCodeBlockActions(container) {
        // Actions attached via inline onclick in renderMarkdown
    }

    window.aliceCopyCode = function (btn) {
        const wrapper = btn.closest('.code-block-wrapper');
        const code = wrapper.querySelector('code').textContent;
        navigator.clipboard.writeText(code).then(function () {
            btn.textContent = 'Скопировано!';
            setTimeout(function () { btn.textContent = 'Копировать'; }, 1500);
        });
    };

    window.aliceApplyCode = async function (btn) {
        if (!state.currentFile || !state.editor) {
            showToast('Сначала откройте файл', 'error');
            return;
        }

        const wrapper = btn.closest('.code-block-wrapper');
        const newCode = wrapper.querySelector('code').textContent;
        const selection = state.editor.getSelection();

        if (selection && !selection.isEmpty()) {
            const originalCode = state.editor.getModel().getValueInRange(selection);
            try {
                const resp = await fetch(`${API_BASE}/api/apply-change`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        file_path: state.currentFile,
                        original_code: originalCode,
                        new_code: newCode,
                    }),
                });
                if (!resp.ok) throw new Error('Failed to apply');
                state.editor.executeEdits('alice-apply', [{
                    range: selection,
                    text: newCode,
                }]);
                showToast('Изменения применены!', 'success');
                btn.textContent = 'Применено!';
                setTimeout(function () { btn.textContent = 'Применить'; }, 2000);
            } catch (err) {
                showToast(`Ошибка: ${err.message}`, 'error');
            }
        } else {
            const pos = state.editor.getPosition();
            state.editor.executeEdits('alice-apply', [{
                range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
                text: newCode,
            }]);
            showToast('Код вставлен в позицию курсора', 'success');
            btn.textContent = 'Вставлено!';
            setTimeout(function () { btn.textContent = 'Применить'; }, 2000);
        }
    };

    // ── Indexing ──

    async function indexWorkspace() {
        try {
            showToast('Индексация проекта...', 'info');
            document.getElementById('indexStatus').textContent = 'RAG: индексация...';

            const resp = await fetch(`${API_BASE}/api/index`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workspace_path: state.settings.workspace,
                }),
            });

            if (!resp.ok) throw new Error('Indexing failed');
            const data = await resp.json();

            document.getElementById('indexStatus').textContent =
                `RAG: ${data.indexed_files} файлов, ${data.total_chunks} фрагментов`;
            showToast(`Индексация завершена: ${data.indexed_files} файлов`, 'success');
        } catch (err) {
            document.getElementById('indexStatus').textContent = 'RAG: ошибка';
            showToast(`Ошибка индексации: ${err.message}`, 'error');
        }
    }

    // ── Toast Notifications ──

    function showToast(message, type) {
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = `toast ${type || 'info'}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(function () {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            setTimeout(function () { toast.remove(); }, 200);
        }, 3000);
    }

    // ── Health Check ──

    async function checkHealth() {
        try {
            const resp = await fetch(`${API_BASE}/api/health`);
            const data = await resp.json();

            const badge = document.getElementById('statusBadge');
            if (data.configured) {
                badge.innerHTML = '<span class="status-dot" style="background: var(--success)"></span><span>YandexGPT</span>';
                document.getElementById('configNotice').style.display = 'none';
            } else {
                badge.innerHTML = '<span class="status-dot"></span><span>Демо</span>';
            }

            if (data.indexed_chunks > 0) {
                document.getElementById('indexStatus').textContent =
                    `RAG: ${data.indexed_chunks} фрагментов`;
            }
        } catch (e) {
            showToast('Бэкенд недоступен', 'error');
        }
    }

    // ── Settings ──

    function loadSettings() {
        try {
            const saved = localStorage.getItem('alice-ide-settings');
            if (saved) {
                Object.assign(state.settings, JSON.parse(saved));
            }
        } catch (e) { /* ignore */ }
    }

    function saveSettings() {
        localStorage.setItem('alice-ide-settings', JSON.stringify(state.settings));
    }

    // ── Event Bindings ──

    function bindEvents() {
        // Chat input
        const chatInput = document.getElementById('chatInput');
        chatInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                sendChatMessage(chatInput.value);
            }
        });

        chatInput.addEventListener('input', function () {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 200) + 'px';
        });

        document.getElementById('btnSend').addEventListener('click', function () {
            sendChatMessage(chatInput.value);
        });

        // Chat panel toggle
        document.getElementById('btnToggleChat').addEventListener('click', function () {
            document.getElementById('chatPanel').classList.toggle('collapsed');
        });

        document.getElementById('btnOpenChat').addEventListener('click', function () {
            document.getElementById('chatPanel').classList.remove('collapsed');
            chatInput.focus();
        });

        // Clear chat
        document.getElementById('btnClearChat').addEventListener('click', function () {
            state.chatHistory = [];
            const messagesEl = document.getElementById('chatMessages');
            messagesEl.innerHTML = `
                <div class="chat-welcome">
                    <p>Чат очищен. Задайте новый вопрос!</p>
                </div>`;
        });

        // Context
        document.getElementById('btnClearContext').addEventListener('click', function () {
            document.getElementById('chatContext').style.display = 'none';
        });

        // File tree
        document.getElementById('btnRefreshFiles').addEventListener('click', function () {
            loadFileTree();
        });

        // Indexing
        document.getElementById('btnIndex').addEventListener('click', indexWorkspace);
        document.getElementById('btnStartIndex').addEventListener('click', indexWorkspace);

        // Settings
        document.getElementById('btnSettings').addEventListener('click', function () {
            document.getElementById('settingApiUrl').value = state.settings.apiUrl;
            document.getElementById('settingWorkspace').value = state.settings.workspace;
            document.getElementById('settingTheme').value = state.settings.theme;
            document.getElementById('settingsModal').style.display = 'flex';
        });

        document.getElementById('btnCloseSettings').addEventListener('click', function () {
            document.getElementById('settingsModal').style.display = 'none';
        });

        document.getElementById('btnCancelSettings').addEventListener('click', function () {
            document.getElementById('settingsModal').style.display = 'none';
        });

        document.getElementById('btnSaveSettings').addEventListener('click', function () {
            state.settings.apiUrl = document.getElementById('settingApiUrl').value;
            state.settings.workspace = document.getElementById('settingWorkspace').value;
            state.settings.theme = document.getElementById('settingTheme').value;
            saveSettings();
            document.getElementById('settingsModal').style.display = 'none';
            showToast('Настройки сохранены', 'success');
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', function (e) {
            if (e.ctrlKey && e.key === 'b') {
                e.preventDefault();
                const sidebar = document.getElementById('sidebar');
                sidebar.style.display = sidebar.style.display === 'none' ? 'flex' : 'none';
            }
            if (e.ctrlKey && e.key === 'j') {
                e.preventDefault();
                document.getElementById('chatPanel').classList.toggle('collapsed');
            }
        });
    }

    // ── Init ──

    function init() {
        loadSettings();
        bindEvents();
        initMonaco();
        loadFileTree();
        checkHealth();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
