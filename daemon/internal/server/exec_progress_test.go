package server

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/nocoo/meowth/daemon/internal/agentfactory"
	"github.com/nocoo/meowth/daemon/internal/envelope"
	"github.com/nocoo/meowth/daemon/internal/server/handlers"
	"github.com/nocoo/meowth/daemon/internal/store"
	"github.com/nocoo/meowth/daemon/pkg/agent"
)

type progressBackendFunc func(context.Context, string, agent.ExecOptions) (*agent.Session, error)

func (f progressBackendFunc) Execute(ctx context.Context, prompt string, opts agent.ExecOptions) (*agent.Session, error) {
	return f(ctx, prompt, opts)
}

func newProgressHTTP(t *testing.T, backend agent.Backend) (*sql.DB, *httptest.Server) {
	t.Helper()
	db, _ := newPumpDB(t)
	handler := &handlers.AgentExecHandler{
		DB: db, Runner: newPumpRunner(db, nil),
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		Factory: &agentfactory.ProductionFactory{
			Resolver:   func(string) (string, error) { return "synthetic-backend", nil },
			NewBackend: func(string, agent.Config) (agent.Backend, error) { return backend, nil },
		},
	}
	router := chi.NewRouter()
	router.Post("/v1/agents/{type}/exec", handler.Exec)
	server := httptest.NewServer(router)
	t.Cleanup(server.Close)
	return db, server
}

