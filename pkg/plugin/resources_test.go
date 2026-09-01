package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

func TestCallResource(t *testing.T) {
	inst, err := NewApp(context.Background(), backend.AppInstanceSettings{})
	if err != nil {
		t.Fatal(err)
	}
	app := inst.(*App)
	defer app.Dispose()

	t.Run("health_not_configured", func(t *testing.T) {
		var resp backend.CallResourceResponse
		err := app.CallResource(context.Background(), &backend.CallResourceRequest{
			Path:   "health",
			Method: http.MethodGet,
		}, callResourceResponseSenderFunc(func(r *backend.CallResourceResponse) error {
			resp = *r
			return nil
		}))
		if err != nil {
			t.Fatal(err)
		}
		if resp.Status != http.StatusOK {
			t.Fatalf("status=%d body=%s", resp.Status, string(resp.Body))
		}
		var body testConnectionResponse
		if err := json.Unmarshal(resp.Body, &body); err != nil {
			t.Fatal(err)
		}
		if body.Status != "not_configured" {
			t.Fatalf("unexpected status %q", body.Status)
		}
	})

	t.Run("query_unconfigured", func(t *testing.T) {
		var resp backend.CallResourceResponse
		err := app.CallResource(context.Background(), &backend.CallResourceRequest{
			Path:   "query",
			Method: http.MethodPost,
			Body:   []byte(`{"intent":"x"}`),
		}, callResourceResponseSenderFunc(func(r *backend.CallResourceResponse) error {
			resp = *r
			return nil
		}))
		if err != nil {
			t.Fatal(err)
		}
		if resp.Status != http.StatusBadRequest {
			t.Fatalf("status=%d body=%s", resp.Status, string(resp.Body))
		}
	})

}

type callResourceResponseSenderFunc func(resp *backend.CallResourceResponse) error

func (f callResourceResponseSenderFunc) Send(resp *backend.CallResourceResponse) error {
	return f(resp)
}

func adminPluginContext() backend.PluginContext {
	return backend.PluginContext{
		User: &backend.User{Login: "admin", Role: "Admin"},
	}
}

func editorPluginContext() backend.PluginContext {
	return backend.PluginContext{
		User: &backend.User{Login: "editor", Role: "Editor"},
	}
}


func TestMethodNotAllowed(t *testing.T) {
	inst, err := NewApp(context.Background(), backend.AppInstanceSettings{})
	if err != nil {
		t.Fatal(err)
	}
	app := inst.(*App)
	defer app.Dispose()

	cases := []struct {
		path   string
		method string
	}{
		{"query", http.MethodGet},
		{"remediate", http.MethodGet},
		{"health", http.MethodPost},
		{"health", http.MethodPut},
		{"test-connection", http.MethodGet},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.path+"_"+tc.method, func(t *testing.T) {
			var resp backend.CallResourceResponse
			err := app.CallResource(context.Background(), &backend.CallResourceRequest{
				Path:   tc.path,
				Method: tc.method,
				Body:   []byte(`{}`),
			}, callResourceResponseSenderFunc(func(r *backend.CallResourceResponse) error {
				resp = *r
				return nil
			}))
			if err != nil {
				t.Fatal(err)
			}
			if resp.Status != http.StatusMethodNotAllowed {
				t.Fatalf("path=%s method=%s status=%d body=%s", tc.path, tc.method, resp.Status, string(resp.Body))
			}
		})
	}
}

