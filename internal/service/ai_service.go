// ============================================================
// === PACKAGE & IMPORTS ===

package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

// ============================================================
// === INTERFACE ===

type AIService interface {
	GenerateReply(ctx context.Context, prompt string) (string, error)
}

// ============================================================
// === TYPES (request/response structs) ===

type OpenRouterService struct {
	apiKey string
	model  string
	client *http.Client
}

type openRouterRequest struct {
	Model    string              `json:"model"`
	Messages []openRouterMessage `json:"messages"`
}

type openRouterMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openRouterResponse struct {
	Choices []struct {
		Message struct {
			Content   *string `json:"content"`
			Reasoning string  `json:"reasoning"`
		} `json:"message"`
	} `json:"choices"`
}

// ============================================================
// === CONSTRUCTOR ===

func NewOpenRouterService(apiKey, model string) *OpenRouterService {
	cleanKey := strings.TrimSpace(apiKey)
	cleanKey = strings.Trim(cleanKey, `"`)

	cleanModel := strings.TrimSpace(model)
	if cleanModel == "" {
		cleanModel = "tencent/hy3-preview:free"
	}

	return &OpenRouterService{
		apiKey: cleanKey,
		model:  cleanModel,
		client: &http.Client{
			Timeout: 20 * time.Second,
		},
	}
}

// ============================================================
// === PUBLIC METHODS ===

func (s *OpenRouterService) GenerateReply(ctx context.Context, prompt string) (string, error) {
	if s.apiKey == "" {
		return "", errors.New("OpenRouter API key is empty")
	}
	if strings.TrimSpace(prompt) == "" {
		return "", errors.New("prompt is empty")
	}
	return s.generateReply(ctx, prompt)
}

// ============================================================
// === PRIVATE METHODS ===

func (s *OpenRouterService) generateReply(ctx context.Context, prompt string) (string, error) {
	model := strings.TrimSpace(s.model)
	if model == "" {
		model = "openai/gpt-oss-20b:free"
	}

	reqBody := openRouterRequest{
		Model: model,
		Messages: []openRouterMessage{
			{
				Role:    "system",
				Content: "You are a helpful AI assistant in a realtime chat room. Reply concisely and helpfully in the same language the user uses.",
			},
			{
				Role:    "user",
				Content: prompt,
			},
		},
	}

	payload, err := json.Marshal(reqBody)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		"https://openrouter.ai/api/v1/chat/completions",
		bytes.NewReader(payload),
	)
	if err != nil {
		return "", err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+s.apiKey)
	req.Header.Set("HTTP-Referer", "https://ilahh.github.io/realtime-chat-app/")
	req.Header.Set("X-Title", "realtime-chat-app")

	resp, err := s.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	if resp.StatusCode >= 300 {
		return "", humanizeOpenRouterError(resp.StatusCode, body)
	}

	log.Printf("OpenRouter raw response: %s", string(body))

	var parsed openRouterResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", err
	}

	if len(parsed.Choices) == 0 {
		return "", errors.New("openrouter returned empty response")
	}

	reply := ""
	if parsed.Choices[0].Message.Content != nil {
		reply = strings.TrimSpace(*parsed.Choices[0].Message.Content)
	}
	
	if reply == "" {
		reply = strings.TrimSpace(parsed.Choices[0].Message.Reasoning)
	}
	if reply == "" {
		return "", errors.New("openrouter returned blank text")
	}

	return reply, nil
}

// ============================================================
// === ERROR HELPERS ===

func humanizeOpenRouterError(statusCode int, body []byte) error {
	errText := strings.TrimSpace(string(body))
	if len(errText) > 220 {
		errText = errText[:220] + "..."
	}

	switch statusCode {
	case http.StatusTooManyRequests:
		return fmt.Errorf("kuota/rate limit OpenRouter habis (429). Coba lagi nanti atau upgrade plan")
	case http.StatusUnauthorized, http.StatusForbidden:
		return fmt.Errorf("API key OpenRouter tidak valid/ditolak (%d)", statusCode)
	case http.StatusNotFound:
		return fmt.Errorf("model OpenRouter tidak ditemukan (404). Cek OPENROUTER_MODEL di .env")
	default:
		return fmt.Errorf("openrouter API error (%d): %s", statusCode, errText)
	}
}
