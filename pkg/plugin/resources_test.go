package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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
			PluginContext: adminPluginContext(),
			Path:          "test-connection",
			Method:        http.MethodPost,
			Body:          []byte(`{}`),
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

	t.Run("connected_unknown_shape_does_not_claim_success", func(t *testing.T) {
		cases := []struct {
			name string
			body string
		}{
			{"missing_connected_key", `{"success":true,"data":{"result":{}}}`},
			{"connected_not_a_bool", `{"success":true,"data":{"result":{"connected":"true"}}}`},
		}
		for _, tc := range cases {
			tc := tc
			t.Run(tc.name, func(t *testing.T) {
				upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("Content-Type", "application/json")
					_, _ = w.Write([]byte(tc.body))
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
				if body.Connected != nil {
					t.Fatalf("expected Connected=nil for unrecognized shape, got %+v", *body.Connected)
				}
				if body.Message != "connected to dot-ai (cluster connectivity unknown)" {
					t.Fatalf("expected unknown-connectivity message, got %q", body.Message)
				}
			})
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
			PluginContext: adminPluginContext(),
			Path:          "test-connection",
			Method:        http.MethodPost,
			Body:          []byte(`{}`),
		}, callResourceResponseSenderFunc(func(r *backend.CallResourceResponse) error {
			resp = *r
			return nil
		}))
		if err != nil {
			t.Fatal(err)
		}
		if resp.Status != http.StatusBadGateway {
			t.Fatalf("status=%d body=%s (upstream 401 must map to 502)", resp.Status, string(resp.Body))
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
			PluginContext: adminPluginContext(),
			Path:          "test-connection",
			Method:        http.MethodPost,
			Body:          []byte(`{}`),
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
		var body testConnectionResponse
		if err := json.Unmarshal(resp.Body, &body); err != nil {
			t.Fatal(err)
		}
		if body.Status != "error" {
			t.Fatalf("body=%+v", body)
		}
		if !strings.Contains(body.Message, "Admin role required") {
			t.Fatalf("expected clear Admin gate message, got %q", body.Message)
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
		var body testConnectionResponse
		if err := json.Unmarshal(resp.Body, &body); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(body.Message, "Admin role required") {
			t.Fatalf("expected clear Admin gate message, got %q", body.Message)
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

	t.Run("saved_url_editor_requires_admin", func(t *testing.T) {
		// Viktor: non-Admin must not probe the saved apiUrl.
		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if got := r.Header.Get("Authorization"); got != "Bearer from-settings" {
				t.Errorf("Authorization=%q", got)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"connected":true}`))
		}))
		defer upstream.Close()

		inst, err := NewApp(context.Background(), backend.AppInstanceSettings{
			JSONData:                []byte(`{"apiUrl":"` + upstream.URL + `"}`),
			DecryptedSecureJSONData: map[string]string{"apiKey": "from-settings"},
		})
		if err != nil {
			t.Fatal(err)
		}
		app := inst.(*App)
		defer app.Dispose()

		var resp backend.CallResourceResponse
		err = app.CallResource(context.Background(), &backend.CallResourceRequest{
			PluginContext: editorPluginContext(),
			Path:          "test-connection",
			Method:        http.MethodPost,
			Body:          []byte(`{}`),
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
	})

	t.Run("same_url_as_saved_editor_requires_admin", func(t *testing.T) {
		// Same draft apiUrl as saved still requires Admin.
		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"connected":true}`))
		}))
		defer upstream.Close()

		inst, err := NewApp(context.Background(), backend.AppInstanceSettings{
			JSONData:                []byte(`{"apiUrl":"` + upstream.URL + `"}`),
			DecryptedSecureJSONData: map[string]string{"apiKey": "from-settings"},
		})
		if err != nil {
			t.Fatal(err)
		}
		app := inst.(*App)
		defer app.Dispose()

		payload, _ := json.Marshal(map[string]string{
			"apiUrl": upstream.URL,
			"apiKey": "",
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

	t.Run("upstream_401_maps_to_502_envelope", func(t *testing.T) {
		unauth := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":{"message":"bad token"}}`))
		}))
		defer unauth.Close()
		inst2, err := NewApp(context.Background(), backend.AppInstanceSettings{
			JSONData:                []byte(`{"apiUrl":"` + unauth.URL + `"}`),
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
		if resp.Status != http.StatusBadGateway {
			t.Fatalf("status=%d want 502 body=%s", resp.Status, string(resp.Body))
		}
		var env toolProxyResponse
		if err := json.Unmarshal(resp.Body, &env); err != nil {
			t.Fatalf("envelope json: %v body=%s", err, string(resp.Body))
		}
		if env.OK {
			t.Fatalf("expected ok=false body=%+v", env)
		}
		if env.Status != http.StatusBadGateway {
			t.Fatalf("envelope status=%d body=%+v", env.Status, env)
		}
		if env.Error == "" {
			t.Fatalf("expected error message body=%+v", env)
		}
	})

	t.Run("upstream_403_maps_to_502_envelope", func(t *testing.T) {
		forbid := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"error":"FORBIDDEN"}`))
		}))
		defer forbid.Close()
		inst2, err := NewApp(context.Background(), backend.AppInstanceSettings{
			JSONData:                []byte(`{"apiUrl":"` + forbid.URL + `"}`),
			DecryptedSecureJSONData: map[string]string{"apiKey": "tok"},
		})
		if err != nil {
			t.Fatal(err)
		}
		app2 := inst2.(*App)
		defer app2.Dispose()
		var resp backend.CallResourceResponse
		err = app2.CallResource(context.Background(), &backend.CallResourceRequest{
			Path:   "remediate",
			Method: http.MethodPost,
			Body:   []byte(`{"issue":"x"}`),
		}, callResourceResponseSenderFunc(func(r *backend.CallResourceResponse) error {
			resp = *r
			return nil
		}))
		if err != nil {
			t.Fatal(err)
		}
		if resp.Status != http.StatusBadGateway {
			t.Fatalf("status=%d want 502 body=%s", resp.Status, string(resp.Body))
		}
		var env toolProxyResponse
		if err := json.Unmarshal(resp.Body, &env); err != nil {
			t.Fatal(err)
		}
		if env.OK || env.Status != http.StatusBadGateway {
			t.Fatalf("envelope=%+v", env)
		}
	})
}

func TestProxyBodyLimits(t *testing.T) {
	t.Run("body_over_1mib_rejected_413", func(t *testing.T) {
		var upstreamHit bool
		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			upstreamHit = true
			w.WriteHeader(http.StatusOK)
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

		oversized := []byte(`{"intent":"` + strings.Repeat("x", (1<<20)+1) + `"}`)
		var resp backend.CallResourceResponse
		err = app.CallResource(context.Background(), &backend.CallResourceRequest{
			Path:   "query",
			Method: http.MethodPost,
			Body:   oversized,
		}, callResourceResponseSenderFunc(func(r *backend.CallResourceResponse) error {
			resp = *r
			return nil
		}))
		if err != nil {
			t.Fatal(err)
		}
		if resp.Status != http.StatusRequestEntityTooLarge {
			t.Fatalf("status=%d body=%s", resp.Status, string(resp.Body))
		}
		if upstreamHit {
			t.Fatalf("upstream must not be dialed for an oversized body")
		}
	})

	t.Run("empty_body_requires_intent", func(t *testing.T) {
		var gotBody []byte
		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			gotBody, _ = io.ReadAll(r.Body)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"success":true,"data":{"result":{"summary":"ok"}}}`))
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

		var resp backend.CallResourceResponse
		err = app.CallResource(context.Background(), &backend.CallResourceRequest{
			Path:   "query",
			Method: http.MethodPost,
			Body:   []byte(``),
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
		if !strings.Contains(string(resp.Body), "intent is required") {
			t.Fatalf("want intent required, got %s", string(resp.Body))
		}
		if len(gotBody) != 0 {
			t.Fatalf("upstream must not be dialed without intent, got %q", string(gotBody))
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


	t.Run("query_allowlists_intent_only", func(t *testing.T) {
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
		if _, ok := forwarded["execute"]; ok {
			t.Fatalf("query must not forward execute, body=%s", string(gotBody))
		}
		if _, ok := forwarded["mode"]; ok {
			t.Fatalf("query must not forward mode, body=%s", string(gotBody))
		}
		if len(forwarded) != 1 {
			t.Fatalf("want only intent, got %v", forwarded)
		}
	})
}



func TestCheckHealth(t *testing.T) {
	t.Run("unconfigured", func(t *testing.T) {
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
	})

	t.Run("configured_valid_credentials_probes_and_reports_ok", func(t *testing.T) {
		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"success":true,"data":{"result":{"connected":true}}}`))
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

		res, err := app.CheckHealth(context.Background(), &backend.CheckHealthRequest{})
		if err != nil {
			t.Fatal(err)
		}
		if res.Status != backend.HealthStatusOk {
			t.Fatalf("status=%v msg=%s (expected Ok when dot-ai actually responds)", res.Status, res.Message)
		}
	})

	t.Run("configured_invalid_credentials_reports_error_not_ok", func(t *testing.T) {
		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, `{"error":"UNAUTHORIZED"}`, http.StatusUnauthorized)
		}))
		defer upstream.Close()

		inst, err := NewApp(context.Background(), backend.AppInstanceSettings{
			JSONData:                []byte(`{"apiUrl":"` + upstream.URL + `"}`),
			DecryptedSecureJSONData: map[string]string{"apiKey": "bad"},
		})
		if err != nil {
			t.Fatal(err)
		}
		app := inst.(*App)
		defer app.Dispose()

		res, err := app.CheckHealth(context.Background(), &backend.CheckHealthRequest{})
		if err != nil {
			t.Fatal(err)
		}
		if res.Status != backend.HealthStatusError {
			t.Fatalf("status=%v msg=%s (expected Error when dot-ai rejects the token, not silently Ok)", res.Status, res.Message)
		}
	})
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

	t.Run("rejects_http_example_invalid_at_parse_layer", func(t *testing.T) {
		_, err := validateAPIURL("http://example.invalid")
		if err == nil {
			t.Fatal("expected error for http://example.invalid")
		}
		want := "http apiUrl is only allowed for loopback, RFC1918, or in-cluster DNS; use https"
		if err.Error() != want {
			t.Fatalf("err=%q want=%q", err.Error(), want)
		}
	})

	t.Run("rejects_public_http_example_com", func(t *testing.T) {
		_, err := validateAPIURL("http://example.com")
		if err == nil {
			t.Fatal("expected error for http://example.com")
		}
		want := "http apiUrl is only allowed for loopback, RFC1918, or in-cluster DNS; use https"
		if err.Error() != want {
			t.Fatalf("err=%q want=%q", err.Error(), want)
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

	t.Run("accepts_http_loopback_rfc1918_incluster", func(t *testing.T) {
		cases := []string{
			"http://dot-ai.dot-ai.svc:3456",
			"http://127.0.0.1:3456",
			"http://10.43.0.10:3456",
		}
		for _, raw := range cases {
			raw := raw
			t.Run(raw, func(t *testing.T) {
				base, err := validateAPIURL(raw)
				if err != nil {
					t.Fatal(err)
				}
				if base != raw {
					t.Fatalf("base=%q", base)
				}
			})
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

func TestAskLogFile(t *testing.T) {
	dir := t.TempDir()
	logPath := filepath.Join(dir, "dotai-ask.log")
	prev := askLogPath
	askLogPath = logPath
	t.Cleanup(func() { askLogPath = prev })

	const secret = "super-secret-token-value"
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer "+secret {
			http.Error(w, `{"error":"UNAUTHORIZED"}`, http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/tools/query":
			_, _ = w.Write([]byte(`{"success":true,"data":{"result":{"summary":"pods healthy"}}}`))
		case "/api/v1/tools/remediate":
			_, _ = w.Write([]byte(`{"success":true,"data":{"result":{"summary":"restart deployment"}}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	inst, err := NewApp(context.Background(), backend.AppInstanceSettings{
		JSONData:                []byte(`{"apiUrl":"` + upstream.URL + `","debugLog":true}`),
		DecryptedSecureJSONData: map[string]string{"apiKey": secret},
	})
	if err != nil {
		t.Fatal(err)
	}
	app := inst.(*App)
	defer app.Dispose()

	call := func(path string, body []byte) toolProxyResponse {
		t.Helper()
		var resp backend.CallResourceResponse
		err := app.CallResource(context.Background(), &backend.CallResourceRequest{
			Path:   path,
			Method: http.MethodPost,
			Body:   body,
		}, callResourceResponseSenderFunc(func(r *backend.CallResourceResponse) error {
			resp = *r
			return nil
		}))
		if err != nil {
			t.Fatal(err)
		}
		if resp.Status != http.StatusOK {
			t.Fatalf("%s status=%d body=%s", path, resp.Status, string(resp.Body))
		}
		var env toolProxyResponse
		if err := json.Unmarshal(resp.Body, &env); err != nil {
			t.Fatalf("envelope: %v body=%s", err, string(resp.Body))
		}
		return env
	}

	// Body deliberately includes apiKey to prove it is never written to the log.
	qEnv := call("query", []byte(`{"intent":"how many pods?","apiKey":"`+secret+`","Authorization":"Bearer `+secret+`"}`))
	if qEnv.Summary != "pods healthy" {
		t.Fatalf("query summary=%q", qEnv.Summary)
	}
	rEnv := call("remediate", []byte(`{"issue":"checkout CrashLoop","apiKey":"`+secret+`"}`))
	if rEnv.Summary != "restart deployment" {
		t.Fatalf("remediate summary=%q", rEnv.Summary)
	}

	raw, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("read ask log: %v", err)
	}
	if len(raw) == 0 {
		t.Fatal("ask log empty after query/remediate")
	}
	lines := strings.Split(strings.TrimSpace(string(raw)), "\n")
	if len(lines) != 2 {
		t.Fatalf("want 2 log lines, got %d raw=%q", len(lines), string(raw))
	}

	forbid := []string{secret, "Bearer", "apiKey", "Authorization", "super-secret"}
	for i, line := range lines {
		for _, bad := range forbid {
			if strings.Contains(line, bad) {
				t.Fatalf("line %d contains forbidden %q: %s", i, bad, line)
			}
		}
		var entry askLogEntry
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			t.Fatalf("line %d json: %v raw=%s", i, err, line)
		}
		if entry.Time == "" {
			t.Fatalf("line %d missing time: %+v", i, entry)
		}
		if entry.Status != http.StatusOK {
			t.Fatalf("line %d status=%d", i, entry.Status)
		}
		switch i {
		case 0:
			if entry.Tool != "query" {
				t.Fatalf("line0 tool=%q", entry.Tool)
			}
			if entry.Body != "how many pods?" {
				t.Fatalf("line0 body=%q", entry.Body)
			}
			if entry.Summary != "pods healthy" {
				t.Fatalf("line0 summary=%q", entry.Summary)
			}
			if entry.Error != "" {
				t.Fatalf("line0 error=%q", entry.Error)
			}
		case 1:
			if entry.Tool != "remediate" {
				t.Fatalf("line1 tool=%q", entry.Tool)
			}
			if entry.Body != "checkout CrashLoop" {
				t.Fatalf("line1 body=%q", entry.Body)
			}
			if entry.Summary != "restart deployment" {
				t.Fatalf("line1 summary=%q", entry.Summary)
			}
		}
	}

	// Error path also logs (status + error, no token).
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":{"message":"llm down"}}`))
	}))
	defer bad.Close()
	inst2, err := NewApp(context.Background(), backend.AppInstanceSettings{
		JSONData:                []byte(`{"apiUrl":"` + bad.URL + `","debugLog":true}`),
		DecryptedSecureJSONData: map[string]string{"apiKey": secret},
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
		Body:   []byte(`{"intent":"fail please"}`),
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

	raw, err = os.ReadFile(logPath)
	if err != nil {
		t.Fatal(err)
	}
	lines = strings.Split(strings.TrimSpace(string(raw)), "\n")
	if len(lines) != 3 {
		t.Fatalf("want 3 log lines after error, got %d", len(lines))
	}
	var errEntry askLogEntry
	if err := json.Unmarshal([]byte(lines[2]), &errEntry); err != nil {
		t.Fatal(err)
	}
	if errEntry.Tool != "query" || errEntry.Status != http.StatusInternalServerError {
		t.Fatalf("err entry=%+v", errEntry)
	}
	if errEntry.Body != "fail please" {
		t.Fatalf("err body=%q", errEntry.Body)
	}
	if errEntry.Error != "llm down" {
		t.Fatalf("err error=%q", errEntry.Error)
	}
	if strings.Contains(lines[2], secret) {
		t.Fatalf("error line leaked secret: %s", lines[2])
	}
}

func TestAskLogDisabledByDefault(t *testing.T) {
	dir := t.TempDir()
	logPath := filepath.Join(dir, "dotai-ask.log")
	prev := askLogPath
	askLogPath = logPath
	t.Cleanup(func() { askLogPath = prev })

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success":true,"data":{"result":{"summary":"ok"}}}`))
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

	err = app.CallResource(context.Background(), &backend.CallResourceRequest{
		Path:   "query",
		Method: http.MethodPost,
		Body:   []byte(`{"intent":"list pods"}`),
	}, callResourceResponseSenderFunc(func(*backend.CallResourceResponse) error { return nil }))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(logPath); !os.IsNotExist(err) {
		t.Fatalf("ask log should not exist when debugLog is off: %v", err)
	}
}


func TestAppendAskLogRotatesAtMaxSize(t *testing.T) {
	dir := t.TempDir()
	logPath := filepath.Join(dir, "dotai-ask.log")
	prev := askLogPath
	askLogPath = logPath
	t.Cleanup(func() { askLogPath = prev })

	// Seed a file at/over the cap so the next append rotates.
	seed := bytes.Repeat([]byte("x"), maxAskLogBytes)
	if err := os.WriteFile(logPath, seed, 0o640); err != nil {
		t.Fatal(err)
	}

	appendAskLog("query", []byte(`{"intent":"after-rotate"}`), http.StatusOK, "rotated-summary", "")

	info, err := os.Stat(logPath)
	if err != nil {
		t.Fatalf("stat current log: %v", err)
	}
	if info.Size() >= maxAskLogBytes {
		t.Fatalf("current log should be fresh after rotate, size=%d", info.Size())
	}
	raw, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(raw, []byte("after-rotate")) {
		t.Fatalf("new line missing from rotated log: %s", string(raw))
	}
	if !bytes.Contains(raw, []byte("rotated-summary")) {
		t.Fatalf("summary missing: %s", string(raw))
	}

	rotated, err := os.ReadFile(logPath + ".1")
	if err != nil {
		t.Fatalf("expected rotated .1 file: %v", err)
	}
	if len(rotated) != maxAskLogBytes {
		t.Fatalf("rotated size=%d want %d", len(rotated), maxAskLogBytes)
	}
}

func TestAskBodyPreviewStripsSecrets(t *testing.T) {
	got := askBodyPreview([]byte(`{"intent":"hello","apiKey":"sekrit","Authorization":"Bearer sekrit"}`))
	if got != "hello" {
		t.Fatalf("got %q", got)
	}
	if strings.Contains(got, "sekrit") || strings.Contains(got, "Bearer") {
		t.Fatalf("leaked secret in %q", got)
	}
	// Over-long bodies keep head AND tail: the question is packed after Current, so a
	// head-only cut drops the follow-up prompt that identifies the hop branch.
	long := strings.Repeat("x", 5000)
	got = askBodyPreview([]byte(`{"issue":"` + long + `"}`))
	if len([]rune(got)) != 4096+len([]rune("…[+904]…")) {
		t.Fatalf("truncate len=%d got=%q", len([]rune(got)), got)
	}
	if !strings.Contains(got, "…[+904]…") {
		t.Fatalf("expected middle elision marker: %q", got[:80])
	}

	// The branch marker at the very end of a long packed body must survive.
	tailMarker := "Final follow-up: your previous answer still hedged"
	packed := "Current:\n" + strings.Repeat("loki line noise. ", 400) + "\n\n" + tailMarker
	got = askBodyPreview([]byte(`{"intent":` + mustJSONString(packed) + `}`))
	if !strings.HasSuffix(got, tailMarker) {
		t.Fatalf("branch marker lost from tail: %q", got[len(got)-120:])
	}
	// A progressive-context question (Current block + question) must survive intact.
	ctxQuestion := "Current: " + strings.Repeat("pods in ns foo are healthy. ", 60) + "\n\nWhat is broken?"
	body, err := json.Marshal(map[string]any{"intent": ctxQuestion})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if got = askBodyPreview(body); got != ctxQuestion {
		t.Fatalf("context question truncated: len=%d", len([]rune(got)))
	}
}

func mustJSONString(s string) string {
	b, err := json.Marshal(s)
	if err != nil {
		panic(err)
	}
	return string(b)
}

func TestAskMetaFromBodyReadsBranch(t *testing.T) {
	body := []byte(`{"intent":"list pods","hop":3,"hops":3,"current_empty":false,"first_hop":"grafana","branch":"hedge","execute":true}`)
	hop, hops, currentEmpty, firstHop, branch := askMetaFromBody(body)
	if hop != 3 || hops != 3 || firstHop != "grafana" || branch != "hedge" {
		t.Fatalf("hop=%d hops=%d firstHop=%q branch=%q", hop, hops, firstHop, branch)
	}
	if currentEmpty == nil || *currentEmpty {
		t.Fatalf("current_empty not parsed: %v", currentEmpty)
	}

	// Unknown branch values are dropped rather than logged verbatim.
	if _, _, _, _, b := askMetaFromBody([]byte(`{"branch":"bogus"}`)); b != "" {
		t.Fatalf("expected empty branch, got %q", b)
	}

	// branch never reaches dot-ai and never appears in the body preview.
	out, err := stripAskMetaForUpstream(body, "/api/v1/tools/query")
	if err != nil {
		t.Fatalf("strip: %v", err)
	}
	if strings.Contains(string(out), "branch") || strings.Contains(string(out), "execute") {
		t.Fatalf("extra keys forwarded upstream: %s", out)
	}
	if !strings.Contains(string(out), `"intent":"list pods"`) {
		t.Fatalf("intent dropped: %s", out)
	}
	if strings.Contains(askBodyPreview(body), "branch") {
		t.Fatalf("branch leaked into body preview")
	}
}
