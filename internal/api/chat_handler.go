package api

import (
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"github.com/yourname/chat-app-golang/internal/model"
	"github.com/yourname/chat-app-golang/internal/service"
	"github.com/yourname/chat-app-golang/pkg/utils"
)

type ChatHandler struct {
	chatService *service.ChatService
	hub         *service.SocketHub
	upgrader    websocket.Upgrader
}

func NewChatHandler(chatService *service.ChatService, hub *service.SocketHub) *ChatHandler {
	return &ChatHandler{
		chatService: chatService,
		hub:         hub,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin: func(_ *http.Request) bool {
				return true
			},
		},
	}
}

type inboundEvent struct {
	Type     string `json:"type"`
	Content  string `json:"content,omitempty"`
	FileURL  string `json:"file_url,omitempty"`
	FileName string `json:"file_name,omitempty"`
	Typing   bool   `json:"typing,omitempty"`
}

type wsClientInfo struct {
	UserID   string
	Username string
	RoomID   string
}

func (h *ChatHandler) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	client := parseWSClientInfo(r)

	out := make(chan service.SocketEvent, 32)
	h.hub.Register(client.UserID, client.Username, client.RoomID, out)
	defer func() {
		h.hub.Unregister(out)
		close(out)
		h.broadcastOnlineUsers(client.RoomID)
		h.hub.BroadcastRoom(client.RoomID, service.SocketEvent{
			Type:      "system",
			RoomID:    client.RoomID,
			Content:   client.Username + " left the room",
			Timestamp: time.Now().UTC(),
		})
	}()

	h.broadcastOnlineUsers(client.RoomID)
	h.hub.BroadcastRoom(client.RoomID, service.SocketEvent{
		Type:      "system",
		RoomID:    client.RoomID,
		Content:   client.Username + " telah masuk ke dalam percakapan",
		Timestamp: time.Now().UTC(),
	})

	go func() {
		for event := range out {
			if err := conn.WriteJSON(event); err != nil {
				return
			}
		}
	}()

	for {
		var in inboundEvent
		if err := conn.ReadJSON(&in); err != nil {
			// Normal close/disconnect
			if websocket.IsCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) || errors.Is(err, websocket.ErrCloseSent) {
				return
			}
			return
		}

		switch in.Type {
		case "typing":
			h.hub.BroadcastRoom(client.RoomID, service.SocketEvent{
				Type:      "typing",
				RoomID:    client.RoomID,
				UserID:    client.UserID,
				Username:  client.Username,
				Typing:    in.Typing,
				Timestamp: time.Now().UTC(),
			})
		case "message":
			msg := h.buildIncomingMessage(client, in)
			if msg.Content == "" && msg.FileURL == "" {
				out <- service.SocketEvent{
					Type:      "error",
					Content:   "message or file is required",
					Timestamp: time.Now().UTC(),
				}
				continue
			}

			processed, err := h.chatService.ProcessMessage(context.Background(), msg)
			if err != nil {
				out <- service.SocketEvent{
					Type:      "error",
					Content:   "failed processing message",
					Timestamp: time.Now().UTC(),
				}
				continue
			}

			h.hub.BroadcastRoom(client.RoomID, service.SocketEvent{
				Type:      "message",
				RoomID:    client.RoomID,
				UserID:    client.UserID,
				Username:  client.Username,
				Content:   processed.Content,
				FileURL:   processed.FileURL,
				FileName:  processed.FileName,
				Timestamp: processed.CreatedAt,
			})

			if h.chatService.ShouldTriggerAI(msg.Content) {
				reply, err := h.chatService.AskAI(context.Background(), msg.Content)
				if err != nil {
					out <- service.SocketEvent{
						Type:      "error",
						Content:   "AI unavailable: " + err.Error(),
						Timestamp: time.Now().UTC(),
					}
					continue
				}

				h.hub.BroadcastRoom(client.RoomID, service.SocketEvent{
					Type:      "message",
					RoomID:    client.RoomID,
					UserID:    "ai-bot",
					Username:  "AI Assistant",
					Content:   reply,
					Timestamp: time.Now().UTC(),
				})
			}
		default:
			out <- service.SocketEvent{
				Type:      "error",
				Content:   "unknown event type",
				Timestamp: time.Now().UTC(),
			}
		}
	}
}

func parseWSClientInfo(r *http.Request) wsClientInfo {
	userID := strings.TrimSpace(r.URL.Query().Get("user_id"))
	if userID == "" {
		userID = "guest-" + time.Now().Format("150405.000")
	}

	username := strings.TrimSpace(r.URL.Query().Get("username"))
	if username == "" {
		username = userID
	}

	roomID := strings.TrimSpace(r.URL.Query().Get("room_id"))
	if roomID == "" {
		roomID = "general"
	}

	return wsClientInfo{
		UserID:   userID,
		Username: username,
		RoomID:   roomID,
	}
}

func (h *ChatHandler) buildIncomingMessage(client wsClientInfo, in inboundEvent) model.Message {
	return model.Message{
		RoomID:    client.RoomID,
		UserID:    client.UserID,
		Content:   strings.TrimSpace(in.Content),
		FileURL:   strings.TrimSpace(in.FileURL),
		FileName:  strings.TrimSpace(in.FileName),
		CreatedAt: time.Now().UTC(),
	}
}

func (h *ChatHandler) HandleUploadPhoto(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if err := r.ParseMultipartForm(10 << 20); err != nil {
		utils.WriteJSON(w, http.StatusBadRequest, utils.APIResponse{Message: "invalid form data", Error: err.Error()})
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		file, header, err = r.FormFile("photo")
		if err != nil {
			utils.WriteJSON(w, http.StatusBadRequest, utils.APIResponse{Message: "file is required", Error: err.Error()})
			return
		}
	}
	defer file.Close()

	originalName := filepath.Base(strings.TrimSpace(header.Filename))
	if originalName == "" {
		utils.WriteJSON(w, http.StatusBadRequest, utils.APIResponse{Message: "invalid file name", Error: "empty file name"})
		return
	}

	if err := os.MkdirAll("uploads", 0o755); err != nil {
		utils.WriteJSON(w, http.StatusInternalServerError, utils.APIResponse{Message: "failed preparing upload directory", Error: err.Error()})
		return
	}

	ext := strings.ToLower(filepath.Ext(originalName))
	filename := "file-" + time.Now().Format("20060102-150405.000000000") + ext
	filename = strings.ReplaceAll(filename, ":", "")
	dstPath := filepath.Join("uploads", filename)

	dst, err := os.Create(dstPath)
	if err != nil {
		utils.WriteJSON(w, http.StatusInternalServerError, utils.APIResponse{Message: "failed creating photo file", Error: err.Error()})
		return
	}
	defer dst.Close()

	if _, err := io.Copy(dst, file); err != nil {
		utils.WriteJSON(w, http.StatusInternalServerError, utils.APIResponse{Message: "failed saving photo file", Error: err.Error()})
		return
	}

	utils.WriteJSON(w, http.StatusCreated, utils.APIResponse{
		Message: "file uploaded",
		Data: map[string]string{
			"file_url":  "/uploads/" + filename,
			"file_name": originalName,
		},
	})
}

func (h *ChatHandler) broadcastOnlineUsers(roomID string) {
	h.hub.BroadcastRoom(roomID, service.SocketEvent{
		Type:        "online_users",
		RoomID:      roomID,
		OnlineUsers: h.hub.RoomUsers(roomID),
		Timestamp:   time.Now().UTC(),
	})
}
