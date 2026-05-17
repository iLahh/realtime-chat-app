package main

import (
	"database/sql"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/joho/godotenv"
	_ "github.com/lib/pq"
	"github.com/yourname/chat-app-golang/internal/api"
	"github.com/yourname/chat-app-golang/internal/service"
)

func main() {
	_ = godotenv.Load()

	port := getEnv("PORT", getEnv("APP_PORT", "8080"))
	dbURL := getEnv("DATABASE_URL", "")
	var db *sql.DB
	if dbURL != "" {
		var err error
		db, err = sql.Open("postgres", dbURL)
		if err != nil {
			log.Fatalf("failed to open database: %v", err)
		}
		if err := db.Ping(); err != nil {
			log.Printf("failed to ping database: %v", err)
		} else {
			log.Println("connected to database successfully")
			initDB(db)
		}
	}

	hub := service.NewSocketHub()
	openRouterService := buildOpenRouterService()
	chatService := service.NewChatService(openRouterService)

	chatHandler := api.NewChatHandler(chatService, hub, db)
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

func initDB(db *sql.DB) {
	// Ensure id column has auto-increment default
	fixIDQuery := `
	DO $$
	BEGIN
		IF NOT EXISTS (
			SELECT 1 FROM pg_sequences WHERE sequencename = 'messages_id_seq'
		) THEN
			CREATE SEQUENCE IF NOT EXISTS messages_id_seq;
		END IF;
	END $$;`
	_, _ = db.Exec(fixIDQuery)

	query := `
	CREATE TABLE IF NOT EXISTS messages (
		id SERIAL PRIMARY KEY,
		room_id VARCHAR(100),
		sender_id VARCHAR(100),
		username VARCHAR(100),
		content TEXT,
		file_url TEXT,
		file_name TEXT,
		created_at TIMESTAMP DEFAULT NOW()
	);`
	if _, err := db.Exec(query); err != nil {
		log.Printf("failed to create messages table: %v", err)
	}

	// Fix id column if it doesn't have a default
	setDefaultQuery := `
	ALTER TABLE messages 
		ALTER COLUMN id SET DEFAULT nextval('messages_id_seq');`
	_, _ = db.Exec(setDefaultQuery)

	alterQuery := `
	ALTER TABLE messages 
		ADD COLUMN IF NOT EXISTS sender_id VARCHAR(100),
		ADD COLUMN IF NOT EXISTS username VARCHAR(100),
		ADD COLUMN IF NOT EXISTS file_url TEXT,
		ADD COLUMN IF NOT EXISTS file_name TEXT;
	`
	if _, err := db.Exec(alterQuery); err != nil {
		log.Printf("failed to alter messages table: %v", err)
	}
}

func buildOpenRouterService() *service.OpenRouterService {
	apiKey := firstNonEmptyEnv("OPENROUTER_API_KEY")
	model := firstNonEmptyEnv("OPENROUTER_MODEL")
	if apiKey == "" {
		log.Println("warning: OpenRouter API key is empty; @ai replies will be unavailable")
	}
	return service.NewOpenRouterService(apiKey, model)
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
