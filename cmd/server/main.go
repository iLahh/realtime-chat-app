package main

import (
	"log"
	"net/http"
	"os"

	"github.com/joho/godotenv"
	"github.com/yourname/chat-app-golang/internal/api"
	"github.com/yourname/chat-app-golang/internal/service"
)

func main() {
	_ = godotenv.Load()

	port := getEnv("APP_PORT", "8080")

	hub := service.NewSocketHub()
	aiService := buildAIService()
	chatService := service.NewChatService(aiService)

	chatHandler := api.NewChatHandler(chatService, hub)
	userHandler := api.NewUserHandler(hub)

	serverMux := newServerMux(chatHandler, userHandler)

	log.Printf("server started on :%s", port)
	if err := http.ListenAndServe(":"+port, serverMux); err != nil {
		log.Fatal(err)
	}
}

func newServerMux(chatHandler *api.ChatHandler, userHandler *api.UserHandler) *http.ServeMux {
	mux := http.NewServeMux()

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		disableCache(w)
		http.ServeFile(w, r, "index.html")
	})
	mux.HandleFunc("/styles.css", func(w http.ResponseWriter, r *http.Request) {
		disableCache(w)
		http.ServeFile(w, r, "styles.css")
	})
	mux.HandleFunc("/app.js", func(w http.ResponseWriter, r *http.Request) {
		disableCache(w)
		http.ServeFile(w, r, "app.js")
	})
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
	// Backward-compatible: new keys first, old keys as fallback.
	apiKey := getEnv("AI_API_KEY", getEnv("GEMINI_API_KEY", ""))
	model := getEnv("AI_MODEL", getEnv("GEMINI_MODEL", ""))
	return service.NewGeminiService(apiKey, model)
}

func getEnv(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}

func disableCache(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")
}
