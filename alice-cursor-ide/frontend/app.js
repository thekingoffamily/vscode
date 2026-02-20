const state = {
	files: [],
	filteredFiles: [],
	selectedPath: "",
	editor: null,
	chatHistory: [],
	lastSuggestedCode: null,
};

const dom = {
	filesList: document.getElementById("filesList"),
	fileFilter: document.getElementById("fileFilter"),
	activePath: document.getElementById("activePath"),
	statusText: document.getElementById("statusText"),
	reindexBtn: document.getElementById("reindexBtn"),
	saveBtn: document.getElementById("saveBtn"),
	applyBtn: document.getElementById("applyBtn"),
	sendBtn: document.getElementById("sendBtn"),
	chatInput: document.getElementById("chatInput"),
	chatMessages: document.getElementById("chatMessages"),
};

function setStatus(text) {
	dom.statusText.textContent = text;
}

function createMessage(role, text) {
	const node = document.createElement("div");
	node.className = `msg ${role}`;
	node.textContent = text;
	dom.chatMessages.appendChild(node);
	dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
	return node;
}

function languageForPath(path) {
	const ext = path.split(".").pop()?.toLowerCase() ?? "";
	const map = {
		py: "python",
		ts: "typescript",
		tsx: "typescript",
		js: "javascript",
		jsx: "javascript",
		json: "json",
		md: "markdown",
		css: "css",
		html: "html",
		yaml: "yaml",
		yml: "yaml",
		go: "go",
		rs: "rust",
		java: "java",
		c: "c",
		h: "cpp",
		hpp: "cpp",
		cpp: "cpp",
		cs: "csharp",
		sh: "shell",
		sql: "sql",
	};
	return map[ext] ?? "plaintext";
}

async function fetchJson(url, options = {}) {
	const response = await fetch(url, options);
	if (!response.ok) {
		let detail = response.statusText;
		try {
			const payload = await response.json();
			detail = payload.detail ?? detail;
		} catch {
			// ignore json parsing errors
		}
		throw new Error(detail);
	}
	return response.json();
}

function renderFiles() {
	dom.filesList.innerHTML = "";
	for (const filePath of state.filteredFiles) {
		const li = document.createElement("li");
		li.textContent = filePath;
		li.title = filePath;
		li.className = filePath === state.selectedPath ? "active" : "";
		li.addEventListener("click", () => openFile(filePath));
		dom.filesList.appendChild(li);
	}
}

function applyFilter() {
	const filter = dom.fileFilter.value.trim().toLowerCase();
	state.filteredFiles = filter
		? state.files.filter(path => path.toLowerCase().includes(filter))
		: [...state.files];
	renderFiles();
}

async function loadFiles() {
	const payload = await fetchJson("/api/files?limit=1800");
	state.files = payload.files ?? [];
	applyFilter();
}

async function openFile(path) {
	const payload = await fetchJson(`/api/file?path=${encodeURIComponent(path)}`);
	state.selectedPath = path;
	dom.activePath.textContent = path;
	state.editor.setValue(payload.content ?? "");
	window.monaco.editor.setModelLanguage(state.editor.getModel(), languageForPath(path));
	state.lastSuggestedCode = null;
	dom.applyBtn.disabled = true;
	renderFiles();
	setStatus(`Opened: ${path}`);
}

async function saveFile() {
	if (!state.selectedPath) {
		createMessage("system", "Открой файл перед сохранением.");
		return;
	}
	await fetchJson("/api/file", {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			path: state.selectedPath,
			content: state.editor.getValue(),
		}),
	});
	setStatus(`Saved: ${state.selectedPath}`);
}

async function reindex() {
	setStatus("Reindexing...");
	const payload = await fetchJson("/api/reindex", { method: "POST" });
	setStatus(`RAG chunks: ${payload.chunks}`);
}

function parseSseBuffer(buffer, onEvent) {
	const parts = buffer.split("\n\n");
	const tail = parts.pop() ?? "";
	for (const part of parts) {
		for (const line of part.split("\n")) {
			if (!line.startsWith("data:")) {
				continue;
			}
			const raw = line.slice("data:".length).trim();
			if (!raw) {
				continue;
			}
			try {
				onEvent(JSON.parse(raw));
			} catch {
				// ignore malformed chunks
			}
		}
	}
	return tail;
}

