package model

import "time"

type Message struct {
	ID        string    `json:"id" db:"id"`
	RoomID    string    `json:"room_id" db:"room_id"`
	UserID    string    `json:"user_id" db:"user_id"`
	Content   string    `json:"content" db:"content"`
	FileURL   string    `json:"file_url,omitempty" db:"file_url"`
	FileName  string    `json:"file_name,omitempty" db:"file_name"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}