func TestTestConnection(t *testing.T) {
	t.Run("missing_settings", func(t *testing.T) {
		inst, err := NewApp(context.Background(), backend.AppInstanceSettings{})
		if err != nil {
			t.Fatal(err)
		}
		app := inst.(*App)
		defer app.Dispose()

		var resp backend.CallResourceResponse
		err = app.CallResource(context.Background(), &backend.CallResourceRequest{
			Path:   "test-connection",
			Method: http.MethodPost,
			Body:   []byte(`{}`),
		}, callResourceResponseSenderFunc(func(r *backend.CallResourceResponse) error {
			resp = *r
			return nil
		}))
		if err != nil {
			t.Fatal(err)
		}
		if resp.Status != http.StatusBadRequest {
			t.Fatalf("status=%d body=%s", resp.Status, string(resp.Body))
		}
	})

	t.Run("success_with_draft", func(t *testing.T) {
		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/api/v1/tools/version" {
				http.NotFound(w, r)
				return
			}
			if r.Method != http.MethodPost {
				http.Error(w, "method", http.StatusMethodNotAllowed)
				return
			}
			auth := r.Header.Get("Authorization")
			if auth != "Bearer secret-token" {
				http.Error(w, "unauth", http.StatusUnauthorized)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"success":true,"data":{"result":{"connected":true}}}`))
		}))
		defer upstream.Close()

		inst, err := NewApp(context.Background(), backend.AppInstanceSettings{})
		if err != nil {
			t.Fatal(err)
		}
		app := inst.(*App)
		defer app.Dispose()

		payload, _ := json.Marshal(map[string]string{
			"apiUrl": upstream.URL,
			"apiKey": "secret-token",
		})
		var resp backend.CallResourceResponse
		err = app.CallResource(context.Background(), &backend.CallResourceRequest{
			PluginContext: adminPluginContext(),
			Path:          "test-connection",
			Method:        http.MethodPost,
			Body:          payload,
		}, callResourceResponseSenderFunc(func(r *backend.CallResourceResponse) error {
			resp = *r
			return nil
		}))
		if err != nil {
			t.Fatal(err)
		}
		if resp.Status != http.StatusOK {
			t.Fatalf("status=%d body=%s", resp.Status, string(resp.Body))
		}
		var body testConnectionResponse
		if err := json.Unmarshal(resp.Body, &body); err != nil {
			t.Fatal(err)
		}
		if body.Status != "ok" {
			t.Fatalf("body=%+v", body)
		}
		if body.Connected == nil || !*body.Connected {
			t.Fatalf("expected connected=true body=%+v", body)
		}
	})

	t.Run("unauthorized", func(t *testing.T) {
		const leak = "SECRET_UPSTREAM_DETAIL_should_not_leak"
		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, `{"error":"UNAUTHORIZED","detail":"`+leak+`"}`, http.StatusUnauthorized)
		}))
		defer upstream.Close()

		inst, err := NewApp(context.Background(), backend.AppInstanceSettings{
			JSONData: []byte(`{"apiUrl":"` + upstream.URL + `"}`),
			DecryptedSecureJSONData: map[string]string{
				"apiKey": "bad",
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		app := inst.(*App)
		defer app.Dispose()

		var resp backend.CallResourceResponse
		err = app.CallResource(context.Background(), &backend.CallResourceRequest{
			Path:   "test-connection",
			Method: http.MethodPost,
			Body:   []byte(`{}`),
		}, callResourceResponseSenderFunc(func(r *backend.CallResourceResponse) error {
			resp = *r
			return nil
		}))
		if err != nil {
			t.Fatal(err)
		}
		if resp.Status != http.StatusUnauthorized {
			t.Fatalf("status=%d body=%s", resp.Status, string(resp.Body))
		}
		if bytes.Contains(resp.Body, []byte(leak)) {
			t.Fatalf("raw upstream body leaked into response: %s", string(resp.Body))
		}
		var body testConnectionResponse
		if err := json.Unmarshal(resp.Body, &body); err != nil {
			t.Fatal(err)
		}
		if body.Status != "error" {
			t.Fatalf("body=%+v", body)
		}
		if strings.Contains(body.Message, leak) || strings.Contains(body.Message, "UNAUTHORIZED") {
			t.Fatalf("message must be status-only, got %q", body.Message)
		}
		if !strings.Contains(body.Message, "HTTP 401") {
			t.Fatalf("expected HTTP status in message, got %q", body.Message)
		}
	})

	t.Run("settings_from_instance", func(t *testing.T) {
		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"connected":true}`))
		}))
		defer upstream.Close()

		inst, err := NewApp(context.Background(), backend.AppInstanceSettings{
			JSONData: []byte(`{"apiUrl":"` + upstream.URL + `/"}`),
			DecryptedSecureJSONData: map[string]string{
				"apiKey": "from-settings",
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		app := inst.(*App)
		defer app.Dispose()
		if app.apiURL != upstream.URL {
			t.Fatalf("apiURL not trimmed: %q", app.apiURL)
		}

		var resp backend.CallResourceResponse
		err = app.CallResource(context.Background(), &backend.CallResourceRequest{
			Path:   "test-connection",
			Method: http.MethodPost,
			Body:   []byte(`{}`),
		}, callResourceResponseSenderFunc(func(r *backend.CallResourceResponse) error {
			resp = *r
			return nil
		}))
		if err != nil {
			t.Fatal(err)
		}
		if resp.Status != http.StatusOK {
			t.Fatalf("status=%d body=%s", resp.Status, string(resp.Body))
		}
	})

	t.Run("rejects_draft_url_without_key_does_not_use_stored_key", func(t *testing.T) {
		// SEC-01: a different draft apiUrl with empty apiKey must not probe the
		// draft host and must not attach the stored Bearer token.
		var hits int32
		draft := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			atomic.AddInt32(&hits, 1)
			t.Errorf("draft host must not be contacted; Authorization=%q", r.Header.Get("Authorization"))
			w.WriteHeader(http.StatusOK)
		}))
		defer draft.Close()

		saved := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			t.Errorf("saved host must not be contacted for a draft-url request")
			w.WriteHeader(http.StatusOK)
		}))
		defer saved.Close()

		inst, err := NewApp(context.Background(), backend.AppInstanceSettings{
			JSONData: []byte(`{"apiUrl":"` + saved.URL + `"}`),
			DecryptedSecureJSONData: map[string]string{
				"apiKey": "stored-secret-token",
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		app := inst.(*App)
		defer app.Dispose()

		payload, _ := json.Marshal(map[string]string{
			"apiUrl": draft.URL,
			"apiKey": "",
		})
		var resp backend.CallResourceResponse
		err = app.CallResource(context.Background(), &backend.CallResourceRequest{
			PluginContext: adminPluginContext(),
			Path:          "test-connection",
			Method:        http.MethodPost,
			Body:          payload,
		}, callResourceResponseSenderFunc(func(r *backend.CallResourceResponse) error {
			resp = *r
			return nil
		}))
		if err != nil {
			t.Fatal(err)
		}
		if resp.Status != http.StatusBadRequest {
			t.Fatalf("status=%d body=%s", resp.Status, string(resp.Body))
		}
		if atomic.LoadInt32(&hits) != 0 {
			t.Fatalf("draft host was contacted %d times", hits)
		}
		var body testConnectionResponse
		if err := json.Unmarshal(resp.Body, &body); err != nil {
			t.Fatal(err)
		}
		if body.Status != "error" {
			t.Fatalf("body=%+v", body)
		}
	})

	t.Run("draft_url_non_admin_403_no_dial", func(t *testing.T) {
		var hits int32
		draft := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			atomic.AddInt32(&hits, 1)
			t.Errorf("draft host must not be contacted for non-admin")
			w.WriteHeader(http.StatusOK)
		}))
		defer draft.Close()

		inst, err := NewApp(context.Background(), backend.AppInstanceSettings{
			JSONData:                []byte(`{"apiUrl":"http://saved.example"}`),
			DecryptedSecureJSONData: map[string]string{"apiKey": "stored"},
		})
		if err != nil {
			t.Fatal(err)
		}
		app := inst.(*App)
		defer app.Dispose()
		app.httpClient = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			atomic.AddInt32(&hits, 1)
			t.Fatal("HTTP client must not be used for non-admin draft URL")
			return nil, nil
		})}

		payload, _ := json.Marshal(map[string]string{
			"apiUrl": draft.URL,
			"apiKey": "draft-key",
		})
		var resp backend.CallResourceResponse
		err = app.CallResource(context.Background(), &backend.CallResourceRequest{
			PluginContext: editorPluginContext(),
			Path:          "test-connection",
			Method:        http.MethodPost,
			Body:          payload,
		}, callResourceResponseSenderFunc(func(r *backend.CallResourceResponse) error {
			resp = *r
			return nil
		}))
		if err != nil {
			t.Fatal(err)
		}
		if resp.Status != http.StatusForbidden {
			t.Fatalf("status=%d body=%s", resp.Status, string(resp.Body))
		}
		if atomic.LoadInt32(&hits) != 0 {
			t.Fatalf("HTTP was used %d times", hits)
		}
	})

	t.Run("draft_url_missing_user_403_no_dial", func(t *testing.T) {
		var hits int32
		noDial := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			atomic.AddInt32(&hits, 1)
			t.Fatal("HTTP client must not be used when user is missing on draft URL")
			return nil, nil
		})}

		inst, err := NewApp(context.Background(), backend.AppInstanceSettings{
			JSONData:                []byte(`{"apiUrl":"http://saved.example"}`),
			DecryptedSecureJSONData: map[string]string{"apiKey": "stored"},
		})
		if err != nil {
			t.Fatal(err)
		}
		app := inst.(*App)
		defer app.Dispose()
		app.httpClient = noDial

		payload, _ := json.Marshal(map[string]string{
			"apiUrl": "http://draft.example",
			"apiKey": "draft-key",
		})
		var resp backend.CallResourceResponse
		err = app.CallResource(context.Background(), &backend.CallResourceRequest{
			// PluginContext.User intentionally omitted
			Path:   "test-connection",
			Method: http.MethodPost,
			Body:   payload,
		}, callResourceResponseSenderFunc(func(r *backend.CallResourceResponse) error {
			resp = *r
			return nil
		}))
		if err != nil {
			t.Fatal(err)
		}
		if resp.Status != http.StatusForbidden {
			t.Fatalf("status=%d body=%s", resp.Status, string(resp.Body))
		}
		if atomic.LoadInt32(&hits) != 0 {
			t.Fatalf("HTTP was used %d times", hits)
		}
	})

	t.Run("draft_url_admin_proceeds", func(t *testing.T) {
		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"connected":true}`))
		}))
		defer upstream.Close()

		inst, err := NewApp(context.Background(), backend.AppInstanceSettings{
			JSONData:                []byte(`{"apiUrl":"http://saved.example"}`),
			DecryptedSecureJSONData: map[string]string{"apiKey": "stored"},
		})
		if err != nil {
			t.Fatal(err)
		}
		app := inst.(*App)
		defer app.Dispose()

		payload, _ := json.Marshal(map[string]string{
			"apiUrl": upstream.URL,
			"apiKey": "draft-token",
		})
		var resp backend.CallResourceResponse
		err = app.CallResource(context.Background(), &backend.CallResourceRequest{
			PluginContext: adminPluginContext(),
			Path:          "test-connection",
			Method:        http.MethodPost,
			Body:          payload,
		}, callResourceResponseSenderFunc(func(r *backend.CallResourceResponse) error {
			resp = *r
			return nil
		}))
		if err != nil {
			t.Fatal(err)
		}
		if resp.Status != http.StatusOK {
			t.Fatalf("status=%d body=%s", resp.Status, string(resp.Body))
		}
		var body testConnectionResponse
		if err := json.Unmarshal(resp.Body, &body); err != nil {
			t.Fatal(err)
		}
		if body.Status != "ok" {
			t.Fatalf("body=%+v", body)
		}
	})

}


func TestProxyTools(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		if auth != "Bearer tok" {
			http.Error(w, `{"error":"UNAUTHORIZED"}`, http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/api/v1/tools/query":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"success":true,"data":{"result":{"summary":"ok-query"}}}`))
		case "/api/v1/tools/remediate":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"success":true,"data":{"result":{"summary":"ok-remediate"}}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	inst, err := NewApp(context.Background(), backend.AppInstanceSettings{
		JSONData: []byte(`{"apiUrl":"` + upstream.URL + `"}`),
		DecryptedSecureJSONData: map[string]string{"apiKey": "tok"},
	})
	if err != nil {
		t.Fatal(err)
	}
	app := inst.(*App)
	defer app.Dispose()

	for _, tc := range []struct {
		path string
		want string
	}{
		{"query", "ok-query"},
		{"remediate", "ok-remediate"},
	} {
		tc := tc
		t.Run(tc.path, func(t *testing.T) {
			var resp backend.CallResourceResponse
			err := app.CallResource(context.Background(), &backend.CallResourceRequest{
				Path:   tc.path,
				Method: http.MethodPost,
				Body:   []byte(`{"intent":"test"}`),
			}, callResourceResponseSenderFunc(func(r *backend.CallResourceResponse) error {
				resp = *r
				return nil
			}))
			if err != nil {
				t.Fatal(err)
			}
			if resp.Status != http.StatusOK {
				t.Fatalf("status=%d body=%s", resp.Status, string(resp.Body))
			}
			var env toolProxyResponse
			if err := json.Unmarshal(resp.Body, &env); err != nil {
				t.Fatalf("envelope json: %v body=%s", err, string(resp.Body))
			}
			if !env.OK {
				t.Fatalf("expected ok=true body=%+v", env)
			}
			if env.Status != http.StatusOK {
				t.Fatalf("envelope status=%d body=%+v", env.Status, env)
			}
			if env.Summary != tc.want {
				t.Fatalf("summary=%q want %q body=%+v", env.Summary, tc.want, env)
			}
			if env.Error != "" {
				t.Fatalf("expected empty error, got %q", env.Error)
			}
		})
	}

	t.Run("upstream_error_envelope", func(t *testing.T) {
		bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(`{"success":false,"error":{"code":"EXECUTION_ERROR","message":"llm down"}}`))
		}))
		defer bad.Close()
		inst2, err := NewApp(context.Background(), backend.AppInstanceSettings{
			JSONData:                []byte(`{"apiUrl":"` + bad.URL + `"}`),
			DecryptedSecureJSONData: map[string]string{"apiKey": "tok"},
		})
		if err != nil {
			t.Fatal(err)
		}
		app2 := inst2.(*App)
		defer app2.Dispose()
		var resp backend.CallResourceResponse
		err = app2.CallResource(context.Background(), &backend.CallResourceRequest{
			Path:   "query",
			Method: http.MethodPost,
			Body:   []byte(`{"intent":"x"}`),
		}, callResourceResponseSenderFunc(func(r *backend.CallResourceResponse) error {
			resp = *r
			return nil
		}))
		if err != nil {
			t.Fatal(err)
		}
		if resp.Status != http.StatusInternalServerError {
			t.Fatalf("status=%d", resp.Status)
		}
		var env toolProxyResponse
		if err := json.Unmarshal(resp.Body, &env); err != nil {
			t.Fatalf("envelope json: %v body=%s", err, string(resp.Body))
		}
		if env.OK {
			t.Fatalf("expected ok=false body=%+v", env)
		}
		if env.Status != http.StatusInternalServerError {
			t.Fatalf("envelope status=%d body=%+v", env.Status, env)
		}
		if env.Error != "EXECUTION_ERROR: llm down" {
			t.Fatalf("error=%q body=%+v", env.Error, env)
		}
		if env.Summary != "" {
			t.Fatalf("summary should be empty on error, got %q", env.Summary)
		}
		if bytes.Contains(resp.Body, []byte(`"success"`)) {
			t.Fatalf("raw upstream leaked: %s", string(resp.Body))
		}
	})
}

