package service

import (
	"context"
	"errors"
	"strings"

	"github.com/yourname/chat-app-golang/internal/model"
)

type ChatService struct {
	aiService AIService
}

func NewChatService(aiService AIService) *ChatService {
	return &ChatService{
		aiService: aiService,
	}
}

func (s *ChatService) ProcessMessage(ctx context.Context, msg model.Message) (model.Message, error) {
	// Reserved for validations/filtering or persistence.
	// For now we keep the message as-is so behavior stays simple.
	_ = ctx
	return msg, nil
}

func (s *ChatService) ShouldTriggerAI(content string) bool {
	return strings.Contains(strings.ToLower(content), "@ai")
}

func (s *ChatService) AskAI(ctx context.Context, content string) (string, error) {
	if s.aiService == nil {
		return "", errors.New("ai service is not configured")
	}

	prompt := sanitizeAIMention(content)
	if prompt == "" {
		return "", errors.New("prompt is empty")
	}

	return s.aiService.GenerateReply(ctx, prompt)
}

func sanitizeAIMention(content string) string {
	prompt := strings.TrimSpace(strings.ReplaceAll(content, "@AI", ""))
	prompt = strings.TrimSpace(strings.ReplaceAll(prompt, "@ai", ""))
	return prompt
}
