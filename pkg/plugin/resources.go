package plugin

import (
	"encoding/json"
	"net/http"
)

// stubResponse is returned until M3 wires the real Go→dot-ai proxy.
type stubResponse struct {
	Status  string `json:"status"`
	Message string `json:"message"`
	Path    string `json:"path"`
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

// handleHealth is the plugin resource health probe (cluster context later via version tool).
func (a *App) handleHealth(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet && req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, http.StatusOK, stubResponse{
		Status:  "not_wired",
		Message: "health stub — M3 will call dot-ai /api/v1/tools/version",
		Path:    "/health",
	})
}

// handleQuery stubs POST /query until the outbound Bearer proxy lands in M3.
func (a *App) handleQuery(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, http.StatusOK, stubResponse{
		Status:  "not_wired",
		Message: "query stub — not wired to dot-ai; M3 will POST /api/v1/tools/query with Authorization: Bearer",
		Path:    "/query",
	})
}

// handleRemediate stubs POST /remediate (analysis-only; no execute UI).
func (a *App) handleRemediate(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, http.StatusOK, stubResponse{
		Status:  "not_wired",
		Message: "remediate stub — analysis-only path; M3 will POST /api/v1/tools/remediate (no apply)",
		Path:    "/remediate",
	})
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
	mux.HandleFunc("/query", a.handleQuery)
	mux.HandleFunc("/remediate", a.handleRemediate)
}
