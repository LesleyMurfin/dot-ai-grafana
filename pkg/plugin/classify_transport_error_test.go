package plugin

import (
	"net/url"
	"strings"
	"testing"
)

type constErr string

func (e constErr) Error() string { return string(e) }

func TestClassifyTransportError(t *testing.T) {
	secret := "https://secret.internal:8443/api/v1/tools/query"
	cases := []struct {
		name string
		err  error
		want string
	}{
		{"nil", nil, "dot-ai unreachable (502)"},
		{
			"refused_url_error",
			&url.Error{Op: "Post", URL: secret, Err: constErr("connection refused")},
			"dot-ai unreachable (502): connection refused",
		},
		{
			"timeout_url_error",
			&url.Error{Op: "Post", URL: secret, Err: constErr("context deadline exceeded")},
			"dot-ai unreachable (502): timeout",
		},
		{
			"reset",
			&url.Error{Op: "Post", URL: secret, Err: constErr("connection reset by peer")},
			"dot-ai unreachable (502): connection reset",
		},
		{
			"unknown_still_no_url",
			&url.Error{Op: "Post", URL: secret, Err: constErr("no such host")},
			"dot-ai unreachable (502)",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := classifyTransportError("dot-ai unreachable (502)", tc.err)
			if got != tc.want {
				t.Fatalf("got %q want %q", got, tc.want)
			}
			if strings.Contains(got, "secret.internal") || strings.Contains(got, "https://") || strings.Contains(got, "8443") {
				t.Fatalf("upstream URL leaked: %q", got)
			}
		})
	}
}
