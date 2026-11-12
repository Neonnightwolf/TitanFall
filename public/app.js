const state = { role: 'host', socket: null, room: '', name: '', id: '' };
const $ = (selector) => document.querySelector(selector);
const onboarding = $('#onboarding');
const app = $('#app');
const messages = $('#messages');
const members = $('#members');

document.querySelectorAll('.role-option').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.role-option').forEach((item) => item.classList.remove('active'));
  button.classList.add('active'); state.role = button.dataset.role;
}));

$('#join-form').addEventListener('submit', (event) => {
  event.preventDefault();
  state.name = $('#name-input').value.trim(); state.room = $('#room-input').value.trim().toUpperCase();
  if (!state.name || !state.room) return;
  state.socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  setConnection('LINKING…', false);
  state.socket.addEventListener('open', () => state.socket.send(JSON.stringify({ type: 'join', name: state.name, room: state.room, role: state.role })));
  state.socket.addEventListener('message', (event) => handlePacket(JSON.parse(event.data)));
  state.socket.addEventListener('close', () => setConnection('LINK LOST', false));
  state.socket.addEventListener('error', () => setConnection('LINK ERROR', false));
});

function handlePacket(packet) {
  if (packet.type === 'error') { setConnection(packet.message, false); return; }
  if (packet.type === 'joined') {
    state.id = packet.self.id; onboarding.classList.add('hidden'); app.classList.remove('hidden');
    $('#room-display').textContent = packet.room; $('#role-badge').textContent = state.role === 'host' ? 'HOST // RECEIVER' : 'VISITOR // SENDER';
    $('#chat-eyebrow').textContent = state.role === 'host' ? 'RECEIVER STATION' : 'SENDER STATION';
    setConnection('LINK ESTABLISHED', true); renderMembers(packet.members); return;
  }
  if (packet.type === 'presence') { renderMembers(packet.members); addSystem(`${packet.event.name} ${packet.event.kind === 'join' ? 'joined the channel' : 'disconnected'}.`); return; }
  if (packet.type === 'chat') addMessage(packet);
}

function setConnection(label, online) { $('#connection-label').textContent = label; document.querySelector('.connection .pulse').style.background = online ? 'var(--lime)' : 'var(--orange)'; }
function renderMembers(list) { $('#member-count').textContent = list.length; members.innerHTML = list.map((member) => `<div class="member ${member.role}"><span class="member-dot">${escapeHtml(member.name[0].toUpperCase())}</span><div class="member-info"><div class="member-name">${escapeHtml(member.name)}${member.id === state.id ? ' (YOU)' : ''}</div><div class="member-role">${member.role === 'host' ? 'HOST / RECEIVER' : 'VISITOR / SENDER'}</div></div></div>`).join(''); }
function addSystem(text) { const item = document.createElement('div'); item.className = 'system-message'; item.innerHTML = `<span class="message-tag">SYSTEM</span><p>${escapeHtml(text)}</p><time>NOW</time>`; messages.appendChild(item); messages.scrollTop = messages.scrollHeight; }
function addMessage(packet) { const mine = packet.from.id === state.id; const item = document.createElement('div'); item.className = `message ${mine ? 'mine' : ''}`; item.innerHTML = `<div class="message-meta"><span>${escapeHtml(packet.from.name)}</span><span class="role">${packet.from.role === 'host' ? 'HOST' : 'VISITOR'}</span><time>${new Date(packet.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div><div class="message-body">${escapeHtml(packet.text)}</div>`; messages.appendChild(item); messages.scrollTop = messages.scrollHeight; }
function escapeHtml(value) { return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }

$('#message-form').addEventListener('submit', (event) => { event.preventDefault(); const input = $('#message-input'); const text = input.value.trim(); if (!text || !state.socket || state.socket.readyState !== WebSocket.OPEN) return; state.socket.send(JSON.stringify({ type: 'chat', text })); input.value = ''; $('#char-count').textContent = '0 / 500'; input.focus(); });
$('#message-input').addEventListener('input', (event) => { $('#char-count').textContent = `${event.target.value.length} / 500`; });
$('#copy-room').addEventListener('click', async () => { await navigator.clipboard?.writeText(state.room); const button = $('#copy-room'); button.textContent = '✓'; setTimeout(() => button.textContent = '⧉', 1300); });
$('#leave-button').addEventListener('click', () => { state.socket?.close(); location.reload(); });
