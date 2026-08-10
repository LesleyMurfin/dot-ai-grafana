package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// stubResponse is returned until M3 wires the real Go→dot-ai query/remediate proxy.
type stubResponse struct {
	Status  string `json:"status"`
	Message string `json:"message"`
	Path    string `json:"path"`
}

// testConnectionRequest allows the config UI to probe draft (unsaved) settings.
type testConnectionRequest struct {
	APIURL string `json:"apiUrl"`
	APIKey string `json:"apiKey"`
}

// testConnectionResponse is returned by POST /test-connection.
type testConnectionResponse struct {
	Status         string `json:"status"`
	Message        string `json:"message"`
	Connected      *bool  `json:"connected,omitempty"`
	UpstreamStatus int    `json:"upstreamStatus,omitempty"`
	Path           string `json:"path,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// handlePing is a lightweight liveness resource for scaffolding checks.
func (a *App) handlePing(w http.ResponseWriter, req *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"message": "ok"})
}

// handleHealth is the plugin resource health probe.
// When configured, it calls dot-ai version (same path as Test connection).
func (a *App) handleHealth(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet && req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if a.apiURL == "" || a.apiKey == "" {
		writeJSON(w, http.StatusOK, stubResponse{
			Status:  "not_configured",
			Message: "set MCP Server URL (apiUrl) and Auth Token, then use Test connection",
			Path:    "/health",
		})
		return
	}

	result, code := a.probeVersion(req.Context(), a.apiURL, a.apiKey)
	result.Path = "/health"
	writeJSON(w, code, result)
}

// handleTestConnection POSTs to dot-ai /api/v1/tools/version with Bearer auth.
func (a *App) handleTestConnection(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	apiURL := a.apiURL
	apiKey := a.apiKey

	if req.Body != nil {
		defer req.Body.Close()
		var body testConnectionRequest
		dec := json.NewDecoder(req.Body)
		if err := dec.Decode(&body); err != nil && err != io.EOF {
			writeJSON(w, http.StatusBadRequest, testConnectionResponse{
				Status:  "error",
				Message: "invalid JSON body",
			})
			return
		}
		if u := strings.TrimRight(strings.TrimSpace(body.APIURL), "/"); u != "" {
			apiURL = u
		}
		if k := strings.TrimSpace(body.APIKey); k != "" {
			apiKey = k
		}
	}

	if apiURL == "" || apiKey == "" {
		writeJSON(w, http.StatusBadRequest, testConnectionResponse{
			Status:  "error",
			Message: "apiUrl and auth token are required (save settings or pass draft values)",
		})
		return
	}

	result, code := a.probeVersion(req.Context(), apiURL, apiKey)
	result.Path = "/test-connection"
	writeJSON(w, code, result)
}

func (a *App) probeVersion(ctx context.Context, apiURL, apiKey string) (testConnectionResponse, int) {
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, versionURL(apiURL), strings.NewReader("{}"))
	if err != nil {
		return testConnectionResponse{
			Status:  "error",
			Message: fmt.Sprintf("build request: %v", err),
		}, http.StatusBadRequest
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	httpReq.Header.Set("Accept", "application/json")

	client := a.httpClient
	if client == nil {
		client = http.DefaultClient
	}

	resp, err := client.Do(httpReq)
	if err != nil {
		return testConnectionResponse{
			Status:  "error",
			Message: fmt.Sprintf("dot-ai unreachable: %v", err),
		}, http.StatusBadGateway
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg := fmt.Sprintf("dot-ai version returned HTTP %d", resp.StatusCode)
		if len(raw) > 0 {
			msg = msg + ": " + truncate(string(raw), 256)
		}
		status := http.StatusBadGateway
		if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
			status = http.StatusUnauthorized
		}
		return testConnectionResponse{
			Status:         "error",
			Message:        msg,
			UpstreamStatus: resp.StatusCode,
		}, status
	}

	connected := extractConnected(raw)
	msg := "connected to dot-ai"
	if connected != nil && !*connected {
		msg = "dot-ai responded but Kubernetes reports not connected"
	}

	return testConnectionResponse{
		Status:         "ok",
		Message:        msg,
		Connected:      connected,
		UpstreamStatus: resp.StatusCode,
	}, http.StatusOK
}

func versionURL(apiURL string) string {
	base := strings.TrimRight(strings.TrimSpace(apiURL), "/")
	return base + "/api/v1/tools/version"
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

func extractConnected(raw []byte) *bool {
	// M0 shape: connected may appear at top-level, data, or data.result.
	var envelope map[string]any
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil
	}
	if v, ok := boolAt(envelope, "connected"); ok {
		return &v
	}
	if data, ok := envelope["data"].(map[string]any); ok {
		if v, ok := boolAt(data, "connected"); ok {
			return &v
		}
		if result, ok := data["result"].(map[string]any); ok {
			if v, ok := boolAt(result, "connected"); ok {
				return &v
			}
		}
	}
	if result, ok := envelope["result"].(map[string]any); ok {
		if v, ok := boolAt(result, "connected"); ok {
			return &v
		}
	}
	return nil
}

func boolAt(m map[string]any, key string) (bool, bool) {
	v, ok := m[key]
	if !ok {
		return false, false
	}
	b, ok := v.(bool)
	return b, ok
}

// handleQuery proxies POST /query → dot-ai /api/v1/tools/query with Bearer auth.
func (a *App) handleQuery(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	a.proxyTool(w, req, "/api/v1/tools/query")
}

// handleRemediate proxies POST /remediate → analysis-only /api/v1/tools/remediate.
func (a *App) handleRemediate(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	a.proxyTool(w, req, "/api/v1/tools/remediate")
}

// proxyTool forwards the request body to a dot-ai tools REST path.
// Upstream status and body are preserved (including 202 async envelopes).
func (a *App) proxyTool(w http.ResponseWriter, req *http.Request, toolPath string) {
	if a.apiURL == "" || a.apiKey == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"status":  "error",
			"message": "plugin not configured: set apiUrl and auth token",
		})
		return
	}

	const maxBody = 1 << 20 // 1 MiB
	body, err := io.ReadAll(io.LimitReader(req.Body, maxBody+1))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"status":  "error",
			"message": "failed to read request body",
		})
		return
	}
	if len(body) > maxBody {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{
			"status":  "error",
			"message": "request body too large",
		})
		return
	}
	if len(body) == 0 {
		body = []byte("{}")
	}

	url := a.apiURL + toolPath
	httpReq, err := http.NewRequestWithContext(req.Context(), http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"status":  "error",
			"message": fmt.Sprintf("build upstream request: %v", err),
		})
		return
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+a.apiKey)
	httpReq.Header.Set("Accept", "application/json")

	client := a.toolHTTPClient
	if client == nil {
		client = a.httpClient
	}
	if client == nil {
		client = http.DefaultClient
	}

	resp, err := client.Do(httpReq)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{
			"status":  "error",
			"message": fmt.Sprintf("dot-ai unreachable: %v", err),
		})
		return
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{
			"status":  "error",
			"message": "failed reading upstream body",
		})
		return
	}

	ct := resp.Header.Get("Content-Type")
	if ct == "" {
		ct = "application/json"
	}
	w.Header().Set("Content-Type", ct)
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(raw)
}

// handleEcho keeps the create-plugin example for local smoke.
func (a *App) handleEcho(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		Message string `json:"message"`
	}
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusOK, body)
}

// registerRoutes takes a *http.ServeMux and registers HTTP handlers.
func (a *App) registerRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/ping", a.handlePing)
	mux.HandleFunc("/echo", a.handleEcho)
	mux.HandleFunc("/health", a.handleHealth)
	mux.HandleFunc("/test-connection", a.handleTestConnection)
	mux.HandleFunc("/query", a.handleQuery)
	mux.HandleFunc("/remediate", a.handleRemediate)
}
