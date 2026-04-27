package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type AIService interface {
	GenerateReply(ctx context.Context, prompt string) (string, error)
}

type GeminiService struct {
	apiKey string
	model  string
	client *http.Client
}

func NewGeminiService(apiKey, model string) *GeminiService {
	cleanKey := strings.TrimSpace(apiKey)
	cleanKey = strings.Trim(cleanKey, `"`)

	cleanModel := strings.TrimSpace(model)
	if cleanModel == "" {
		cleanModel = "google/gemma-4-26b-a4b-it:free"
	}

	return &GeminiService{
		apiKey: cleanKey,
		model:  cleanModel,
		client: &http.Client{
			Timeout: 20 * time.Second,
		},
	}
}

type geminiGenerateRequest struct {
	Contents []geminiContent `json:"contents"`
}

type geminiContent struct {
	Parts []geminiPart `json:"parts"`
}

type geminiPart struct {
	Text string `json:"text"`
}

type geminiGenerateResponse struct {
	Candidates []struct {
		Content struct {
			Parts []struct {
				Text string `json:"text"`
			} `json:"parts"`
		} `json:"content"`
	} `json:"candidates"`
}

type geminiErrorResponse struct {
	Error struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func (s *GeminiService) GenerateReply(ctx context.Context, prompt string) (string, error) {
	if s.apiKey == "" {
		return "", errors.New("AI API key is empty")
	}
	if strings.TrimSpace(prompt) == "" {
		return "", errors.New("prompt is empty")
	}

	// OpenRouter key format starts with "sk-or-".
	if strings.HasPrefix(s.apiKey, "sk-or-") {
		return s.generateViaOpenRouter(ctx, prompt)
	}

	return s.generateViaGemini(ctx, prompt)
}

func (s *GeminiService) generateViaGemini(ctx context.Context, prompt string) (string, error) {
	reqBody := geminiGenerateRequest{
		Contents: []geminiContent{
			{
				Parts: []geminiPart{
					{Text: prompt},
				},
			},
		},
	}

	payload, err := json.Marshal(reqBody)
	if err != nil {
		return "", err
	}

	url := fmt.Sprintf(
		"https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s",
		s.model,
		s.apiKey,
	)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

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
		return "", humanizeGeminiError(resp.StatusCode, body)
	}

	var parsed geminiGenerateResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", err
	}

	if len(parsed.Candidates) == 0 || len(parsed.Candidates[0].Content.Parts) == 0 {
		return "", errors.New("gemini returned empty response")
	}

	reply := strings.TrimSpace(parsed.Candidates[0].Content.Parts[0].Text)
	if reply == "" {
		return "", errors.New("gemini returned blank text")
	}

	return reply, nil
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
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

func (s *GeminiService) generateViaOpenRouter(ctx context.Context, prompt string) (string, error) {
	model := strings.TrimSpace(s.model)
	if model == "" {
		model = "google/gemma-4-26b-a4b-it:free"
	}

	reqBody := openRouterRequest{
		Model: model,
		Messages: []openRouterMessage{
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

	var parsed openRouterResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", err
	}

	if len(parsed.Choices) == 0 {
		return "", errors.New("openrouter returned empty response")
	}

	reply := strings.TrimSpace(parsed.Choices[0].Message.Content)
	if reply == "" {
		return "", errors.New("openrouter returned blank text")
	}

	return reply, nil
}

func humanizeGeminiError(statusCode int, body []byte) error {
	var parsed geminiErrorResponse
	if err := json.Unmarshal(body, &parsed); err == nil && parsed.Error.Message != "" {
		switch statusCode {
		case http.StatusTooManyRequests:
			return fmt.Errorf("kuota Gemini habis (429). Cek billing/rate limit di Google AI Studio lalu coba lagi")
		case http.StatusNotFound:
			return fmt.Errorf("model Gemini tidak ditemukan (404). Ganti GEMINI_MODEL di .env")
		case http.StatusUnauthorized, http.StatusForbidden:
			return fmt.Errorf("API key Gemini tidak valid/ditolak (%d)", statusCode)
		default:
			return fmt.Errorf("gemini API error (%d): %s", statusCode, parsed.Error.Message)
		}
	}

	return fmt.Errorf("gemini API error: status %d", statusCode)
}

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
		return fmt.Errorf("model OpenRouter tidak ditemukan (404). Cek AI_MODEL di .env")
	default:
		return fmt.Errorf("openrouter API error (%d): %s", statusCode, errText)
	}
}
