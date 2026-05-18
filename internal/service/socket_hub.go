// ============================================================
// === PACKAGE & IMPORTS ===

package service

import (
	"sort"
	"sync"
	"time"
)

// ============================================================
// === TYPES & STRUCTS ===

type SocketEvent struct {
	Type        string        `json:"type"`
	RoomID      string        `json:"room_id,omitempty"`
	UserID      string        `json:"user_id,omitempty"`
	Username    string        `json:"username,omitempty"`
	Content     string        `json:"content,omitempty"`
	FileURL     string        `json:"file_url,omitempty"`
	FileName    string        `json:"file_name,omitempty"`
	Typing      bool          `json:"typing,omitempty"`
	OnlineUsers []string      `json:"online_users,omitempty"`
	History     []SocketEvent `json:"history,omitempty"`
	Timestamp   time.Time     `json:"timestamp"`
}

type SocketHub struct {
	mu        sync.RWMutex
	users     map[string]string
	clients   map[string]map[chan SocketEvent]struct{}
	rooms     map[string]map[chan SocketEvent]struct{}
	clientRef map[chan SocketEvent]clientMeta
}

type clientMeta struct {
	userID   string
	username string
	roomID   string
}

// ============================================================
// === CONSTRUCTOR ===

func NewSocketHub() *SocketHub {
	return &SocketHub{
		users:     make(map[string]string),
		clients:   make(map[string]map[chan SocketEvent]struct{}),
		rooms:     make(map[string]map[chan SocketEvent]struct{}),
		clientRef: make(map[chan SocketEvent]clientMeta),
	}
}

// ============================================================
// === PUBLIC METHODS ===

func (h *SocketHub) Register(userID, username, roomID string, ch chan SocketEvent) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.ensureUserBucket(userID)
	h.clients[userID][ch] = struct{}{}
	h.users[userID] = username

	h.ensureRoomBucket(roomID)
	h.rooms[roomID][ch] = struct{}{}

	h.clientRef[ch] = clientMeta{
		userID:   userID,
		username: username,
		roomID:   roomID,
	}
}

func (h *SocketHub) Unregister(ch chan SocketEvent) {
	h.mu.Lock()
	defer h.mu.Unlock()

	meta, ok := h.clientRef[ch]
	if !ok {
		return
	}

	delete(h.clientRef, ch)

	if conns, ok := h.clients[meta.userID]; ok {
		delete(conns, ch)
		if len(conns) == 0 {
			delete(h.clients, meta.userID)
			delete(h.users, meta.userID)
		}
	}

	if members, ok := h.rooms[meta.roomID]; ok {
		delete(members, ch)
		if len(members) == 0 {
			delete(h.rooms, meta.roomID)
		}
	}
}

func (h *SocketHub) OnlineUsers() []string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.onlineUsersLocked()
}

func (h *SocketHub) RoomUsers(roomID string) []string {
	h.mu.RLock()
	defer h.mu.RUnlock()

	members := h.rooms[roomID]
	if len(members) == 0 {
		return []string{}
	}

	unique := make(map[string]struct{})
	for ch := range members {
		meta, ok := h.clientRef[ch]
		if !ok {
			continue
		}
		unique[meta.username] = struct{}{}
	}

	users := make([]string, 0, len(unique))
	for username := range unique {
		users = append(users, username)
	}
	sort.Strings(users)
	return users
}

func (h *SocketHub) BroadcastRoom(roomID string, event SocketEvent) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	for ch := range h.rooms[roomID] {
		trySend(ch, event)
	}
}

// ============================================================
// === PRIVATE / HELPER METHODS ===

func (h *SocketHub) onlineUsersLocked() []string {
	users := make([]string, 0, len(h.users))
	for _, username := range h.users {
		users = append(users, username)
	}
	sort.Strings(users)
	return users
}

func (h *SocketHub) ensureUserBucket(userID string) {
	if _, ok := h.clients[userID]; ok {
		return
	}
	h.clients[userID] = make(map[chan SocketEvent]struct{})
}

func (h *SocketHub) ensureRoomBucket(roomID string) {
	if _, ok := h.rooms[roomID]; ok {
		return
	}
	h.rooms[roomID] = make(map[chan SocketEvent]struct{})
}

func trySend(ch chan SocketEvent, event SocketEvent) {
	select {
	case ch <- event:
	default:
	}
}
