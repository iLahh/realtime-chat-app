// ============================================================
// === CONSTANTS & CONFIG ===

const RAILWAY_HOST = 'realtime-chat-app-production-47b4.up.railway.app';

function getBackendBase() {
  if (window.location.protocol === 'file:') return 'http://localhost:8080';
  if (window.location.host === 'localhost:8080' || window.location.host === '127.0.0.1:8080') return '';
  return `https://${RAILWAY_HOST}`;
}

// ============================================================
// === STATE ===

const state = {
  currentUser: { 
    id: sessionStorage.getItem('userId') || generateId(), 
    name: localStorage.getItem('userName') || '' 
  },
  rooms: {},
  activeRoom: null,
  typingTimers: {}
};

let currentAttachedFile = null;

// ============================================================
// === DOM ELEMENTS ===

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

// ============================================================
// === UTILITY FUNCTIONS ===

function generateId() {
  const id = 'user-' + Math.random().toString(36).substr(2, 6);
  sessionStorage.setItem('userId', id);
  return id;
}

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

function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function scrollToBottom() {
  els.chatBody.scrollTop = els.chatBody.scrollHeight;
}

// ============================================================
// === WEBSOCKET & ROOM MANAGEMENT ===

function joinRoom(roomId) {
  if (state.rooms[roomId]) {
    if (state.rooms[roomId].username !== state.currentUser.name) {
      if (state.rooms[roomId].ws) {
        state.rooms[roomId].ws.close();
      }
      delete state.rooms[roomId];
    } else {
      openRoom(roomId);
      return;
    }
  }
  
  let wsBase;
  if (window.location.protocol === 'file:') {
    wsBase = 'ws://localhost:8080';
  } else if (window.location.host === 'localhost:8080' || window.location.host === '127.0.0.1:8080') {
    wsBase = `ws://${window.location.host}`;
  } else {
    wsBase = `wss://${RAILWAY_HOST}`;
  }
  const wsUrl = `${wsBase}/ws?user_id=${encodeURIComponent(state.currentUser.id)}&username=${encodeURIComponent(state.currentUser.name)}&room_id=${encodeURIComponent(roomId)}`;
  
  const ws = new WebSocket(wsUrl);
  
  state.rooms[roomId] = { ws, messages: [], unread: 0, online: 0, username: state.currentUser.name };
  saveStateToStorage();
  
  ws.onmessage = (e) => {
    try {
      handleWSMessage(roomId, JSON.parse(e.data));
    } catch(err) {
      console.error("Invalid JSON:", err);
    }
  };
  
  ws.onclose = () => {
    console.log(`Disconnected from ${roomId}. Reconnecting in 3s...`);
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
  saveStateToStorage();
  
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

function deleteRoom(e, roomId) {
  e.stopPropagation();
  
  if (!confirm(`Apakah Anda yakin ingin menghapus/keluar dari room "${roomId}"?`)) {
    return;
  }
  
  if (state.rooms[roomId]) {
    if (state.rooms[roomId].ws) {
      state.rooms[roomId].ws.close();
    }
    delete state.rooms[roomId];
  }
  
  if (state.activeRoom === roomId) {
    state.activeRoom = null;
    els.chatArea.style.display = 'none';
    els.mainEmpty.style.display = 'flex';
    document.querySelector('.main-area').classList.remove('active');
  }
  
  saveStateToStorage();
  renderRooms();
}

function saveStateToStorage() {
  const roomIds = Object.keys(state.rooms);
  localStorage.setItem('joinedRooms', JSON.stringify(roomIds));
  localStorage.setItem('activeRoom', state.activeRoom || '');
}

function restoreRooms() {
  const storedRooms = localStorage.getItem('joinedRooms');
  const storedActiveRoom = localStorage.getItem('activeRoom');
  
  if (storedRooms) {
    try {
      const roomIds = JSON.parse(storedRooms);
      if (Array.isArray(roomIds) && roomIds.length > 0) {
        if (state.currentUser.name) {
          els.nameInput.value = state.currentUser.name;
        }
        
        roomIds.forEach(roomId => {
          joinRoom(roomId);
        });
        
        if (storedActiveRoom && roomIds.includes(storedActiveRoom)) {
          openRoom(storedActiveRoom);
        }
      }
    } catch (e) {
      console.error("Failed to restore rooms from localStorage:", e);
    }
  }
}

// ============================================================
// === RENDER FUNCTIONS ===

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
            <div class="room-top-right">
              <span class="room-time">${time}</span>
              <div class="room-menu-container">
                <button class="room-menu-btn" onclick="toggleRoomMenu(event, '${id}')" title="Options">
                  <svg viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
                </button>
                <div class="room-dropdown" id="dropdown-${id}">
                  <button class="dropdown-item delete" onclick="deleteRoom(event, '${id}')">
                    <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                    <span>Hapus Chat</span>
                  </button>
                </div>
              </div>
            </div>
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
    const fileUrl = m.file_url.startsWith('/') ? getBackendBase() + m.file_url : m.file_url;
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

function toggleRoomMenu(e, roomId) {
  e.stopPropagation();
  
  const allDropdowns = document.querySelectorAll('.room-dropdown');
  allDropdowns.forEach(d => {
    if (d.id !== `dropdown-${roomId}`) {
      d.classList.remove('active');
      if (d.parentElement) {
        d.parentElement.classList.remove('active');
      }
    }
  });
  
  const dropdown = document.getElementById(`dropdown-${roomId}`);
  if (dropdown) {
    const isActive = dropdown.classList.toggle('active');
    if (dropdown.parentElement) {
      dropdown.parentElement.classList.toggle('active', isActive);
    }
  }
}

// ============================================================
// === TYPING INDICATOR ===

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

// ============================================================
// === MESSAGE SENDING ===

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
      const endpoint = getBackendBase() + '/upload';
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
  
  els.messageInput.value = '';
  els.messageInput.style.height = 'auto';
  currentAttachedFile = null;
  els.fileInput.value = '';
  els.attachedFilePreview.classList.remove('active');
  els.sendBtn.style.opacity = '1';
  els.sendBtn.disabled = false;
  
  ws.send(JSON.stringify({
    type: 'typing',
    room_id: state.activeRoom,
    user_id: state.currentUser.id,
    username: state.currentUser.name,
    typing: false
  }));
}

// ============================================================
// === EVENT LISTENERS ===

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
  
  const nameChanged = state.currentUser.name !== name;
  state.currentUser.name = name;
  localStorage.setItem('userName', name);
  
  if (nameChanged) {
    const existingRoomIds = Object.keys(state.rooms);
    existingRoomIds.forEach(id => {
      if (state.rooms[id].ws) {
        state.rooms[id].ws.close();
      }
      delete state.rooms[id];
      joinRoom(id);
    });
    if (!existingRoomIds.includes(roomId)) {
      joinRoom(roomId);
    }
  } else {
    joinRoom(roomId);
  }
  
  els.joinModal.classList.remove('active');
  els.roomInput.value = '';
};

els.backBtn.onclick = () => {
  document.querySelector('.main-area').classList.remove('active');
  state.activeRoom = null;
  saveStateToStorage();
  renderRooms();
};

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

document.addEventListener('click', () => {
  const allDropdowns = document.querySelectorAll('.room-dropdown');
  allDropdowns.forEach(d => {
    d.classList.remove('active');
    if (d.parentElement) {
      d.parentElement.classList.remove('active');
    }
  });
});

// ============================================================
// === INIT ===

restoreRooms();