func TestRemediateAnalysisOnly(t *testing.T) {
	var gotPath string
	var gotBody []byte
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success":true,"data":{"result":{"summary":"analysis"}}}`))
	}))
	defer upstream.Close()

	inst, err := NewApp(context.Background(), backend.AppInstanceSettings{
		JSONData:                []byte(`{"apiUrl":"` + upstream.URL + `"}`),
		DecryptedSecureJSONData: map[string]string{"apiKey": "tok"},
	})
	if err != nil {
		t.Fatal(err)
	}
	app := inst.(*App)
	defer app.Dispose()

	t.Run("strips_execute_apply_mode", func(t *testing.T) {
		gotPath, gotBody = "", nil
		payload := []byte(`{
			"intent":"why is checkout CrashLooping",
			"issue":"checkout-api CrashLoopBackOff",
			"execute":true,
			"apply":true,
			"mode":"execute",
			"confirmationToken":"abc",
			"confirm":true
		}`)
		var resp backend.CallResourceResponse
		err := app.CallResource(context.Background(), &backend.CallResourceRequest{
			Path:   "remediate",
			Method: http.MethodPost,
			Body:   payload,
		}, callResourceResponseSenderFunc(func(r *backend.CallResourceResponse) error {
			resp = *r
			return nil
		}))
		if err != nil {
			t.Fatal(err)
		}
		if resp.Status != http.StatusOK {
			t.Fatalf("status=%d body=%s", resp.Status, string(resp.Body))
		}
		if gotPath != "/api/v1/tools/remediate" {
			t.Fatalf("path=%q", gotPath)
		}
		var forwarded map[string]any
		if err := json.Unmarshal(gotBody, &forwarded); err != nil {
			t.Fatalf("outbound body=%s err=%v", string(gotBody), err)
		}
		if len(forwarded) != 2 {
			t.Fatalf("want only intent+issue, got %v", forwarded)
		}
		if forwarded["intent"] != "why is checkout CrashLooping" {
			t.Fatalf("intent=%v", forwarded["intent"])
		}
		if forwarded["issue"] != "checkout-api CrashLoopBackOff" {
			t.Fatalf("issue=%v", forwarded["issue"])
		}
		for _, banned := range []string{"execute", "apply", "mode", "confirmationToken", "confirm"} {
			if _, ok := forwarded[banned]; ok {
				t.Fatalf("banned field %q present in outbound body: %s", banned, string(gotBody))
			}
			if bytes.Contains(gotBody, []byte(`"`+banned+`"`)) {
				t.Fatalf("banned key %q still in raw outbound body: %s", banned, string(gotBody))
			}
		}
	})

	t.Run("invalid_json_400", func(t *testing.T) {
		gotPath, gotBody = "", nil
		var resp backend.CallResourceResponse
		err := app.CallResource(context.Background(), &backend.CallResourceRequest{
			Path:   "remediate",
			Method: http.MethodPost,
			Body:   []byte(`not-json`),
		}, callResourceResponseSenderFunc(func(r *backend.CallResourceResponse) error {
			resp = *r
			return nil
		}))
		if err != nil {
			t.Fatal(err)
		}
		if resp.Status != http.StatusBadRequest {
			t.Fatalf("status=%d body=%s", resp.Status, string(resp.Body))
		}
		if gotPath != "" {
			t.Fatalf("upstream should not be called, path=%q", gotPath)
		}
	})

	t.Run("empty_issue_400_no_upstream", func(t *testing.T) {
		gotPath, gotBody = "", nil
		var resp backend.CallResourceResponse
		err := app.CallResource(context.Background(), &backend.CallResourceRequest{
			Path:   "remediate",
			Method: http.MethodPost,
			Body:   []byte(`{}`),
		}, callResourceResponseSenderFunc(func(r *backend.CallResourceResponse) error {
			resp = *r
			return nil
		}))
		if err != nil {
			t.Fatal(err)
		}
		if resp.Status != http.StatusBadRequest {
			t.Fatalf("status=%d body=%s", resp.Status, string(resp.Body))
		}
		if gotPath != "" {
			t.Fatalf("upstream should not be called, path=%q body=%s", gotPath, string(gotBody))
		}
		var env toolProxyResponse
		if err := json.Unmarshal(resp.Body, &env); err != nil {
			t.Fatalf("envelope json: %v body=%s", err, string(resp.Body))
		}
		if env.OK {
			t.Fatalf("expected ok=false body=%+v", env)
		}
		if env.Error != "issue is required" {
			t.Fatalf("error=%q body=%+v", env.Error, env)
		}
	})


	t.Run("query_still_forwards_extra_fields", func(t *testing.T) {
		gotPath, gotBody = "", nil
		payload := []byte(`{"intent":"list pods","execute":true,"mode":"execute"}`)
		var resp backend.CallResourceResponse
		err := app.CallResource(context.Background(), &backend.CallResourceRequest{
			Path:   "query",
			Method: http.MethodPost,
			Body:   payload,
		}, callResourceResponseSenderFunc(func(r *backend.CallResourceResponse) error {
			resp = *r
			return nil
		}))
		if err != nil {
			t.Fatal(err)
		}
		if resp.Status != http.StatusOK {
			t.Fatalf("status=%d body=%s", resp.Status, string(resp.Body))
		}
		if gotPath != "/api/v1/tools/query" {
			t.Fatalf("path=%q", gotPath)
		}
		var forwarded map[string]any
		if err := json.Unmarshal(gotBody, &forwarded); err != nil {
			t.Fatalf("outbound body=%s err=%v", string(gotBody), err)
		}
		if forwarded["intent"] != "list pods" {
			t.Fatalf("intent=%v body=%s", forwarded["intent"], string(gotBody))
		}
		// Query path is unchanged: extra keys are still forwarded.
		if _, ok := forwarded["execute"]; !ok {
			t.Fatalf("query should forward execute unchanged, body=%s", string(gotBody))
		}
	})
}



