package plugin

import (
	"strings"
	"testing"
)

func TestRedactSecretShaped(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		in   string
		want string
	}{
		{"plain", "pod/checkout-api is CrashLooping", "pod/checkout-api is CrashLooping"},
		{"empty", "", ""},
		{"bearer", "hdr Bearer super-secret-token end", "hdr " + redactedPlaceholder + " end"},
		{"bearer_ci", "bearer AbC.123", redactedPlaceholder},
		{"apiKey", "cfg apiKey=sekrit-value end", "cfg " + redactedPlaceholder + " end"},
		{"api_key", "api_key: abc123", redactedPlaceholder},
		{"password", "db password=hunter2 ok", "db " + redactedPlaceholder + " ok"},
		{"secret", "secret=topsecret", redactedPlaceholder},
		{
			"pem",
			"before\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Z3VS5JJcds3xfn\n-----END RSA PRIVATE KEY-----\nafter",
			"before\n" + redactedPlaceholder + "\nafter",
		},
		{
			"jwt",
			"token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturepart end",
			"token " + redactedPlaceholder + " end",
		},
		{"akia", "key AKIAAABBCCDDEEFFGGHH used", "key " + redactedPlaceholder + " used"},
		{"akia_short", "AKIASHORT", "AKIASHORT"},
		{"authorization_eq", "authorization=Basic dXNlcjpwYXNz", redactedPlaceholder},
		{"authorization_colon", "Authorization: Token abc", redactedPlaceholder},
		{"nested_auth_bearer", "authorization: Bearer nested-secret", redactedPlaceholder},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := redactSecretShaped(tc.in)
			if got != tc.want {
				t.Fatalf("got %q want %q", got, tc.want)
			}
			if strings.Contains(got, "super-secret") ||
				strings.Contains(got, "sekrit") ||
				strings.Contains(got, "hunter2") ||
				strings.Contains(got, "nested-secret") ||
				strings.Contains(got, "MIIEowIBAAKCAQEA") {
				t.Fatalf("leaked secret material in %q", got)
			}
		})
	}
}
