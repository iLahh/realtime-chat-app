// State Management
const state = {
  currentUser: { 
    id: sessionStorage.getItem('userId') || generateId(), 
    name: localStorage.getItem('userName') || '' 
  },
  rooms: {}, // { [roomId]: { ws, messages: [], unread: 0, online: 0 } }
  activeRoom: null,
  typingTimers: {}
};

function generateId() {
  const id = 'user-' + Math.random().toString(36).substr(2, 6);
  sessionStorage.setItem('userId', id);
  return id;
}

// DOM Elements
const els = {
  roomList: document.getElementById('roomList'),
  emptySidebar: document.getElementById('emptySidebar'),
  fab: document.getElementById('fab'),
  joinModal: document.getElementById('joinModal'),
  roomInput: document.getElementById('roomInput'),
  nameInput: document.getElementById('nameInput'),
  joinForm: document.getElementById('joinForm'),
  btnCancel: document.getElementById('btnCancel'),
  
  mainEmpty: document.getElementById('mainEmpty'),
  chatArea: document.getElementById('chatArea'),
  chatHeaderAvatar: document.getElementById('chatHeaderAvatar'),
  chatHeaderName: document.getElementById('chatHeaderName'),
  chatHeaderOnline: document.getElementById('chatHeaderOnline'),
  chatBody: document.getElementById('chatBody'),
  messagesContainer: document.getElementById('messagesContainer'),
  backBtn: document.getElementById('backBtn'),
  
  messageInput: document.getElementById('messageInput'),
  sendBtn: document.getElementById('sendBtn'),
  fileInput: document.getElementById('fileInput'),
  attachBtn: document.getElementById('attachBtn'),
  attachedFilePreview: document.getElementById('attachedFilePreview'),
  attachedFilename: document.getElementById('attachedFilename'),
  removeFileBtn: document.getElementById('removeFileBtn'),
  
  typingContainer: document.getElementById('typingContainer'),
  typingText: document.getElementById('typingText')
};

let currentAttachedFile = null;

// Initialization
// els.nameInput.value = state.currentUser.name;

// Modal Events
els.fab.onclick = () => {
  els.joinModal.classList.add('active');
  els.roomInput.value = '';
  els.nameInput.value = '';
  els.roomInput.focus();
};

els.btnCancel.onclick = () => {
  els.joinModal.classList.remove('active');
};

els.joinModal.onclick = (e) => {
  if(e.target === els.joinModal) els.joinModal.classList.remove('active');
};

document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape') els.joinModal.classList.remove('active');
});

els.joinForm.onsubmit = (e) => {
  e.preventDefault();
  const roomId = els.roomInput.value.trim().toLowerCase();
  const name = els.nameInput.value.trim();
  if (!roomId || !name) return;
  
  state.currentUser.name = name;
  localStorage.setItem('userName', name);
  
  joinRoom(roomId);
  els.joinModal.classList.remove('active');
  els.roomInput.value = '';
};

// Mobile Back Button
els.backBtn.onclick = () => {
  document.querySelector('.main-area').classList.remove('active');
  state.activeRoom = null;
  renderRooms();
};

// WebSocket Logic
function joinRoom(roomId) {
  if (state.rooms[roomId]) {
    openRoom(roomId);
    return;
  }
  
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host || 'localhost:8080';
  // Fallback local websocket if file is opened directly (file://)
  const wsUrl = `${window.location.protocol === 'file:' ? 'ws://localhost:8080' : wsProtocol + '//' + host}/ws?user_id=${encodeURIComponent(state.currentUser.id)}&username=${encodeURIComponent(state.currentUser.name)}&room_id=${encodeURIComponent(roomId)}`;
  
  const ws = new WebSocket(wsUrl);
  
  state.rooms[roomId] = { ws, messages: [], unread: 0, online: 0 };
  
  ws.onmessage = (e) => {
    try {
      handleWSMessage(roomId, JSON.parse(e.data));
    } catch(err) {
      console.error("Invalid JSON:", err);
    }
  };
  
  ws.onclose = () => {
    console.log(`Disconnected from ${roomId}. Reconnecting in 3s...`);
    // Simple auto-reconnect
    setTimeout(() => {
      if(state.rooms[roomId]) {
        delete state.rooms[roomId];
        joinRoom(roomId);
      }
    }, 3000);
  };
  
  openRoom(roomId);
  renderRooms();
}

