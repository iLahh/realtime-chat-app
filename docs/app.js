(function () {
  const RECONNECT_DELAY_MS = 1500;
  const TYPING_IDLE_MS = 1200;
  const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

  const roomGate = document.getElementById("roomGate");
  const chatApp = document.getElementById("chatApp");
  const joinForm = document.getElementById("joinForm");
  const roomInput = document.getElementById("roomInput");
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
  const fileNameText = document.getElementById("fileNameText");

  if (
    !roomGate || !chatApp || !joinForm || !roomInput || !gateStatus ||
    !roomTitle || !activeRoomText || !statusText || !chatBody || !emptyState ||
    !onlineUsers || !messageInput || !sendButton || !fileInput || !fileNameText
  ) {
    console.error("UI tidak lengkap. Coba hard refresh (Ctrl+F5).");
    return;
  }

  const configuredBackendBase = sanitizeBaseURL(window.BACKEND_BASE_URL);
  const localWSProtocol = window.location.protocol === "https:" ? "wss" : "ws";
  const apiBaseURL = configuredBackendBase || window.location.origin;

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

  function sanitizeBaseURL(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  function safelySetText(element, text) {
    if (element) {
      element.textContent = text;
    }
  }

  function setGateStatus(text) {
    safelySetText(gateStatus, text);
  }

  function getConnectedStatusText(roomID) {
    return "Terhubung sebagai " + username + " di #" + roomID;
  }

  function setStatus(text) {
    safelySetText(statusText, text);
  }

  function setFileNameLabel(file) {
    if (!fileNameText) {
      return;
    }
    fileNameText.textContent = file ? file.name : "Belum ada file";
  }

  function setConnectedStatus(roomID) {
    setStatus(getConnectedStatusText(roomID));
  }

  function setRoomUI(roomID) {
    roomTitle.textContent = "Room #" + roomID;
    activeRoomText.textContent = "#" + roomID;
  }

  function hideEmptyState() {
    emptyState.style.display = "none";
  }

  function clearChat() {
    chatBody.querySelectorAll(".bubble").forEach((node) => node.remove());
    emptyState.style.display = "block";
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

  function scrollChatToBottom() {
    chatBody.scrollTop = chatBody.scrollHeight;
  }

  function getWSBaseURL() {
    if (!configuredBackendBase) {
      return localWSProtocol + "://" + window.location.host;
    }

    try {
      const parsed = new URL(configuredBackendBase);
      const wsProtocol = parsed.protocol === "https:" ? "wss:" : "ws:";
      return wsProtocol + "//" + parsed.host;
    } catch (_) {
      return localWSProtocol + "://" + window.location.host;
    }
  }

  function buildAPIURL(path) {
    return apiBaseURL + path;
  }

  function absolutizeFileURL(fileURL) {
    if (!fileURL) {
      return "";
    }
    if (/^https?:\/\//i.test(fileURL)) {
      return fileURL;
    }
    return buildAPIURL(fileURL.startsWith("/") ? fileURL : "/" + fileURL);
  }

  function buildWSURL(roomID) {
    const wsBase = getWSBaseURL();
    return (
      wsBase +
      "/ws?user_id=" + encodeURIComponent(userID) +
      "&username=" + encodeURIComponent(username) +
      "&room_id=" + encodeURIComponent(roomID)
    );
  }

  function isImage(url) {
    return /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/i.test(url || "");
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
      const absoluteFileURL = absolutizeFileURL(fileURL);
      if (isImage(absoluteFileURL)) {
        const img = document.createElement("img");
        img.src = absoluteFileURL;
        img.alt = fileName || "file";
        wrap.appendChild(img);
      } else {
        const fileLink = document.createElement("a");
        fileLink.className = "file-link";
        fileLink.href = absoluteFileURL;
        fileLink.target = "_blank";
        fileLink.rel = "noopener noreferrer";
        fileLink.textContent = "Download file: " + (fileName || "attachment");
        wrap.appendChild(fileLink);
      }
    }

    chatBody.appendChild(wrap);
    scrollChatToBottom();
  }

  function appendSystemMessage(text) {
    hideEmptyState();

    const wrap = document.createElement("article");
    wrap.className = "bubble bubble-system";
    wrap.innerHTML = '<p class="meta">System</p><p></p>';
    wrap.querySelectorAll("p")[1].textContent = text;

    chatBody.appendChild(wrap);
    scrollChatToBottom();
  }

  function closeSocket() {
    if (!state.socket) {
      return;
    }
    try {
      state.allowReconnect = false;
      state.socket.close();
    } catch (_) {
      // Ignore close errors.
    }
    state.socket = null;
  }

  function resetReconnectTimer() {
    if (!state.reconnectTimer) {
      return;
    }
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }

  function scheduleReconnect() {
    setStatus("Koneksi terputus, mencoba ulang...");
    state.reconnectTimer = setTimeout(function () {
      connectRoom(state.currentRoomID);
    }, RECONNECT_DELAY_MS);
  }

  function handleIncomingPayload(payload, roomID) {
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
        appendSystemMessage(payload.content || "System event");
        break;
      case "online_users":
        setUsers(payload.online_users || []);
        break;
      case "typing":
        if (payload.user_id !== userID && payload.typing) {
          setStatus((payload.username || "Seseorang") + " sedang mengetik...");
        } else if (payload.user_id !== userID) {
          setConnectedStatus(roomID);
        }
        break;
      case "error":
        setStatus(payload.content || "Server error");
        break;
      default:
        break;
    }
  }

  function connectRoom(roomID) {
    if (!roomID) {
      return;
    }

    resetReconnectTimer();
    closeSocket();
    state.allowReconnect = true;

    setStatus("Menyambungkan...");
    state.socket = new WebSocket(buildWSURL(roomID));

    state.socket.onopen = function () {
      setConnectedStatus(roomID);
    };

    state.socket.onmessage = function (event) {
      try {
        const payload = JSON.parse(event.data);
        handleIncomingPayload(payload, roomID);
      } catch (_) {
        setStatus("Format pesan tidak valid");
      }
    };

    state.socket.onclose = function () {
      if (state.allowReconnect) {
        scheduleReconnect();
      }
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

  function readCurrentInput() {
    return {
      text: messageInput.value.trim(),
      file: fileInput.files ? fileInput.files[0] : null,
    };
  }

  function resetComposer(roomID) {
    messageInput.value = "";
    fileInput.value = "";
    setFileNameLabel(null);
    setConnectedStatus(roomID);
  }

  async function uploadFile(file) {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(buildAPIURL("/upload"), {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      throw new Error("Upload gagal");
    }

    const result = await response.json();
    const data = result.data || {};
    if (!data.file_url) {
      throw new Error("Respons upload tidak valid");
    }
    return data;
  }

  async function sendCurrentInput() {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
      setStatus("Belum terhubung ke room");
      return;
    }

    const current = readCurrentInput();
    if (!current.text && !current.file) {
      setStatus("Tulis pesan atau pilih file terlebih dahulu");
      return;
    }

    if (!current.file) {
      state.socket.send(JSON.stringify({ type: "message", content: current.text }));
      resetComposer(state.currentRoomID);
      return;
    }

    if (current.file.size > MAX_UPLOAD_BYTES) {
      setStatus("Ukuran file maksimal 10MB.");
      return;
    }

    try {
      if (sendButton) {
        sendButton.disabled = true;
      }
      setStatus("Upload file...");

      const uploadedFile = await uploadFile(current.file);
      state.socket.send(JSON.stringify({
        type: "message",
        content: current.text,
        file_url: uploadedFile.file_url,
        file_name: uploadedFile.file_name || current.file.name,
      }));

      resetComposer(state.currentRoomID);
    } catch (error) {
      setStatus(error.message || "Gagal kirim file");
      console.error("Upload failed:", error);
    } finally {
      if (sendButton) {
        sendButton.disabled = false;
      }
    }

    if (state.typingSent) {
      sendTyping(false);
      state.typingSent = false;
    }
  }

  function handleJoin(event) {
    event.preventDefault();

    const nextRoom = (roomInput.value || "").trim().toLowerCase();
    if (!nextRoom) {
      setGateStatus("Room ID tidak boleh kosong.");
      roomInput.focus();
      return;
    }

    state.currentRoomID = nextRoom;
    setRoomUI(nextRoom);
    clearChat();
    setUsers([]);

    roomGate.classList.add("hidden");
    chatApp.classList.remove("hidden");
    setStatus("Memasuki room...");
    setGateStatus("Masuk room berhasil.");

    connectRoom(nextRoom);
  }

  function handleComposerKeydown(event) {
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
    }, TYPING_IDLE_MS);
  }

  joinForm.addEventListener("submit", handleJoin);
  sendButton.addEventListener("click", sendCurrentInput);
  messageInput.addEventListener("keydown", handleComposerKeydown);
  fileInput.addEventListener("change", function () {
    const selectedFile = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
    setFileNameLabel(selectedFile);
  });

  setGateStatus("Masukkan room id untuk memulai chat.");
  setFileNameLabel(null);
})();
