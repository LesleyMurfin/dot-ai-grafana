package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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

	t.Run("ping", func(t *testing.T) {
		var resp backend.CallResourceResponse
		err := app.CallResource(context.Background(), &backend.CallResourceRequest{
			Path:   "ping",
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
	})

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
		var body stubResponse
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

	t.Run("echo", func(t *testing.T) {
		var resp backend.CallResourceResponse
		payload, _ := json.Marshal(map[string]string{"message": "hi"})
		err := app.CallResource(context.Background(), &backend.CallResourceRequest{
			Path:   "echo",
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
		if !bytes.Contains(resp.Body, []byte("hi")) {
			t.Fatalf("body=%s", string(resp.Body))
		}
	})
}

type callResourceResponseSenderFunc func(resp *backend.CallResourceResponse) error

func (f callResourceResponseSenderFunc) Send(resp *backend.CallResourceResponse) error {
	return f(resp)
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
		{"health", http.MethodPut},
		{"echo", http.MethodGet},
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
		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, `{"error":"UNAUTHORIZED"}`, http.StatusUnauthorized)
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
			if !bytes.Contains(resp.Body, []byte(tc.want)) {
				t.Fatalf("body=%s", string(resp.Body))
			}
		})
	}

	t.Run("upstream_error_passthrough", func(t *testing.T) {
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
		if !bytes.Contains(resp.Body, []byte("EXECUTION_ERROR")) {
			t.Fatalf("body=%s", string(resp.Body))
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
