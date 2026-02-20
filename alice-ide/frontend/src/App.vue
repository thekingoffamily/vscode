<template>
  <div class="alice-ide">
    <header class="header">
      <div class="logo">
        <span class="logo-icon">🅰</span>
        <h1>Alice IDE</h1>
        <span class="subtitle">на базе YandexGPT</span>
      </div>
      <div class="header-actions">
        <button
          class="btn btn-ghost"
          @click="syncEditorToContext"
          :title="'Включить код в контекст (' + (includeCode ? 'вкл' : 'выкл') + ')'"
        >
          {{ includeCode ? '📄' : '📄' }} {{ includeCode ? 'Контекст вкл' : 'Контекст выкл' }}
        </button>
      </div>
    </header>

    <main class="main">
      <section class="editor-panel">
        <div class="panel-header">
          <span>Редактор кода</span>
          <select v-model="language" class="lang-select">
            <option value="python">Python</option>
            <option value="javascript">JavaScript</option>
            <option value="typescript">TypeScript</option>
            <option value="html">HTML</option>
            <option value="css">CSS</option>
            <option value="json">JSON</option>
          </select>
        </div>
        <div ref="editorContainer" class="editor-container"></div>
      </section>

      <section class="chat-panel">
        <div class="panel-header">
          <span>💬 Чат с Алисой</span>
        </div>
        <div class="chat-messages" ref="messagesContainer">
          <div v-if="messages.length === 0" class="welcome">
            <p>Привет! Я Алиса — AI-помощник для программирования.</p>
            <p>Спроси меня о коде, попроси исправить ошибку или сгенерировать новый код.</p>
            <p class="hint">Выделите код в редакторе и спросите — он будет добавлен в контекст.</p>
          </div>
          <div
            v-for="(msg, i) in messages"
            :key="i"
            :class="['message', msg.role]"
          >
            <div class="message-role">{{ msg.role === 'user' ? 'Вы' : 'Алиса' }}</div>
            <div class="message-content" v-html="renderMarkdown(msg.content)"></div>
            <div v-if="msg.codeBlock" class="message-actions">
              <button class="btn btn-sm btn-primary" @click="applyCode(msg.codeBlock)">
                Применить изменения
              </button>
            </div>
          </div>
          <div v-if="isStreaming" class="message assistant">
            <div class="message-role">Алиса</div>
            <div class="message-content">
              <span v-html="renderMarkdown(streamingContent)"></span>
              <span class="cursor">▋</span>
            </div>
          </div>
        </div>
        <div class="chat-input-area">
          <textarea
            v-model="inputMessage"
            placeholder="Спросите Алису о коде..."
            rows="2"
            @keydown.enter.exact.prevent="sendMessage"
            @keydown.enter.shift.prevent="inputMessage += '\n'"
          />
          <button
            class="btn btn-primary send-btn"
            @click="sendMessage"
            :disabled="isStreaming || !inputMessage.trim()"
          >
            Отправить
          </button>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick, watch } from 'vue'
import * as monaco from 'monaco-editor'
import { marked } from 'marked'

const API_BASE = '/api'

const editorContainer = ref(null)
const messagesContainer = ref(null)
let editor = null

const language = ref('python')
const inputMessage = ref('')
const messages = ref([])
const isStreaming = ref(false)
const streamingContent = ref('')
const includeCode = ref(true)

const defaultCode = `def factorial(n):
    """Вычисляет факториал числа n."""
    if n <= 1:
        return 1
    return n * factorial(n - 1)

# Пример использования
print(factorial(5))  # 120
`

onMounted(() => {
  editor = monaco.editor.create(editorContainer.value, {
    value: defaultCode,
    language: language.value,
    theme: 'vs-dark',
    fontSize: 14,
    minimap: { enabled: true },
    automaticLayout: true,
    wordWrap: 'on',
  })
})

watch(language, (lang) => {
  if (editor) {
    const model = editor.getModel()
    if (model) monaco.editor.setModelLanguage(model, lang)
  }
})

function getCodeContext() {
  if (!editor || !includeCode.value) return null
  const selection = editor.getSelection()
  const model = editor.getModel()
  if (selection && !selection.isEmpty()) {
    return model.getValueInRange(selection)
  }
  return model.getValue()
}

function syncEditorToContext() {
  includeCode.value = !includeCode.value
}

function extractCodeBlock(text) {
  const match = text.match(/```(?:[\w]*)\n?([\s\S]*?)```/)
  return match ? match[1].trim() : null
}

