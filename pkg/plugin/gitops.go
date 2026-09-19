package plugin

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"unicode/utf8"
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

// gitopsProposeRequest is the M2 dry-preview body. Extra fields (owner, repo,
// apply, execute, executeChoice) are ignored so the request cannot retarget
// the saved GitOps repo or trigger a live apply.
type gitopsProposeRequest struct {
	Analysis string `json:"analysis"`
}

// gitopsProposeFile is one previewed path. Grain is top-level values (OQ2 leaning).
type gitopsProposeFile struct {
	Path   string `json:"path"`
	Action string `json:"action"`
	Diff   string `json:"diff"`
}

// gitopsProposeResponse is the M2 dry proposal. Created is always false.
// Tokens never appear. Live SCM create is M3 (POST /gitops-pr, not this route).
type gitopsProposeResponse struct {
	OK         bool                `json:"ok"`
	Dry        bool                `json:"dry"`
	Created    bool                `json:"created"`
	Reason     string              `json:"reason,omitempty"`
	Error      string              `json:"error,omitempty"`
	Title      string              `json:"title,omitempty"`
	Body       string              `json:"body,omitempty"`
	Provider   string              `json:"provider,omitempty"`
	Owner      string              `json:"owner,omitempty"`
	Repo       string              `json:"repo,omitempty"`
	BaseBranch string              `json:"baseBranch,omitempty"`
	Files      []gitopsProposeFile `json:"files,omitempty"`
}

func gitopsReasonMessage(reason string) string {
	switch reason {
	case gitopsReasonNotConfigured:
		return "GitOps PR execute is off until owner, repo, and PR-create token are set."
	case gitopsReasonMissingOwner:
		return "GitOps PR execute is off: missing owner."
	case gitopsReasonMissingRepo:
		return "GitOps PR execute is off: missing repo."
	case gitopsReasonMissingToken:
		return "GitOps PR execute is off: missing PR-create token."
	case gitopsReasonTokenMixup:
		return "PR-create token must not be the analysis token. Execute stays off."
	case gitopsReasonUnsupportedProvider:
		return "GitHub only in this version."
	default:
		return "GitOps PR execute is off."
	}
}

func firstNonEmptyLine(s string) string {
	for _, line := range strings.Split(s, "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			return line
		}
	}
	return ""
}

func truncateRunesEllipsis(s string, max int) string {
	if max <= 0 || s == "" {
		return ""
	}
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	r := []rune(s)
	if max == 1 {
		return "…"
	}
	return string(r[:max-1]) + "…"
}

func dryProposalTitle(analysis string) string {
	line := firstNonEmptyLine(analysis)
	if line == "" {
		return "GitOps PR preview from remediate analysis"
	}
	return "fix: " + truncateRunesEllipsis(line, 72)
}

func dryProposalBody(ev gitopsEval, analysis string) string {
	var b strings.Builder
	b.WriteString("## Preview only\n\n")
	b.WriteString("This plugin has not opened a pull request and has not applied anything to the cluster.\n")
	b.WriteString("M3 will create the PR against ")
	b.WriteString(ev.Owner)
	b.WriteString("/")
	b.WriteString(ev.Repo)
	b.WriteString(" on branch ")
	b.WriteString(ev.BaseBranch)
	b.WriteString(" using the PR-create token (never the analysis token).\n\n")
	b.WriteString("## Analysis\n\n")
	b.WriteString(truncateRunesEllipsis(strings.TrimSpace(analysis), 2000))
	b.WriteString("\n\n## Files\n\n")
	b.WriteString("values.yaml — top-level claims/values preview (OQ2 leaning), not a fully expanded child manifest.\n")
	return b.String()
}

func dryValuesDiff(ev gitopsEval, analysis string) string {
	excerpt := truncateRunesEllipsis(firstNonEmptyLine(analysis), 160)
	var b strings.Builder
	b.WriteString("--- a/values.yaml\n")
	b.WriteString("+++ b/values.yaml\n")
	b.WriteString("@@ -0,0 +1,7 @@\n")
	b.WriteString("+# Preview only — not written. M3 will commit to ")
	b.WriteString(ev.Owner)
	b.WriteString("/")
	b.WriteString(ev.Repo)
	b.WriteString(" (")
	b.WriteString(ev.Provider)
	b.WriteString(").\n")
	b.WriteString("+# Grain: top-level values (OQ2 leaning), not expanded child manifests.\n")
	b.WriteString("+# Analysis excerpt:\n")
	b.WriteString("+# ")
	b.WriteString(excerpt)
	b.WriteString("\n+\n")
	b.WriteString("+# No live apply. Cluster mutation happens only after human review and GitOps reconcile.\n")
	return b.String()
}

func buildDryProposal(ev gitopsEval, analysis string) gitopsProposeResponse {
	return gitopsProposeResponse{
		OK:         true,
		Dry:        true,
		Created:    false,
		Reason:     gitopsReasonReady,
		Title:      dryProposalTitle(analysis),
		Body:       dryProposalBody(ev, analysis),
		Provider:   ev.Provider,
		Owner:      ev.Owner,
		Repo:       ev.Repo,
		BaseBranch: ev.BaseBranch,
		Files: []gitopsProposeFile{{
			Path:   "values.yaml",
			Action: "preview",
			Diff:   dryValuesDiff(ev, analysis),
		}},
	}
}

func writeGitopsPropose(w http.ResponseWriter, status int, body gitopsProposeResponse) {
	body.Dry = true
	body.Created = false
	writeJSON(w, status, body)
}

// handleGitOpsPropose returns a dry title/body/diff preview. POST only.
// Fail-closed via evaluateGitOpsPRConfig. Never dials SCM, never uses apiKey
// for GitHub, never applies to the cluster. Request body cannot retarget the repo.
func (a *App) handleGitOpsPropose(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !isEditorOrAbove(req.Context()) {
		writeGitopsPropose(w, http.StatusForbidden, gitopsProposeResponse{
			Error: "Editor role required",
		})
		return
	}

	const maxBody = 1 << 20
	var raw []byte
	if req.Body != nil {
		var err error
		raw, err = io.ReadAll(io.LimitReader(req.Body, maxBody+1))
		if err != nil {
			writeGitopsPropose(w, http.StatusBadRequest, gitopsProposeResponse{
				Error: "failed to read request body",
			})
			return
		}
	}
	if len(raw) > maxBody {
		writeGitopsPropose(w, http.StatusRequestEntityTooLarge, gitopsProposeResponse{
			Error: "request body too large",
		})
		return
	}

	var in gitopsProposeRequest
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &in); err != nil {
			writeGitopsPropose(w, http.StatusBadRequest, gitopsProposeResponse{
				Error: "invalid JSON body",
			})
			return
		}
	}
	analysis := strings.TrimSpace(in.Analysis)
	if analysis == "" {
		writeGitopsPropose(w, http.StatusBadRequest, gitopsProposeResponse{
			Error: "analysis is required",
		})
		return
	}

	ev := a.gitopsEval()
	if !ev.Ready {
		writeGitopsPropose(w, http.StatusConflict, gitopsProposeResponse{
			Reason: ev.Reason,
			Error:  gitopsReasonMessage(ev.Reason),
		})
		return
	}

	writeGitopsPropose(w, http.StatusOK, buildDryProposal(ev, analysis))
}
