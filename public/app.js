const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const formEl = document.getElementById('composer');
const sendBtn = document.getElementById('send');
const sessionListEl = document.getElementById('sessionList');
const newChatBtn = document.getElementById('newChat');
const titleEl = document.getElementById('sessionTitle');

let currentSessionId = localStorage.getItem('sessionId') || '';
let isSending = false;

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderMarkdown(text) {
  try {
    return window.marked ? window.marked.parse(text) : escapeHtml(text).replace(/\n/g, '<br>');
  } catch {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }
}

function addMessage(role, content, toolEvents = []) {
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  let html = `<div class="role">${role === 'user' ? 'You' : 'Assistant'}</div>`;
  html += `<div class="content">${renderMarkdown(content || '')}</div>`;
  for (const ev of toolEvents) {
    html += `<div class="tool">${escapeHtml(ev)}</div>`;
  }
  div.innerHTML = html;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

async function loadSessions() {
  const res = await fetch('/api/sessions');
  const data = await res.json();
  sessionListEl.innerHTML = '';
  for (const s of data.sessions) {
    const item = document.createElement('div');
    item.className = 'session-item' + (s.id === currentSessionId ? ' active' : '');
    item.textContent = s.title;
    item.onclick = () => selectSession(s.id, s.title);
    sessionListEl.appendChild(item);
  }
}

async function selectSession(id, title) {
  currentSessionId = id;
  localStorage.setItem('sessionId', id);
  titleEl.textContent = title || 'Chat';
  messagesEl.innerHTML = '';
  const res = await fetch(`/api/sessions/${id}/messages`);
  const data = await res.json();
  for (const m of data.messages) {
    addMessage(m.role === 'user' ? 'user' : 'assistant', m.content);
  }
  loadSessions();
}

newChatBtn.onclick = async () => {
  const res = await fetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'New chat' }) });
  const data = await res.json();
  currentSessionId = data.session.id;
  localStorage.setItem('sessionId', currentSessionId);
  messagesEl.innerHTML = '';
  titleEl.textContent = 'New chat';
  loadSessions();
};

async function sendMessage(text) {
  if (isSending) return;
  isSending = true;
  sendBtn.disabled = true;
  addMessage('user', text);
  const assistantDiv = addMessage('assistant', '');
  const contentEl = assistantDiv.querySelector('.content');
  const toolEvents = [];
  let full = '';

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: currentSessionId, message: text }),
    });
    if (!res.ok) throw new Error(await res.text());
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let payload;
        try { payload = JSON.parse(line.slice(6)); } catch { continue; }
        if (payload.type === 'text') {
          full += payload.delta;
          contentEl.innerHTML = renderMarkdown(full);
          messagesEl.scrollTop = messagesEl.scrollHeight;
        } else if (payload.type === 'tool_call') {
          const ev = `Searching: ${payload.input?.query || ''}`;
          toolEvents.push(ev);
          const toolDiv = document.createElement('div');
          toolDiv.className = 'tool';
          toolDiv.textContent = ev;
          assistantDiv.insertBefore(toolDiv, contentEl);
        } else if (payload.type === 'tool_result') {
          // no-op; final answer follows
        } else if (payload.type === 'done') {
          if (payload.sessionId && !currentSessionId) {
            currentSessionId = payload.sessionId;
            localStorage.setItem('sessionId', currentSessionId);
          }
          loadSessions();
        } else if (payload.type === 'error') {
          full += `\n\nError: ${payload.error}`;
          contentEl.innerHTML = renderMarkdown(full);
        }
      }
    }
  } catch (err) {
    full += `\n\nError: ${err.message}`;
    contentEl.innerHTML = renderMarkdown(full);
  } finally {
    isSending = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

formEl.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = '';
  inputEl.style.height = 'auto';
  sendMessage(text);
});

inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 180) + 'px';
});

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    formEl.requestSubmit();
  }
});

(async () => {
  if (!currentSessionId) {
    const res = await fetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'New chat' }) });
    const data = await res.json();
    currentSessionId = data.session.id;
    localStorage.setItem('sessionId', currentSessionId);
  }
  const res = await fetch(`/api/sessions/${currentSessionId}/messages`);
  if (res.ok) {
    const data = await res.json();
    titleEl.textContent = data.session.title;
    for (const m of data.messages) addMessage(m.role === 'user' ? 'user' : 'assistant', m.content);
  } else {
    currentSessionId = '';
    localStorage.removeItem('sessionId');
  }
  loadSessions();
})();