function renderMarkdown(text) {
  if (!text) return ''
  return marked.parse(text || '', { breaks: true })
}

async function sendMessage() {
  const msg = inputMessage.value.trim()
  if (!msg || isStreaming.value) return

  messages.value.push({ role: 'user', content: msg })
  inputMessage.value = ''
  isStreaming.value = true
  streamingContent.value = ''

  const codeContext = getCodeContext()
  const chatHistory = messages.value.slice(0, -1).map(m => ({
    role: m.role,
    content: m.content,
  }))

  try {
    const res = await fetch(`${API_BASE}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: msg,
        code_context: codeContext,
        chat_history: chatHistory,
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(err.detail || 'Ошибка API')
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6)
          if (data !== '[DONE]' && data !== '') {
            streamingContent.value += data
          }
        }
      }
    }
    if (buffer.startsWith('data: ')) {
      streamingContent.value += buffer.slice(6)
    }

    const fullContent = streamingContent.value
    const codeBlock = extractCodeBlock(fullContent)

    messages.value.push({
      role: 'assistant',
      content: fullContent,
      codeBlock,
    })
  } catch (e) {
    messages.value.push({
      role: 'assistant',
      content: `❌ Ошибка: ${e.message}. Убедитесь, что бэкенд запущен и настроены YANDEX_API_KEY и YANDEX_FOLDER_ID.`,
    })
  } finally {
    isStreaming.value = false
    streamingContent.value = ''
    nextTick(() => {
      messagesContainer.value?.scrollTo({ top: messagesContainer.value.scrollHeight })
    })
  }
}

function applyCode(code) {
  if (!editor || !code) return
  const selection = editor.getSelection()
  const model = editor.getModel()
  const range = selection && !selection.isEmpty()
    ? selection
    : model.getFullModelRange()
  editor.executeEdits('alice-apply', [{ range, text: code }])
}
</script>

<style scoped>
.alice-ide {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
}

.logo {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.logo-icon {
  font-size: 1.5rem;
}

.logo h1 {
  font-size: 1.25rem;
  font-weight: 600;
}

.subtitle {
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin-left: 0.25rem;
}

.header-actions {
  display: flex;
  gap: 0.5rem;
}

.main {
  display: flex;
  flex: 1;
  min-height: 0;
}

.editor-panel,
.chat-panel {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
}

.editor-panel {
  flex: 1;
  min-width: 400px;
}

.chat-panel {
  width: 420px;
  flex-shrink: 0;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 1rem;
  background: var(--bg-tertiary);
  font-size: 0.875rem;
}

.lang-select {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  color: var(--text-primary);
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
}

.editor-container {
  flex: 1;
  min-height: 0;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.welcome {
  color: var(--text-secondary);
  font-size: 0.9rem;
  line-height: 1.6;
}

.welcome .hint {
  margin-top: 1rem;
  font-size: 0.8rem;
  color: var(--accent);
}

.message {
  padding: 0.75rem 1rem;
  border-radius: 8px;
  background: var(--bg-secondary);
}

.message.user {
  background: var(--bg-tertiary);
  margin-left: 2rem;
}

.message.assistant {
  margin-right: 2rem;
}

.message-role {
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin-bottom: 0.25rem;
}

.message-content {
  font-size: 0.875rem;
  line-height: 1.5;
}

.message-content :deep(pre) {
  background: var(--bg-primary);
  padding: 0.75rem;
  border-radius: 4px;
  overflow-x: auto;
  margin: 0.5rem 0;
}

.message-content :deep(code) {
  background: var(--bg-primary);
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
}

.cursor {
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  50% { opacity: 0; }
}

.message-actions {
  margin-top: 0.5rem;
}

.chat-input-area {
  padding: 1rem;
  border-top: 1px solid var(--border);
  background: var(--bg-secondary);
}

.chat-input-area textarea {
  width: 100%;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-primary);
  padding: 0.75rem 1rem;
  font-size: 0.875rem;
  font-family: inherit;
  resize: none;
  margin-bottom: 0.5rem;
}

.chat-input-area textarea:focus {
  outline: none;
  border-color: var(--accent);
}

.btn {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  font-size: 0.875rem;
  cursor: pointer;
  border: none;
  font-family: inherit;
}

.btn-ghost {
  background: transparent;
  color: var(--text-secondary);
}

.btn-ghost:hover {
  color: var(--text-primary);
}

.btn-primary {
  background: var(--accent);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-sm {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
}

.send-btn {
  width: 100%;
}
</style>
