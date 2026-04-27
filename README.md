# Realtime Chat App (Golang)

Struktur project ini mengikuti pola `cmd/internal/pkg` agar kode mudah dirawat dan scalable.

## Stack

- Go (Golang)
- WebSocket
- PostgreSQL

## Struktur utama

- `cmd/server`: entrypoint aplikasi.
- `internal/api`: HTTP & WebSocket handler.
- `internal/service`: business logic chat, socket hub, dan integrasi AI.
- `internal/model`: struktur data utama.
- `pkg/utils`: helper yang bisa dipakai lintas package.
- `uploads`: penyimpanan file sementara.
