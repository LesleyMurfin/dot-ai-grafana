package plugin

import "regexp"

// redactedPlaceholder is the shared client+backend replacement for secret-shaped spans.
const redactedPlaceholder = "[REDACTED]"

// secret-shaped patterns. Compiled once; applied in order, repeatedly until stable.
var (
	rePEM = regexp.MustCompile(
		`-----BEGIN [A-Z0-9][A-Z0-9 ]*-----[\s\S]*?-----END [A-Z0-9][A-Z0-9 ]*-----`,
	)
	reBearer        = regexp.MustCompile(`(?i)\bBearer\s+\S+`)
	reAPIKey        = regexp.MustCompile(`(?i)\b(?:api_key|apiKey|apikey)\s*[=:]\s*\S+`)
	rePassword      = regexp.MustCompile(`(?i)\b(?:password|passwd|secret)\s*[=:]\s*\S+`)
	reAuthorization = regexp.MustCompile(`(?i)\bauthorization\s*[=:]\s*[^\n]+`)
	reJWT           = regexp.MustCompile(`\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`)
	reAWSKey        = regexp.MustCompile(`\bAKIA[A-Z0-9]{16}\b`)

	secretPatterns = []*regexp.Regexp{
		rePEM,
		reBearer,
		reAPIKey,
		rePassword,
		reAuthorization,
		reJWT,
		reAWSKey,
	}
)

// redactSecretShaped masks credential-shaped substrings in free text.
// Safe on empty / plain prose. Matches the TypeScript client contract
// (src/utils/secretRedact.ts): same shapes, same [REDACTED] placeholder.
func redactSecretShaped(s string) string {
	if s == "" {
		return s
	}
	out := s
	for range 8 {
		next := out
		for _, re := range secretPatterns {
			next = re.ReplaceAllString(next, redactedPlaceholder)
		}
		if next == out {
			return out
		}
		out = next
	}
	return out
}