function handleWSMessage(roomId, payload) {
  const room = state.rooms[roomId];
  if (!room) return;
  
  switch(payload.type) {
    case 'history':
      if (payload.history) {
        room.messages = payload.history;
      }
      break;
    case 'message':
      room.messages.push(payload);
      if (state.activeRoom !== roomId) {
        room.unread++;
      }
      break;
    case 'system':
      payload.isSystem = true;
      room.messages.push(payload);
      break;
    case 'online_users':
      room.online = payload.online_users ? payload.online_users.length : 0;
      if (state.activeRoom === roomId) {
        els.chatHeaderOnline.textContent = `${room.online} online`;
      }
      break;
    case 'typing':
      if (payload.user_id !== state.currentUser.id && state.activeRoom === roomId) {
        if(payload.typing) {
           showTyping(payload.username);
        } else {
           hideTyping();
        }
      }
      break;
  }
  
  renderRooms();
  if (state.activeRoom === roomId) {
    if (payload.type === 'history') {
      renderMessages(true);
    } else if (payload.type === 'message' || payload.type === 'system') {
      appendMessage(payload);
    }
  }
}

function openRoom(roomId) {
  state.activeRoom = roomId;
  if(state.rooms[roomId]) {
     state.rooms[roomId].unread = 0;
  }
  
  els.mainEmpty.style.display = 'none';
  els.chatArea.style.display = 'flex';
  document.querySelector('.main-area').classList.add('active');
  
  const avatarColor = hashStringToColor(roomId);
  els.chatHeaderAvatar.style.background = avatarColor;
  els.chatHeaderAvatar.textContent = roomId.charAt(0).toUpperCase();
  
  els.chatHeaderName.textContent = roomId;
  els.chatHeaderOnline.textContent = state.rooms[roomId] ? `${state.rooms[roomId].online} online` : '...';
  
  renderMessages(true);
  renderRooms();
  
  setTimeout(() => els.messageInput.focus(), 100);
}

// UI Renderers
function hashStringToColor(str) {
  let hash = 0;
  for(let i=0; i<str.length; i++){
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash % 360);
  return `hsl(${h}, 70%, 45%)`;
}

function formatTime(d) {
  if(!d) d = new Date();
  else d = new Date(d);
  return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
}

