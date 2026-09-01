package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

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

// toolProxyResponse is the stable resource envelope for /query and /remediate.
// ok is true iff the upstream (or local) status is 2xx.
type toolProxyResponse struct {
	OK      bool   `json:"ok"`
	Status  int    `json:"status"`
	Summary string `json:"summary"`
	Error   string `json:"error"`
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeToolProxy(w http.ResponseWriter, httpStatus int, status int, summary, errMsg string) {
	writeJSON(w, httpStatus, toolProxyResponse{
		OK:      status >= 200 && status < 300,
		Status:  status,
		Summary: summary,
		Error:   errMsg,
	})
}


// handleHealth is the plugin resource health probe.
// When configured, it calls dot-ai version (same path as Test connection).
func (a *App) handleHealth(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if a.apiURL == "" || a.apiKey == "" {
		writeJSON(w, http.StatusOK, testConnectionResponse{
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
		defer func() { _ = req.Body.Close() }()
		var body testConnectionRequest
		dec := json.NewDecoder(req.Body)
		if err := dec.Decode(&body); err != nil && err != io.EOF {
			writeJSON(w, http.StatusBadRequest, testConnectionResponse{
				Status:  "error",
				Message: "invalid JSON body",
			})
			return
		}
		bodyURL := strings.TrimRight(strings.TrimSpace(body.APIURL), "/")
		bodyKey := strings.TrimSpace(body.APIKey)

		// Draft URL different from saved settings can only be probed by org Admin.
		// Saved-URL tests (empty body URL or same as configured) may proceed without Admin.
		if bodyURL != "" && bodyURL != a.apiURL {
			if !isOrgAdmin(req.Context()) {
				writeJSON(w, http.StatusForbidden, testConnectionResponse{
					Status:  "error",
					Message: "Admin role required to test a draft apiUrl",
				})
				return
			}
			apiURL = bodyURL
			if bodyKey != "" {
				apiKey = bodyKey
			} else {
				// SEC-01: never reuse the saved key against a different (draft) URL.
				apiKey = ""
			}
		} else {
			if bodyURL != "" {
				apiURL = bodyURL
			}
			if bodyKey != "" {
				apiKey = bodyKey
			}
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
	base, err := validateAPIURL(apiURL)
	if err != nil {
		return testConnectionResponse{
			Status:  "error",
			Message: err.Error(),
		}, http.StatusBadRequest
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, versionURL(base), strings.NewReader("{}"))
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
		return testConnectionResponse{
			Status:  "error",
			Message: "HTTP client not configured",
		}, http.StatusInternalServerError
	}

	resp, err := client.Do(httpReq)
	if err != nil {
		return testConnectionResponse{
			Status:  "error",
			Message: fmt.Sprintf("dot-ai unreachable: %v", err),
		}, http.StatusBadGateway
	}
	defer func() { _ = resp.Body.Close() }()

	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// Do not reflect raw upstream error bodies to the UI.
		msg := fmt.Sprintf("dot-ai version returned HTTP %d", resp.StatusCode)
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

// validateAPIURL requires an absolute http(s) URL with a non-empty host.
// It returns a trimmed base (no trailing slash) suitable for path join.
// Call before any outbound dial so file://, javascript:, and host-less values never hit the network.
func validateAPIURL(apiURL string) (string, error) {
	base := strings.TrimRight(strings.TrimSpace(apiURL), "/")
	if base == "" {
		return "", fmt.Errorf("apiUrl is required")
	}
	u, err := url.Parse(base)
	if err != nil {
		return "", fmt.Errorf("invalid apiUrl: %w", err)
	}
	if !u.IsAbs() {
		return "", fmt.Errorf("apiUrl must be an absolute http(s) URL")
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return "", fmt.Errorf("apiUrl scheme must be http or https")
	}
	if u.Host == "" {
		return "", fmt.Errorf("apiUrl must include a host")
	}
	return base, nil
}

func versionURL(apiURL string) string {
	base := strings.TrimRight(strings.TrimSpace(apiURL), "/")
	return base + "/api/v1/tools/version"
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
	a.proxyDotAI(w, req, "/api/v1/tools/query")
}

// handleRemediate proxies POST /remediate → analysis-only /api/v1/tools/remediate.
func (a *App) handleRemediate(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	a.proxyDotAI(w, req, "/api/v1/tools/remediate")
}

// sanitizeRemediateBody allowlists analysis-only fields for dot-ai remediate.
// Frontend historically sent {intent}; upstream requires {issue}. Accept both,
// map bare intent → issue, and drop execute/apply/mode/confirmation tokens so
// direct POSTs cannot trigger execution.
// Empty issue after mapping returns an error and must not forward {}.
func sanitizeRemediateBody(body []byte) ([]byte, error) {
	var in map[string]any
	if err := json.Unmarshal(body, &in); err != nil {
		return nil, fmt.Errorf("invalid JSON body")
	}
	out := make(map[string]any, 2)
	intent, _ := in["intent"].(string)
	issue, _ := in["issue"].(string)
	if strings.TrimSpace(issue) == "" && strings.TrimSpace(intent) != "" {
		issue = intent
	}
	if strings.TrimSpace(issue) == "" {
		return nil, fmt.Errorf("issue is required")
	}
	if strings.TrimSpace(intent) != "" {
		out["intent"] = intent
	}
	out["issue"] = strings.TrimSpace(issue)
	return json.Marshal(out)
}

// isOrgAdmin reports whether the Grafana request user has org Admin role.
func isOrgAdmin(ctx context.Context) bool {
	u := backend.UserFromContext(ctx)
	if u == nil {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(u.Role), "Admin")
}

func asMap(v any) map[string]any {
	m, ok := v.(map[string]any)
	if !ok {
		return nil
	}
	return m
}

func trimmedStringAt(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	s, ok := m[key].(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(s)
}

// extractSummary ports the frontend envelope walk: result.summary|analysis|message,
// then data.summary, then top-level summary.
func extractSummary(payload any) string {
	root := asMap(payload)
	if root == nil {
		return ""
	}
	data := asMap(root["data"])
	if data == nil {
		data = root
	}
	result := asMap(data["result"])
	if result == nil {
		result = asMap(root["result"])
	}
	if result != nil {
		for _, key := range []string{"summary", "analysis", "message"} {
			if s := trimmedStringAt(result, key); s != "" {
				return s
			}
		}
	}
	if s := trimmedStringAt(data, "summary"); s != "" {
		return s
	}
	return trimmedStringAt(root, "summary")
}

// extractErrorMessage ports the frontend error walk: error.message (+ optional code), else message.
func extractErrorMessage(payload any, fallback string) string {
	root := asMap(payload)
	if root == nil {
		return fallback
	}
	if errObj := asMap(root["error"]); errObj != nil {
		if msg := trimmedStringAt(errObj, "message"); msg != "" {
			if code := trimmedStringAt(errObj, "code"); code != "" {
				return code + ": " + msg
			}
			return msg
		}
	}
	if msg := trimmedStringAt(root, "message"); msg != "" {
		return msg
	}
	return fallback
}

// proxyDotAI forwards the request body to a dot-ai tools REST path and returns a
// stable {ok,status,summary,error} envelope (never the raw upstream body).
func (a *App) proxyDotAI(w http.ResponseWriter, req *http.Request, toolPath string) {
	if a.apiURL == "" || a.apiKey == "" {
		writeToolProxy(w, http.StatusBadRequest, http.StatusBadRequest, "", "plugin not configured: set apiUrl and auth token")
		return
	}

	base, err := validateAPIURL(a.apiURL)
	if err != nil {
		writeToolProxy(w, http.StatusBadRequest, http.StatusBadRequest, "", err.Error())
		return
	}

	const maxBody = 1 << 20 // 1 MiB
	body, err := io.ReadAll(io.LimitReader(req.Body, maxBody+1))
	if err != nil {
		writeToolProxy(w, http.StatusBadRequest, http.StatusBadRequest, "", "failed to read request body")
		return
	}
	if len(body) > maxBody {
		writeToolProxy(w, http.StatusRequestEntityTooLarge, http.StatusRequestEntityTooLarge, "", "request body too large")
		return
	}
	if len(body) == 0 {
		body = []byte("{}")
	}

	// Remediate must stay analysis-only at the proxy, not only in the UI.
	if toolPath == "/api/v1/tools/remediate" {
		sanitized, err := sanitizeRemediateBody(body)
		if err != nil {
			writeToolProxy(w, http.StatusBadRequest, http.StatusBadRequest, "", err.Error())
			return
		}
		body = sanitized
	}

	upstreamURL := base + toolPath
	httpReq, err := http.NewRequestWithContext(req.Context(), http.MethodPost, upstreamURL, bytes.NewReader(body))
	if err != nil {
		writeToolProxy(w, http.StatusBadRequest, http.StatusBadRequest, "", fmt.Sprintf("build upstream request: %v", err))
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
		writeToolProxy(w, http.StatusInternalServerError, http.StatusInternalServerError, "", "HTTP client not configured")
		return
	}

	resp, err := client.Do(httpReq)
	if err != nil {
		// Do not log secrets; error string is safe dial failure text.
		writeToolProxy(w, http.StatusBadGateway, http.StatusBadGateway, "", fmt.Sprintf("dot-ai unreachable (502): %v", err))
		return
	}
	defer func() { _ = resp.Body.Close() }()

	const maxUpstreamBody = 8 << 20 // 8 MiB
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxUpstreamBody+1))
	if err != nil {
		writeToolProxy(w, http.StatusBadGateway, http.StatusBadGateway, "", "failed reading upstream body")
		return
	}
	if len(raw) > maxUpstreamBody {
		writeToolProxy(w, http.StatusBadGateway, http.StatusBadGateway, "", "upstream response too large")
		return
	}

	var payload any
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &payload); err != nil {
			// Non-JSON upstream: still envelope; do not reflect raw body.
			payload = nil
		}
	}

	ok := resp.StatusCode >= 200 && resp.StatusCode < 300
	summary := ""
	errMsg := ""
	if ok {
		summary = extractSummary(payload)
	} else {
		errMsg = extractErrorMessage(payload, fmt.Sprintf("dot-ai returned HTTP %d", resp.StatusCode))
	}

	// HTTP status mirrors upstream so callers can still branch on transport code;
	// body always carries the stable envelope.
	writeToolProxy(w, resp.StatusCode, resp.StatusCode, summary, errMsg)
}

// registerRoutes takes a *http.ServeMux and registers HTTP handlers.
func (a *App) registerRoutes(mux *http.ServeMux) {
	// /health is the sole liveness/connectivity probe (no separate /ping scaffold).
	mux.HandleFunc("/health", a.handleHealth)
	mux.HandleFunc("/test-connection", a.handleTestConnection)
	mux.HandleFunc("/query", a.handleQuery)
	mux.HandleFunc("/remediate", a.handleRemediate)
}
