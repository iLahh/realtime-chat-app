package api

import (
	"net/http"

	"github.com/yourname/chat-app-golang/internal/service"
	"github.com/yourname/chat-app-golang/pkg/utils"
)

type UserHandler struct {
	hub *service.SocketHub
}

func NewUserHandler(hub *service.SocketHub) *UserHandler {
	return &UserHandler{hub: hub}
}

func (h *UserHandler) GetOnlineUsers(w http.ResponseWriter, _ *http.Request) {
	utils.WriteJSON(w, http.StatusOK, utils.APIResponse{
		Message: "online users fetched",
		Data:    h.hub.OnlineUsers(),
	})
}
