(function () {
  // ========================
  // 1) Grab UI elements
  // ========================
  const roomGate = document.getElementById("roomGate");
  const chatApp = document.getElementById("chatApp");
  const joinForm = document.getElementById("joinForm");
  const roomInput = document.getElementById("roomInput");
  const joinRoomButton = document.getElementById("joinRoomButton");
  const gateStatus = document.getElementById("gateStatus");

  const roomTitle = document.getElementById("roomTitle");
  const activeRoomText = document.getElementById("activeRoomText");
  const statusText = document.getElementById("statusText");
  const chatBody = document.getElementById("chatBody");
  const emptyState = document.getElementById("emptyState");
  const onlineUsers = document.getElementById("onlineUsers");

  const messageInput = document.getElementById("messageInput");
  const sendButton = document.getElementById("sendButton");
  const fileInput = document.getElementById("fileInput");

  if (
    !roomGate || !chatApp || !joinForm || !roomInput || !joinRoomButton ||
    !roomTitle || !activeRoomText || !statusText || !chatBody || !onlineUsers
  ) {
    console.error("UI tidak lengkap. Coba hard refresh (Ctrl+F5).");
    return;
  }

  // ========================
  // 2) App state
  // ========================
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const userID = "u-" + Math.random().toString(36).slice(2, 8);
  const username = "User-" + userID.slice(-4);

  const state = {
    currentRoomID: "",
    socket: null,
    reconnectTimer: null,
    allowReconnect: true,
    typingTimer: null,
    typingSent: false,
  };

  // ========================
  // 3) Simple UI helpers
  // ========================
  function safelySetText(element, text) {
    if (!element) {
      return;
    }
    element.textContent = text;
  }

  function setGateStatus(text) {
    safelySetText(gateStatus, text);
  }

  function setStatus(text) {
    safelySetText(statusText, text);
  }

  function setRoomUI(roomID) {
    roomTitle.textContent = "Room #" + roomID;
    activeRoomText.textContent = "#" + roomID;
  }

  function scrollChatToBottom() {
    chatBody.scrollTop = chatBody.scrollHeight;
  }

  // ========================
  // 4) Render helpers
  // ========================
  function clearChat() {
    chatBody.querySelectorAll(".bubble").forEach((node) => node.remove());
    if (emptyState) {
      emptyState.style.display = "block";
    }
  }

  function setUsers(users) {
    onlineUsers.innerHTML = "";
    if (!Array.isArray(users) || users.length === 0) {
      const li = document.createElement("li");
      li.textContent = "No users online";
      onlineUsers.appendChild(li);
      return;
    }
    users.forEach((name) => {
      const li = document.createElement("li");
      li.textContent = name;
      onlineUsers.appendChild(li);
    });
  }

  function wsURL(roomID) {
    return (
      protocol + "://" + window.location.host +
      "/ws?user_id=" + encodeURIComponent(userID) +
      "&username=" + encodeURIComponent(username) +
      "&room_id=" + encodeURIComponent(roomID)
    );
  }

  function hideEmptyState() {
    if (emptyState) {
      emptyState.style.display = "none";
    }
  }

  function isImage(url) {
    return /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(url || "");
  }

  function appendMessage(name, content, fileURL, fileName, mine) {
    hideEmptyState();
    const wrap = document.createElement("article");
    wrap.className = "bubble " + (mine ? "bubble-me" : "bubble-other");

    const meta = document.createElement("p");
    meta.className = "meta";
    meta.textContent = name;
    wrap.appendChild(meta);

    if (content) {
      const body = document.createElement("p");
      body.textContent = content;
      wrap.appendChild(body);
    }

    if (fileURL) {
      if (isImage(fileURL)) {
        const img = document.createElement("img");
        img.src = fileURL;
        img.alt = fileName || "file";
        wrap.appendChild(img);
      } else {
        const a = document.createElement("a");
        a.className = "file-link";
        a.href = fileURL;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = "Download file: " + (fileName || "attachment");
        wrap.appendChild(a);
      }
    }

    chatBody.appendChild(wrap);
    scrollChatToBottom();
  }

  function appendSystem(text) {
    hideEmptyState();
    const wrap = document.createElement("article");
    wrap.className = "bubble bubble-system";
    wrap.innerHTML = '<p class="meta">System</p><p></p>';
    wrap.querySelectorAll("p")[1].textContent = text;
    chatBody.appendChild(wrap);
    scrollChatToBottom();
  }

  // ========================
  // 5) WebSocket helpers
  // ========================
  function closeSocket() {
    if (!state.socket) {
      return;
    }
    try {
      state.allowReconnect = false;
      state.socket.close();
    } catch (_) {
      // ignore
    }
    state.socket = null;
  }

  function connectRoom(roomID) {
    if (!roomID) {
      return;
    }

    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }

    closeSocket();
    state.allowReconnect = true;

    setStatus("Menyambungkan...");
    state.socket = new WebSocket(wsURL(roomID));

    state.socket.onopen = function () {
      setStatus("Terhubung sebagai " + username + " di #" + roomID);
    };

    state.socket.onmessage = function (event) {
      try {
        const payload = JSON.parse(event.data);
        switch (payload.type) {
          case "message":
            appendMessage(
              payload.username || "Unknown",
              payload.content || "",
              payload.file_url || "",
              payload.file_name || "",
              payload.user_id === userID
            );
            break;
          case "system":
            appendSystem(payload.content || "System event");
            break;
          case "online_users":
            setUsers(payload.online_users || []);
            break;
          case "typing":
            if (payload.user_id !== userID && payload.typing) {
              setStatus((payload.username || "Seseorang") + " sedang mengetik...");
            } else if (payload.user_id !== userID) {
              setStatus("Terhubung sebagai " + username + " di #" + roomID);
            }
            break;
          case "error":
            setStatus(payload.content || "Server error");
            break;
          default:
            break;
        }
      } catch (_) {
        setStatus("Format pesan tidak valid");
      }
    };

    state.socket.onclose = function () {
      if (!state.allowReconnect) {
        return;
      }
      setStatus("Koneksi terputus, mencoba ulang...");
      state.reconnectTimer = setTimeout(function () {
        connectRoom(state.currentRoomID);
      }, 1500);
    };

    state.socket.onerror = function () {
      setStatus("Koneksi websocket error");
    };
  }

  function sendTyping(value) {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    state.socket.send(JSON.stringify({ type: "typing", typing: value }));
  }

  // ========================
  // 6) Send message/file
  // ========================
  async function sendCurrentInput() {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
      setStatus("Belum terhubung ke room");
      return;
    }

    const text = messageInput ? messageInput.value.trim() : "";
    const file = fileInput && fileInput.files ? fileInput.files[0] : null;

    if (!text && !file) {
      setStatus("Tulis pesan atau pilih file terlebih dahulu");
      return;
    }

    if (file) {
      if (sendButton) {
        sendButton.disabled = true;
      }
      setStatus("Upload file...");
      try {
        const formData = new FormData();
        formData.append("file", file);
        const resp = await fetch("/upload", { method: "POST", body: formData });
        if (!resp.ok) {
          throw new Error("Upload gagal");
        }
        const result = await resp.json();
        const data = result.data || {};
        if (!data.file_url) {
          throw new Error("Respons upload tidak valid");
        }

        state.socket.send(JSON.stringify({
          type: "message",
          content: text,
          file_url: data.file_url,
          file_name: data.file_name || file.name
        }));
      } catch (err) {
        setStatus(err.message || "Gagal kirim file");
        return;
      } finally {
        if (sendButton) {
          sendButton.disabled = false;
        }
      }
    } else {
      state.socket.send(JSON.stringify({ type: "message", content: text }));
    }

    if (messageInput) {
      messageInput.value = "";
    }
    if (fileInput) {
      fileInput.value = "";
    }
    setStatus("Terhubung sebagai " + username + " di #" + state.currentRoomID);

    if (state.typingSent) {
      sendTyping(false);
      state.typingSent = false;
    }
  }

  // ========================
  // 7) Room join flow
  // ========================
  function handleJoin(event) {
    event.preventDefault();
    const nextRoom = (roomInput.value || "").trim().toLowerCase();
    if (!nextRoom) {
      setGateStatus("Room ID tidak boleh kosong.");
      roomInput.focus();
      return;
    }

    state.currentRoomID = nextRoom;
    setRoomUI(state.currentRoomID);
    clearChat();
    setUsers([]);

    roomGate.classList.add("hidden");
    chatApp.classList.remove("hidden");
    setStatus("Memasuki room...");
    setGateStatus("Masuk room berhasil.");

    connectRoom(state.currentRoomID);
  }

  // ========================
  // 8) Wire events
  // ========================
  joinForm.addEventListener("submit", handleJoin);
  if (sendButton) {
    sendButton.addEventListener("click", sendCurrentInput);
  }
  if (messageInput) {
    messageInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        sendCurrentInput();
        return;
      }
      if (!state.typingSent) {
        sendTyping(true);
        state.typingSent = true;
      }
      if (state.typingTimer) {
        clearTimeout(state.typingTimer);
      }
      state.typingTimer = setTimeout(function () {
        sendTyping(false);
        state.typingSent = false;
      }, 1200);
    });
  }

  setGateStatus("Masukkan room id untuk memulai chat.");
})();