func TestCheckHealth(t *testing.T) {
	inst, err := NewApp(context.Background(), backend.AppInstanceSettings{})
	if err != nil {
		t.Fatal(err)
	}
	app := inst.(*App)
	defer app.Dispose()

	res, err := app.CheckHealth(context.Background(), &backend.CheckHealthRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != backend.HealthStatusUnknown {
		t.Fatalf("status=%v msg=%s", res.Status, res.Message)
	}
}

func TestValidateAPIURL(t *testing.T) {
	t.Run("rejects_non_http_schemes_and_hostless", func(t *testing.T) {
		cases := []string{
			"file:///etc/passwd",
			"javascript:alert(1)",
			"http://",
			"https://",
			"/relative/path",
			"example.com",
			"",
			"ftp://example.com",
		}
		for _, raw := range cases {
			raw := raw
			t.Run(raw, func(t *testing.T) {
				if _, err := validateAPIURL(raw); err == nil {
					t.Fatalf("expected error for %q", raw)
				}
			})
		}
	})

	t.Run("accepts_http_example_invalid_at_parse_layer", func(t *testing.T) {
		base, err := validateAPIURL("http://example.invalid")
		if err != nil {
			t.Fatal(err)
		}
		if base != "http://example.invalid" {
			t.Fatalf("base=%q", base)
		}
	})

	t.Run("accepts_https_and_trims_slash", func(t *testing.T) {
		base, err := validateAPIURL("https://dot-ai.example.com/v1/")
		if err != nil {
			t.Fatal(err)
		}
		if base != "https://dot-ai.example.com/v1" {
			t.Fatalf("base=%q", base)
		}
	})
}

func TestRejectsUnsafeAPIURLBeforeDial(t *testing.T) {
	// Transport that fails the test if any outbound request is attempted.
	noDial := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		t.Fatal("outbound HTTP must not be dialed for rejected apiUrl")
		return nil, nil
	})}

	cases := []struct {
		name   string
		apiURL string
	}{
		{"file", "file:///tmp/x"},
		{"javascript", "javascript:alert(1)"},
		{"missing_host", "http://"},
	}

	for _, tc := range cases {
		tc := tc
		t.Run("test_connection_"+tc.name, func(t *testing.T) {
			inst, err := NewApp(context.Background(), backend.AppInstanceSettings{})
			if err != nil {
				t.Fatal(err)
			}
			app := inst.(*App)
			defer app.Dispose()
			app.httpClient = noDial
			app.toolHTTPClient = noDial

			payload, _ := json.Marshal(map[string]string{
				"apiUrl": tc.apiURL,
				"apiKey": "tok",
			})
			var resp backend.CallResourceResponse
			err = app.CallResource(context.Background(), &backend.CallResourceRequest{
				PluginContext: adminPluginContext(),
				Path:          "test-connection",
				Method:        http.MethodPost,
				Body:          payload,
			}, callResourceResponseSenderFunc(func(r *backend.CallResourceResponse) error {
				resp = *r
				return nil
			}))
			if err != nil {
				t.Fatal(err)
			}
			if resp.Status != http.StatusBadRequest {
				t.Fatalf("status=%d body=%s", resp.Status, string(resp.Body))
			}
		})

		t.Run("health_"+tc.name, func(t *testing.T) {
			inst, err := NewApp(context.Background(), backend.AppInstanceSettings{
				JSONData:                []byte(`{"apiUrl":` + jsonString(tc.apiURL) + `}`),
				DecryptedSecureJSONData: map[string]string{"apiKey": "tok"},
			})
			if err != nil {
				t.Fatal(err)
			}
			app := inst.(*App)
			defer app.Dispose()
			app.httpClient = noDial
			app.toolHTTPClient = noDial

			var resp backend.CallResourceResponse
			err = app.CallResource(context.Background(), &backend.CallResourceRequest{
				Path:   "health",
				Method: http.MethodGet,
			}, callResourceResponseSenderFunc(func(r *backend.CallResourceResponse) error {
				resp = *r
				return nil
			}))
			if err != nil {
				t.Fatal(err)
			}
			if resp.Status != http.StatusBadRequest {
				t.Fatalf("status=%d body=%s", resp.Status, string(resp.Body))
			}
		})

		for _, path := range []string{"query", "remediate"} {
			path := path
			t.Run(path+"_"+tc.name, func(t *testing.T) {
				inst, err := NewApp(context.Background(), backend.AppInstanceSettings{
					JSONData:                []byte(`{"apiUrl":` + jsonString(tc.apiURL) + `}`),
					DecryptedSecureJSONData: map[string]string{"apiKey": "tok"},
				})
				if err != nil {
					t.Fatal(err)
				}
				app := inst.(*App)
				defer app.Dispose()
				app.httpClient = noDial
				app.toolHTTPClient = noDial

				var resp backend.CallResourceResponse
				err = app.CallResource(context.Background(), &backend.CallResourceRequest{
					Path:   path,
					Method: http.MethodPost,
					Body:   []byte(`{"intent":"x"}`),
				}, callResourceResponseSenderFunc(func(r *backend.CallResourceResponse) error {
					resp = *r
					return nil
				}))
				if err != nil {
					t.Fatal(err)
				}
				if resp.Status != http.StatusBadRequest {
					t.Fatalf("status=%d body=%s", resp.Status, string(resp.Body))
				}
			})
		}
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

func jsonString(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}
