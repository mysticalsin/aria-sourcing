package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/mysticalsin/aria-sourcing/services/ingest"
	"github.com/mysticalsin/aria-sourcing/services/ingest/source"
	"github.com/mysticalsin/aria-sourcing/services/ingest/state"
)

func newCVHandler(log io.Writer) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("content-type", "application/json")
		_, _ = io.WriteString(w, `{"ok":true}`)
	})
	mux.HandleFunc("POST /v1/cv", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		if err := r.ParseMultipartForm(ingest.MaxUploadBytes); err != nil {
			http.Error(w, `{"ok":false,"reason":"file"}`, http.StatusBadRequest)
			return
		}
		file, _, err := r.FormFile("file")
		if err != nil {
			http.Error(w, `{"ok":false,"reason":"file"}`, http.StatusBadRequest)
			return
		}
		defer file.Close()
		body, err := io.ReadAll(io.LimitReader(file, ingest.MaxUploadBytes+1))
		if err != nil || len(body) == 0 || len(body) > ingest.MaxUploadBytes {
			http.Error(w, `{"ok":false,"reason":"file"}`, http.StatusBadRequest)
			return
		}
		id := make([]byte, 8)
		_, _ = rand.Read(id)
		uploadID := "upl-" + hex.EncodeToString(id)
		worker := ingest.New(ingest.Options{})
		res, err := worker.Ingest(context.Background(), ingest.Upload{
			ID:    uploadID,
			Bytes: body,
			Origin: source.Origin{
				CVSource: "toast-upload",
				Folder:   "holding",
			},
		})
		fmt.Fprintf(log, "ingest id=%s bytes=%d state=%s\n", uploadID, len(body), stateLabel(res, err))
		if err != nil || res.State != state.ReadyForToRate {
			http.Error(w, `{"ok":false,"reason":"rejected"}`, http.StatusUnprocessableEntity)
			return
		}
		email := strings.ToLower(strings.TrimSpace(res.Parsed.Contact.Email))
		if !strings.HasSuffix(email, "@example.test") {
			fmt.Fprintf(log, "ingest id=%s state=refused\n", uploadID)
			http.Error(w, `{"ok":false,"reason":"synthetic"}`, http.StatusUnprocessableEntity)
			return
		}
		_ = json.NewEncoder(w).Encode(struct {
			OK    bool   `json:"ok"`
			Name  string `json:"name"`
			Email string `json:"email"`
		}{OK: true, Name: res.Parsed.Name, Email: email})
	})
	return mux
}

func stateLabel(res ingest.Result, err error) string {
	if err != nil {
		return "error"
	}
	return string(res.State)
}

func serve(addr string, log io.Writer) int {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		fmt.Fprintln(log, "ingest listen failed")
		return 1
	}
	server := &http.Server{
		Handler:           newCVHandler(log),
		ReadHeaderTimeout: 5 * time.Second,
	}
	if err := server.Serve(ln); err != nil && err != http.ErrServerClosed {
		fmt.Fprintln(log, "ingest serve failed")
		return 1
	}
	return 0
}

func ready() int {
	client := &http.Client{Timeout: 2 * time.Second}
	response, err := client.Get("http://127.0.0.1:8091/health")
	if err != nil {
		return 1
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}
