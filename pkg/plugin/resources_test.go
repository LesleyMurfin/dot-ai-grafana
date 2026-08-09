package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
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

	for _, path := range []string{"health", "query", "remediate"} {
		path := path
		t.Run(path, func(t *testing.T) {
			method := http.MethodPost
			if path == "health" {
				method = http.MethodGet
			}
			var resp backend.CallResourceResponse
			err := app.CallResource(context.Background(), &backend.CallResourceRequest{
				Path:   path,
				Method: method,
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
			var body stubResponse
			if err := json.Unmarshal(resp.Body, &body); err != nil {
				t.Fatal(err)
			}
			if body.Status != "not_wired" {
				t.Fatalf("unexpected status %q", body.Status)
			}
		})
	}

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