async function sendChat() {
	const userPrompt = dom.chatInput.value.trim();
	if (!userPrompt) {
		return;
	}
	if (!state.selectedPath) {
		createMessage("system", "Открой файл перед отправкой запроса в AI.");
		return;
	}

	dom.chatInput.value = "";
	createMessage("user", userPrompt);
	const assistantNode = createMessage("assistant", "");
	dom.sendBtn.disabled = true;
	setStatus("Waiting for model...");

	try {
		const response = await fetch("/api/chat", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				file_path: state.selectedPath,
				file_content: state.editor.getValue(),
				user_message: userPrompt,
				history: state.chatHistory.slice(-10),
			}),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(errorText || "Chat request failed.");
		}
		if (!response.body) {
			throw new Error("Empty response body.");
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder("utf-8");
		let buffer = "";
		let assistantText = "";
		let resultPayload = null;

		while (true) {
			const { value, done } = await reader.read();
			if (done) {
				break;
			}
			buffer += decoder.decode(value, { stream: true });
			buffer = parseSseBuffer(buffer, event => {
				if (event.type === "token") {
					assistantText += event.content ?? "";
					assistantNode.textContent = assistantText;
					dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
				}
				if (event.type === "result") {
					resultPayload = event;
				}
			});
		}

		if (resultPayload?.assistant_message) {
			assistantText = resultPayload.assistant_message;
			assistantNode.textContent = assistantText;
		}

		state.lastSuggestedCode =
			typeof resultPayload?.updated_code === "string"
				? resultPayload.updated_code
				: null;
		dom.applyBtn.disabled = !state.lastSuggestedCode;
		state.chatHistory.push({ role: "user", content: userPrompt });
		state.chatHistory.push({ role: "assistant", content: assistantText });
		setStatus("Model response received.");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		createMessage("system", `Ошибка запроса к модели: ${message}`);
		setStatus("Chat failed.");
	} finally {
		dom.sendBtn.disabled = false;
	}
}

async function applySuggestedChange() {
	if (!state.lastSuggestedCode) {
		return;
	}
	state.editor.setValue(state.lastSuggestedCode);
	await saveFile();
	state.lastSuggestedCode = null;
	dom.applyBtn.disabled = true;
	createMessage("system", "Предложенные изменения применены и сохранены.");
}

async function loadHealth() {
	const payload = await fetchJson("/api/health");
	const configured = payload.yandex_configured ? "YandexGPT: configured" : "YandexGPT: not configured";
	setStatus(`${configured} | RAG chunks: ${payload.rag_chunks}`);
}

function initMonaco() {
	return new Promise(resolve => {
		window.require.config({
			paths: {
				vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs",
			},
		});
		window.require(["vs/editor/editor.main"], () => {
			state.editor = window.monaco.editor.create(document.getElementById("editor"), {
				value: "",
				language: "plaintext",
				theme: "vs-dark",
				automaticLayout: true,
				fontSize: 13,
				minimap: { enabled: false },
			});
			resolve();
		});
	});
}

function wireUi() {
	dom.fileFilter.addEventListener("input", applyFilter);
	dom.saveBtn.addEventListener("click", () => saveFile().catch(showRuntimeError));
	dom.reindexBtn.addEventListener("click", () => reindex().catch(showRuntimeError));
	dom.sendBtn.addEventListener("click", () => sendChat().catch(showRuntimeError));
	dom.applyBtn.addEventListener("click", () => applySuggestedChange().catch(showRuntimeError));
	dom.chatInput.addEventListener("keydown", event => {
		if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			sendChat().catch(showRuntimeError);
		}
	});
}

function showRuntimeError(error) {
	const message = error instanceof Error ? error.message : String(error);
	createMessage("system", message);
	setStatus("Error");
}

async function bootstrap() {
	wireUi();
	await initMonaco();
	await Promise.all([loadHealth(), loadFiles()]);
	if (state.files.length > 0) {
		await openFile(state.files[0]);
	}
}

bootstrap().catch(showRuntimeError);
