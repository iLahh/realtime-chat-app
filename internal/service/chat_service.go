// ============================================================
// === PACKAGE & IMPORTS ===

package service

import (
	"context"
	"errors"
	"strings"

	"github.com/yourname/chat-app-golang/internal/model"
)

// ============================================================
// === INTERFACE & STRUCT ===

type ChatService struct {
	assistantService AIService
}

// ============================================================
// === CONSTRUCTOR ===

func NewChatService(assistantService AIService) *ChatService {
	return &ChatService{
		assistantService: assistantService,
	}
}

// ============================================================
// === PUBLIC METHODS ===

func (s *ChatService) ProcessMessage(ctx context.Context, msg model.Message) (model.Message, error) {
	_ = ctx
	return msg, nil
}

func (s *ChatService) ShouldTriggerAI(content string) bool {
	return strings.Contains(strings.ToLower(content), "@ai")
}

func (s *ChatService) AskAI(ctx context.Context, content string) (string, error) {
	if s.assistantService == nil {
		return "", errors.New("assistant service is not configured")
	}

	prompt := sanitizeAIMention(content)
	if prompt == "" {
		return "", errors.New("prompt is empty")
	}

	return s.assistantService.GenerateReply(ctx, prompt)
}

// ============================================================
// === PRIVATE HELPERS ===

func sanitizeAIMention(content string) string {
	prompt := strings.TrimSpace(strings.ReplaceAll(content, "@AI", ""))
	prompt = strings.TrimSpace(strings.ReplaceAll(prompt, "@ai", ""))
	return prompt
}
