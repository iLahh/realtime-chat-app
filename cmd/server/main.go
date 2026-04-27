package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/joho/godotenv"
	"github.com/yourname/chat-app-golang/internal/api"
	"github.com/yourname/chat-app-golang/internal/service"
)

func main() {
	_ = godotenv.Load()

	port := getEnv("PORT", getEnv("APP_PORT", "8080"))

	hub := service.NewSocketHub()
	aiService := buildAIService()
	chatService := service.NewChatService(aiService)

	chatHandler := api.NewChatHandler(chatService, hub)
	userHandler := api.NewUserHandler(hub)

	serverMux := newServerMux(chatHandler, userHandler)

	log.Printf("server started on :%s", port)
	if err := http.ListenAndServe(":"+port, withCORS(serverMux)); err != nil {
		log.Fatal(err)
	}
}

func newServerMux(chatHandler *api.ChatHandler, userHandler *api.UserHandler) *http.ServeMux {
	mux := http.NewServeMux()
	docsDir := "docs"
	docsFS := http.FileServer(http.Dir(docsDir))

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		disableCache(w)
		http.ServeFile(w, r, filepath.Join(docsDir, "index.html"))
	})
	// Keep static asset routes explicit so websocket/api routes stay predictable.
	mux.Handle("/styles.css", docsFS)
	mux.Handle("/app.js", docsFS)
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("ok"))
	})
	mux.HandleFunc("/ws", chatHandler.HandleWebSocket)
	mux.HandleFunc("/upload", chatHandler.HandleUploadPhoto)
	mux.HandleFunc("/users/online", userHandler.GetOnlineUsers)
	mux.Handle("/uploads/", http.StripPrefix("/uploads/", http.FileServer(http.Dir("uploads"))))

	return mux
}

func buildAIService() *service.GeminiService {
	// Backward-compatible: prioritize new generic names, then provider-specific names.
	apiKey := firstNonEmptyEnv(
		"AI_API_KEY",
		"OPENROUTER_API_KEY",
		"GEMINI_API_KEY",
	)
	model := firstNonEmptyEnv(
		"AI_MODEL",
		"OPENROUTER_MODEL",
		"GEMINI_MODEL",
	)
	if apiKey == "" {
		log.Println("warning: AI API key is empty; @ai replies will be unavailable")
	}
	return service.NewGeminiService(apiKey, model)
}

func getEnv(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}

func firstNonEmptyEnv(keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return ""
}

func disableCache(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		applyCORSHeaders(w, r)
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func applyCORSHeaders(w http.ResponseWriter, r *http.Request) {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin != "" && isAllowedOrigin(origin) {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
	}
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
}

func isAllowedOrigin(origin string) bool {
	allowed := []string{
		"https://ilahh.github.io",
		"http://localhost:3000",
		"http://127.0.0.1:3000",
	}
	customOrigin := strings.TrimSpace(os.Getenv("FRONTEND_ORIGIN"))
	if customOrigin != "" {
		allowed = append(allowed, customOrigin)
	}

	for _, candidate := range allowed {
		if origin == candidate {
			return true
		}
	}
	return false
}