function renderRooms() {
  const roomIds = Object.keys(state.rooms);
  if (roomIds.length === 0) {
    els.emptySidebar.style.display = 'block';
    els.roomList.innerHTML = '';
    return;
  }
  els.emptySidebar.style.display = 'none';
  
  els.roomList.innerHTML = roomIds.map(id => {
    const r = state.rooms[id];
    const lastMsg = r.messages.length > 0 ? r.messages[r.messages.length-1] : null;
    const preview = lastMsg ? (lastMsg.isSystem ? lastMsg.content : (lastMsg.content || lastMsg.file_name || 'Attached file')) : 'No messages yet';
    const time = lastMsg ? formatTime(lastMsg.timestamp) : '';
    const avatarColor = hashStringToColor(id);
    const initial = id.charAt(0).toUpperCase();
    
    return `
      <div class="room-item ${state.activeRoom === id ? 'active' : ''}" onclick="openRoom('${id}')">
        <div class="room-avatar" style="background: ${avatarColor}">${initial}</div>
        <div class="room-info">
          <div class="room-top">
            <span class="room-name">${id}</span>
            <span class="room-time">${time}</span>
          </div>
          <div class="room-bottom">
            <span class="room-preview">${escapeHtml(preview)}</span>
            ${r.unread > 0 ? `<span class="unread-badge">${r.unread}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderMessages(forceScroll = false) {
  if (!state.activeRoom || !state.rooms[state.activeRoom]) return;
  const msgs = state.rooms[state.activeRoom].messages;
  els.messagesContainer.innerHTML = msgs.map(m => buildMessageHTML(m)).join('');
  if (forceScroll) scrollToBottom();
}

function appendMessage(m) {
  els.messagesContainer.insertAdjacentHTML('beforeend', buildMessageHTML(m));
  scrollToBottom();
}

function buildMessageHTML(m) {
  if (m.isSystem) {
    return `<div class="system-msg"><span>${escapeHtml(m.content)}</span></div>`;
  }
  
  const isMine = m.user_id === state.currentUser.id;
  const isAI = m.user_id === 'ai-bot' || m.username === 'AI Assistant';
  
  let contentHtml = `<div class="message-content ${isAI ? 'ai-text' : ''}">${escapeHtml(m.content)}</div>`;
  
  if (m.file_url) {
    const fileUrl = m.file_url.startsWith('/') ? (window.location.protocol === 'file:' ? 'http://localhost:8080' : '') + m.file_url : m.file_url;
    const isImg = /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(fileUrl);
    if (isImg) {
      contentHtml = `<img src="${fileUrl}" class="file-preview" alt="image" />` + contentHtml;
    } else {
      contentHtml = `<a href="${fileUrl}" class="file-link" target="_blank">
        <svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
        <span>${escapeHtml(m.file_name || 'Attachment')}</span>
      </a>` + contentHtml;
    }
  }
  
  const senderColor = hashStringToColor(m.username || 'Unknown');
  let senderHtml = '';
  if (!isMine && !isAI) {
    senderHtml = `<div class="sender-name" style="color: ${senderColor}">${escapeHtml(m.username)}</div>`;
  } else if (isAI) {
    senderHtml = `<div class="ai-sender">✨ AI Assistant</div>`;
  }
  
  const ticks = isMine ? `<span class="read-receipt sent"><svg viewBox="0 0 24 24"><path d="M18 6l-7 9-3-3M22 6l-7 9-3-3" /></svg></span>` : '';
  const wrapperClass = isMine ? 'out' : 'in';
  const bubbleClass = isMine ? 'out' : (isAI ? 'in ai' : 'in');
  
  return `
    <div class="message-wrapper ${wrapperClass}">
      <div class="message-bubble ${bubbleClass}">
        ${senderHtml}
        ${contentHtml}
        <div class="message-footer">
          <span>${formatTime(m.timestamp)}</span>
          ${ticks}
        </div>
      </div>
    </div>
  `;
}

function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function scrollToBottom() {
  els.chatBody.scrollTop = els.chatBody.scrollHeight;
}

let typingTimerId = null;
function showTyping(name) {
  els.typingText.textContent = `${name} is typing`;
  els.typingContainer.style.display = 'flex';
  scrollToBottom();
  
  clearTimeout(typingTimerId);
  typingTimerId = setTimeout(() => {
    hideTyping();
  }, 3000);
}
function hideTyping() {
  els.typingContainer.style.display = 'none';
}

// Input & Sending Logic
els.messageInput.addEventListener('input', () => {
  els.messageInput.style.height = 'auto';
  els.messageInput.style.height = (els.messageInput.scrollHeight < 120 ? els.messageInput.scrollHeight : 120) + 'px';
  
  if (state.activeRoom && state.rooms[state.activeRoom]) {
    if(state.rooms[state.activeRoom].ws.readyState === WebSocket.OPEN) {
      state.rooms[state.activeRoom].ws.send(JSON.stringify({
        type: 'typing',
        room_id: state.activeRoom,
        user_id: state.currentUser.id,
        username: state.currentUser.name,
        typing: true
      }));
    }
  }
});

els.messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

els.sendBtn.onclick = sendMessage;

// File Attachments
els.attachBtn.onclick = () => els.fileInput.click();
els.fileInput.onchange = (e) => {
  const file = e.target.files[0];
  if (file) {
    currentAttachedFile = file;
    els.attachedFilename.textContent = file.name;
    els.attachedFilePreview.classList.add('active');
  }
};
els.removeFileBtn.onclick = () => {
  currentAttachedFile = null;
  els.fileInput.value = '';
  els.attachedFilePreview.classList.remove('active');
};

async function sendMessage() {
  if (!state.activeRoom || !state.rooms[state.activeRoom]) return;
  const ws = state.rooms[state.activeRoom].ws;
  if (ws.readyState !== WebSocket.OPEN) return;

  const content = els.messageInput.value.trim();
  const file = currentAttachedFile;
  
  if (!content && !file) return;
  
  let fileUrl = '';
  let fileName = '';
  
  if (file) {
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      els.sendBtn.style.opacity = '0.5';
      els.sendBtn.disabled = true;
      const endpoint = window.location.protocol === 'file:' ? 'http://localhost:8080/upload' : '/upload';
      const res = await fetch(endpoint, { method: 'POST', body: formData });
      const json = await res.json();
      if (json.data && json.data.file_url) {
        fileUrl = json.data.file_url;
        fileName = json.data.file_name;
      }
    } catch(err) {
      alert("Failed to upload file");
      els.sendBtn.style.opacity = '1';
      els.sendBtn.disabled = false;
      return;
    }
  }
  
  ws.send(JSON.stringify({
    type: 'message',
    content: content,
    file_url: fileUrl,
    file_name: fileName
  }));
  
  // Reset inputs
  els.messageInput.value = '';
  els.messageInput.style.height = 'auto';
  currentAttachedFile = null;
  els.fileInput.value = '';
  els.attachedFilePreview.classList.remove('active');
  els.sendBtn.style.opacity = '1';
  els.sendBtn.disabled = false;
  
  // Stop typing
  ws.send(JSON.stringify({
    type: 'typing',
    room_id: state.activeRoom,
    user_id: state.currentUser.id,
    username: state.currentUser.name,
    typing: false
  }));
}
