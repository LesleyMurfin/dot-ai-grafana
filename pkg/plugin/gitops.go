package plugin

import (
	"net/http"
	"strings"
)

// GitOps PR readiness reasons. Stable strings for GET /gitops-status and unit tests.
const (
	gitopsReasonNotConfigured       = "not_configured"
	gitopsReasonMissingOwner        = "missing_owner"
	gitopsReasonMissingRepo         = "missing_repo"
	gitopsReasonMissingToken        = "missing_token"
	gitopsReasonUnsupportedProvider = "unsupported_provider"
	gitopsReasonTokenMixup          = "token_mixup"
	gitopsReasonReady               = "ready"

	gitopsProviderGitHub    = "github"
	gitopsDefaultBaseBranch = "main"
)

// gitopsSettings is the PR-create credential set. Distinct from apiKey.
// The analysis path must never read PRToken.
type gitopsSettings struct {
	Provider   string
	Owner      string
	Repo       string
	BaseBranch string
	APIURL     string
	PRToken    string
}

// gitopsStatusResponse is the GET /gitops-status body. Never includes tokens.
type gitopsStatusResponse struct {
	Ready      bool   `json:"ready"`
	Reason     string `json:"reason"`
	Provider   string `json:"provider,omitempty"`
	Owner      string `json:"owner,omitempty"`
	Repo       string `json:"repo,omitempty"`
	BaseBranch string `json:"baseBranch,omitempty"`
}

// gitopsEval is the computed execute gate (M1). M3 must fail closed unless Ready.
type gitopsEval struct {
	Ready      bool
	Reason     string
	Provider   string
	Owner      string
	Repo       string
	BaseBranch string
}

func normalizeGitopsSettings(s gitopsSettings) gitopsSettings {
	s.Provider = strings.ToLower(strings.TrimSpace(s.Provider))
	s.Owner = strings.TrimSpace(s.Owner)
	s.Repo = strings.TrimSpace(s.Repo)
	s.BaseBranch = strings.TrimSpace(s.BaseBranch)
	s.APIURL = strings.TrimSpace(s.APIURL)
	s.PRToken = strings.TrimSpace(s.PRToken)
	if s.BaseBranch == "" {
		s.BaseBranch = gitopsDefaultBaseBranch
	}
	return s
}

// evaluateGitOpsPRConfig reports whether GitOps PR execute may be armed.
// Execute stays off until owner, repo, and a PR-create token distinct from the
// analysis apiKey are set. Provider empty is treated as github (OQ1 leaning).
// This function does not dial SCM (M3) and does not inspect Kubernetes.
func evaluateGitOpsPRConfig(s gitopsSettings, analysisAPIKey string) gitopsEval {
	s = normalizeGitopsSettings(s)
	analysisAPIKey = strings.TrimSpace(analysisAPIKey)

	out := gitopsEval{
		Provider:   s.Provider,
		Owner:      s.Owner,
		Repo:       s.Repo,
		BaseBranch: s.BaseBranch,
	}

	if s.Provider != "" && s.Provider != gitopsProviderGitHub {
		out.Reason = gitopsReasonUnsupportedProvider
		return out
	}
	if s.Provider == "" {
		out.Provider = gitopsProviderGitHub
	}

	if s.Owner == "" && s.Repo == "" && s.PRToken == "" {
		out.Reason = gitopsReasonNotConfigured
		out.Provider = ""
		out.BaseBranch = ""
		return out
	}

	if s.PRToken != "" && analysisAPIKey != "" && s.PRToken == analysisAPIKey {
		out.Reason = gitopsReasonTokenMixup
		return out
	}
	if s.Owner == "" {
		out.Reason = gitopsReasonMissingOwner
		return out
	}
	if s.Repo == "" {
		out.Reason = gitopsReasonMissingRepo
		return out
	}
	if s.PRToken == "" {
		out.Reason = gitopsReasonMissingToken
		return out
	}

	out.Ready = true
	out.Reason = gitopsReasonReady
	return out
}

func (a *App) gitopsEval() gitopsEval {
	return evaluateGitOpsPRConfig(a.gitops, a.apiKey)
}

// handleGitOpsStatus reports computed PR-create readiness. GET only. No secrets.
func (a *App) handleGitOpsStatus(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	ev := a.gitopsEval()
	writeJSON(w, http.StatusOK, gitopsStatusResponse{
		Ready:      ev.Ready,
		Reason:     ev.Reason,
		Provider:   ev.Provider,
		Owner:      ev.Owner,
		Repo:       ev.Repo,
		BaseBranch: ev.BaseBranch,
	})
}