func TestProgressHTTPFixturesArriveBeforeTerminal(t *testing.T) {
	previewStart := func(id string) agent.Message {
		return agent.Message{Type: agent.MessageStatus, Status: "preview_start", MessageID: id}
	}
	previewEnd := func(id string) agent.Message {
		return agent.Message{Type: agent.MessageStatus, Status: "preview_end", MessageID: id}
	}
	previewReset := func(id string) agent.Message {
		return agent.Message{Type: agent.MessageStatus, Status: "preview_reset", MessageID: id}
	}
	preview := func(id, content string) agent.Message {
		return agent.Message{Type: agent.MessageTextPreview, MessageID: id, Content: content}
	}
	canonical := func(content string) agent.Message {
		return agent.Message{Type: agent.MessageText, Content: content}
	}
	first := `{"notes":"SYNTHETIC_NOTE","calls":[],"text":"你`
	second := `好😀\n\"quoted\" \\ path"}`
	final := first + second
	planning := `{"text":"Planning a synthetic tool call","calls":[]}`
	done := `{"text":"Done","calls":[]}`
	successThenFailure := `{"text":"This must be discarded","calls":[]}`
	cases := []struct {
		name       string
		backend    string
		publicKind string
		before     []agent.Message
		after      []agent.Message
		result     agent.Result
	}{
		{
			name: "retry-unicode", backend: "pi", publicKind: "text-preview",
			before: []agent.Message{
				previewStart("1"),
				{Type: agent.MessageThinking, Content: "SYNTHETIC_PRIVATE_THINKING"},
				preview("1", `{"text":"discarded attempt`),
			},
			after: []agent.Message{
				previewReset("1"), {Type: agent.MessageStatus, Status: "retrying"},
				previewStart("2"), preview("2", first), preview("2", second),
				canonical(final), previewEnd("2"),
			},
			result: agent.Result{
				Status: "completed", Output: final, DurationMs: 5,
				Usage: map[string]agent.TokenUsage{"fixture": {InputTokens: 7, OutputTokens: 3}},
			},
		},
		{
			name: "tool-boundary", backend: "pi", publicKind: "text-preview",
			before: []agent.Message{previewStart("1"), preview("1", planning)},
			after: []agent.Message{
				canonical(planning), previewEnd("1"),
				{Type: agent.MessageToolUse, Tool: "SYNTHETIC_PRIVATE_TITLE", Input: map[string]any{"arg": "SYNTHETIC_PRIVATE_ARGS"}},
				{Type: agent.MessageToolResult, Output: "SYNTHETIC_PRIVATE_RESULT"},
				previewStart("2"), preview("2", done), canonical(done), previewEnd("2"),
			},
			result: agent.Result{Status: "completed", Output: planning + done},
		},
		{
			name: "success-then-fatal", backend: "pi", publicKind: "text-preview",
			before: []agent.Message{previewStart("1"), preview("1", successThenFailure)},
			after: []agent.Message{
				canonical(successThenFailure), previewEnd("1"), previewReset("1"),
				{Type: agent.MessageError, Content: "synthetic nonzero process exit"},
			},
			result: agent.Result{Status: "failed", Output: successThenFailure, Error: "synthetic nonzero process exit"},
		},
		{
			name: "cancelled-preview", backend: "pi", publicKind: "text-preview",
			before: []agent.Message{previewStart("1"), preview("1", `{"text":"pending`)},
			after:  []agent.Message{previewReset("1")},
			result: agent.Result{Status: "cancelled", Error: "synthetic cancellation"},
		},
		{
			name: "hermes-text-fallback", backend: "hermes", publicKind: "text",
			before: []agent.Message{
				{Type: agent.MessageThinking, Content: "SYNTHETIC_PRIVATE_THINKING"},
				{Type: agent.MessageLog, Content: "SYNTHETIC_PRIVATE_LOG"},
				canonical(first),
			},
			after:  []agent.Message{canonical(second)},
			result: agent.Result{Status: "completed", Output: final},
		},
	}
	var manifest []map[string]any
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gate := make(chan struct{})
			release := sync.OnceFunc(func() { close(gate) })
			defer release()
			backend := progressBackendFunc(func(ctx context.Context, _ string, opts agent.ExecOptions) (*agent.Session, error) {
				if !opts.StreamProgress {
					return nil, fmt.Errorf("progress header was not propagated to backend options")
				}
				messages := make(chan agent.Message)
				results := make(chan agent.Result, 1)
				go func() {
					defer close(messages)
					defer close(results)
					for i, group := range [][]agent.Message{tc.before, tc.after} {
						if i == 1 {
							select {
							case <-gate:
							case <-ctx.Done():
								results <- agent.Result{Status: "cancelled"}
								return
							}
						}
						for _, msg := range group {
							select {
							case messages <- msg:
							case <-ctx.Done():
								results <- agent.Result{Status: "cancelled"}
								return
							}
						}
					}
					results <- tc.result
				}()
				return &agent.Session{Messages: messages, Result: results}, nil
			})
			db, server := newProgressHTTP(t, backend)
			ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
			defer cancel()
			req, err := http.NewRequestWithContext(ctx, http.MethodPost, server.URL+"/v1/agents/"+tc.backend+"/exec",
				strings.NewReader(`{"prompt":"synthetic fixture"}`))
			if err != nil {
				t.Fatal(err)
			}
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-Meowth-Stream-Progress", "1")
			response, err := server.Client().Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = response.Body.Close() }()
			if response.StatusCode != http.StatusOK || response.Header.Get("X-Meowth-Stream-Progress") != "1" {
				t.Fatalf("status=%d acknowledgement=%q", response.StatusCode, response.Header.Get("X-Meowth-Stream-Progress"))
			}
			var wire bytes.Buffer
			reader := bufio.NewReader(io.TeeReader(response.Body, &wire))
			prefixBytes := 0
			var firstPublic envelope.Envelope
			for {
				line, err := reader.ReadBytes('\n')
				if err != nil {
					t.Fatalf("no public text while terminal was gated: %v", err)
				}
				prefixBytes += len(line)
				var env envelope.Envelope
				if err := json.Unmarshal(line, &env); err != nil {
					t.Fatal(err)
				}
				if env.Type == envelope.TypeSessionEnded {
					t.Fatal("terminal arrived before gate release")
				}
				var payload envelope.MessagePayload
				if err := json.Unmarshal(env.Payload, &payload); err != nil {
					t.Fatal(err)
				}
				if env.Type == envelope.TypeMessage && payload.Kind == tc.publicKind && payload.Content != "" {
					firstPublic = env
					rows, err := store.ListMessagesAfterSeq(t.Context(), db, store.ListMessagesAfterSeqParams{
						SessionID: env.SessionID, AfterSeq: env.Seq - 1, Limit: 1,
					})
					if err != nil || len(rows) != 1 || !bytes.Equal(rows[0].EnvelopeJSON, line) {
						t.Fatalf("public event was not persisted before receipt: rows=%d error=%v", len(rows), err)
					}
					break
				}
			}
			release()
			if _, err := io.ReadAll(reader); err != nil {
				t.Fatalf("stream did not reach clean EOF: %v", err)
			}
			if bytes.Contains(wire.Bytes(), []byte("SYNTHETIC_PRIVATE")) {
				t.Fatal("private provider fields reached the wire")
			}
			lines := bytes.Split(bytes.TrimSuffix(wire.Bytes(), []byte("\n")), []byte("\n"))
			for i, line := range lines {
				var env envelope.Envelope
				if err := json.Unmarshal(line, &env); err != nil {
					t.Fatal(err)
				}
				if env.V != 1 || env.SessionID != firstPublic.SessionID || env.Seq != int64(i) || len(line)+1 >= 512*1024 {
					t.Fatalf("invalid envelope at seq=%d bytes=%d", env.Seq, len(line)+1)
				}
				if i == len(lines)-1 {
					var ended envelope.SessionEndedPayload
					if err := json.Unmarshal(env.Payload, &ended); err != nil {
						t.Fatal(err)
					}
					if env.Type != envelope.TypeSessionEnded || ended.Status != tc.result.Status {
						t.Fatalf("terminal=%s status=%s", env.Type, ended.Status)
					}
				} else if env.Type == envelope.TypeSessionEnded {
					t.Fatal("event after terminal")
				}
			}
			rows, err := store.ListMessagesAfterSeq(t.Context(), db, store.ListMessagesAfterSeqParams{
				SessionID: firstPublic.SessionID, AfterSeq: -1, Limit: 100,
			})
			if err != nil {
				t.Fatal(err)
			}
			var persisted bytes.Buffer
			for _, row := range rows {
				persisted.Write(row.EnvelopeJSON)
			}
			if !bytes.Equal(wire.Bytes(), persisted.Bytes()) {
				t.Fatal("persisted bytes differ from HTTP bytes")
			}
			sum := fmt.Sprintf("%x", sha256.Sum256(wire.Bytes()))
			manifest = append(manifest, map[string]any{
				"file": tc.name + ".ndjson", "sha256": sum, "bytes": wire.Len(),
				"pause_after_bytes": prefixBytes, "first_public_seq": firstPublic.Seq,
				"backend": tc.backend, "terminal_status": tc.result.Status,
			})
			if dir := os.Getenv("MEOWTH_STREAM_FIXTURE_DIR"); dir != "" {
				// #nosec G703 -- artifact directory is set by the local test runner, never by an HTTP input.
				if err := os.MkdirAll(dir, 0o700); err != nil {
					t.Fatal(err)
				}
				// #nosec G703 -- trusted test-runner directory and fixed synthetic fixture name.
				if err := os.WriteFile(filepath.Join(dir, tc.name+".ndjson"), wire.Bytes(), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			t.Logf("public event received before gate release; fixture=%s bytes=%d sha256=%s", tc.name, wire.Len(), sum)
		})
	}
	if dir := os.Getenv("MEOWTH_STREAM_FIXTURE_DIR"); dir != "" && !t.Failed() {
		data, err := json.MarshalIndent(manifest, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		// #nosec G703 -- trusted test-runner directory and fixed manifest name.
		if err := os.WriteFile(filepath.Join(dir, "manifest.json"), append(data, '\n'), 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestProgressHTTPDisconnectCancelsBackend(t *testing.T) {
	cancelled := make(chan struct{})
	backend := progressBackendFunc(func(ctx context.Context, _ string, _ agent.ExecOptions) (*agent.Session, error) {
		messages := make(chan agent.Message, 2)
		results := make(chan agent.Result, 1)
		messages <- agent.Message{Type: agent.MessageStatus, Status: "preview_start", MessageID: "1"}
		messages <- agent.Message{Type: agent.MessageTextPreview, MessageID: "1", Content: "pending"}
		go func() {
			defer close(messages)
			defer close(results)
			<-ctx.Done()
			close(cancelled)
			results <- agent.Result{Status: "cancelled"}
		}()
		return &agent.Session{Messages: messages, Result: results}, nil
	})
	_, server := newProgressHTTP(t, backend)
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, server.URL+"/v1/agents/pi/exec",
		strings.NewReader(`{"prompt":"synthetic cancellation"}`))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("X-Meowth-Stream-Progress", "1")
	response, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = response.Body.Close() }()
	reader := bufio.NewReader(response.Body)
	for {
		line, err := reader.ReadBytes('\n')
		if err != nil {
			t.Fatal(err)
		}
		if bytes.Contains(line, []byte(`"kind":"text-preview"`)) {
			break
		}
	}
	cancel()
	select {
	case <-cancelled:
	case <-time.After(2 * time.Second):
		t.Fatal("disconnect did not cancel the active backend")
	}
}
