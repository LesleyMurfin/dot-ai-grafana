package plugin

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

func TestEvaluateGitOpsPRConfig(t *testing.T) {
	const analysis = "analysis-no-apply"
	const prTok = "github-pr-token"

	cases := []struct {
		name       string
		s          gitopsSettings
		apiKey     string
		wantReady  bool
		wantReason string
	}{
		{
			name:       "F1_analysis_alone_empty",
			s:          gitopsSettings{},
			apiKey:     analysis,
			wantReady:  false,
			wantReason: gitopsReasonNotConfigured,
		},
		{
			name:       "F2_missing_token",
			s:          gitopsSettings{Provider: "github", Owner: "acme", Repo: "gitops-prod"},
			apiKey:     analysis,
			wantReady:  false,
			wantReason: gitopsReasonMissingToken,
		},
		{
			name:       "F3_missing_repo",
			s:          gitopsSettings{Owner: "acme", PRToken: prTok},
			apiKey:     analysis,
			wantReady:  false,
			wantReason: gitopsReasonMissingRepo,
		},
		{
			name:       "F4_token_mixup_denied",
			s:          gitopsSettings{Owner: "acme", Repo: "gitops-prod", PRToken: analysis},
			apiKey:     analysis,
			wantReady:  false,
			wantReason: gitopsReasonTokenMixup,
		},
		{
			name:       "F5_missing_owner",
			s:          gitopsSettings{Repo: "gitops-prod", PRToken: prTok},
			apiKey:     analysis,
			wantReady:  false,
			wantReason: gitopsReasonMissingOwner,
		},
		{
			name:       "F6_ready_distinct_token",
			s:          gitopsSettings{Provider: "github", Owner: "acme", Repo: "gitops-prod", PRToken: prTok},
			apiKey:     analysis,
			wantReady:  true,
			wantReason: gitopsReasonReady,
		},
		{
			name:       "F7_unsupported_provider",
			s:          gitopsSettings{Provider: "gitlab", Owner: "acme", Repo: "gitops-prod", PRToken: prTok},
			apiKey:     analysis,
			wantReady:  false,
			wantReason: gitopsReasonUnsupportedProvider,
		},
		{
			name:       "whitespace_token_is_missing",
			s:          gitopsSettings{Owner: "acme", Repo: "gitops-prod", PRToken: "   "},
			apiKey:     analysis,
			wantReady:  false,
			wantReason: gitopsReasonMissingToken,
		},
		{
			name:       "empty_provider_treated_as_github_when_other_fields_set",
			s:          gitopsSettings{Owner: "acme", Repo: "gitops-prod", PRToken: prTok},
			apiKey:     analysis,
			wantReady:  true,
			wantReason: gitopsReasonReady,
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			got := evaluateGitOpsPRConfig(tc.s, tc.apiKey)
			if got.Ready != tc.wantReady || got.Reason != tc.wantReason {
				t.Fatalf("ready=%v reason=%q want ready=%v reason=%q", got.Ready, got.Reason, tc.wantReady, tc.wantReason)
			}
			if got.Ready && got.Provider != gitopsProviderGitHub {
				t.Fatalf("ready provider=%q", got.Provider)
			}
		})
	}
}

func TestGitOpsStatusResource(t *testing.T) {
	t.Run("default_not_configured", func(t *testing.T) {
		inst, err := NewApp(context.Background(), backend.AppInstanceSettings{})
		if err != nil {
			t.Fatal(err)
		}
		app := inst.(*App)
		defer app.Dispose()

		body := gitopsStatusJSON(t, app)
		if body.Ready || body.Reason != gitopsReasonNotConfigured {
			t.Fatalf("got %+v", body)
		}
		if body.Owner != "" || body.Repo != "" {
			t.Fatalf("empty install must not invent owner/repo: %+v", body)
		}
		raw, _ := json.Marshal(body)
		if strings.Contains(string(raw), "apiKey") || strings.Contains(strings.ToLower(string(raw)), "token") {
			t.Fatalf("status leaked a token-ish field: %s", raw)
		}
	})

	t.Run("missing_token", func(t *testing.T) {
		inst, err := NewApp(context.Background(), backend.AppInstanceSettings{
			JSONData: []byte(`{"apiUrl":"http://dot-ai","gitopsOwner":"acme","gitopsRepo":"gitops-prod"}`),
			DecryptedSecureJSONData: map[string]string{
				"apiKey": "analysis-no-apply",
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		app := inst.(*App)
		defer app.Dispose()

		body := gitopsStatusJSON(t, app)
		if body.Ready || body.Reason != gitopsReasonMissingToken {
			t.Fatalf("got %+v", body)
		}
	})

	t.Run("token_mixup_denied", func(t *testing.T) {
		inst, err := NewApp(context.Background(), backend.AppInstanceSettings{
			JSONData: []byte(`{"gitopsOwner":"acme","gitopsRepo":"gitops-prod"}`),
			DecryptedSecureJSONData: map[string]string{
				"apiKey":        "same-secret",
				"gitopsPrToken": "same-secret",
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		app := inst.(*App)
		defer app.Dispose()

		body := gitopsStatusJSON(t, app)
		if body.Ready || body.Reason != gitopsReasonTokenMixup {
			t.Fatalf("got %+v", body)
		}
		raw, _ := json.Marshal(body)
		if strings.Contains(string(raw), "same-secret") {
			t.Fatalf("status leaked token: %s", raw)
		}
	})

	t.Run("ready_distinct_token", func(t *testing.T) {
		inst, err := NewApp(context.Background(), backend.AppInstanceSettings{
			JSONData: []byte(`{"gitopsProvider":"github","gitopsOwner":"acme","gitopsRepo":"gitops-prod","gitopsBaseBranch":"main"}`),
			DecryptedSecureJSONData: map[string]string{
				"apiKey":        "analysis-no-apply",
				"gitopsPrToken": "github-pr-token",
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		app := inst.(*App)
		defer app.Dispose()

		body := gitopsStatusJSON(t, app)
		if !body.Ready || body.Reason != gitopsReasonReady {
			t.Fatalf("got %+v", body)
		}
		if body.Owner != "acme" || body.Repo != "gitops-prod" || body.Provider != "github" {
			t.Fatalf("got %+v", body)
		}
		raw, _ := json.Marshal(body)
		if strings.Contains(string(raw), "github-pr-token") || strings.Contains(string(raw), "analysis-no-apply") {
			t.Fatalf("status leaked a secret: %s", raw)
		}
	})
}

func TestAnalysisPathIgnoresGitOpsToken(t *testing.T) {
	var sawAuth []string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawAuth = append(sawAuth, r.Header.Get("Authorization"))
		if r.Header.Get("Authorization") != "Bearer analysis-no-apply" {
			http.Error(w, `{"error":"UNAUTHORIZED"}`, http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success":true,"data":{"result":{"summary":"ok"}}}`))
	}))
	defer upstream.Close()

	inst, err := NewApp(context.Background(), backend.AppInstanceSettings{
		JSONData: []byte(`{"apiUrl":"` + upstream.URL + `","gitopsOwner":"acme","gitopsRepo":"gitops-prod"}`),
		DecryptedSecureJSONData: map[string]string{
			"apiKey":        "analysis-no-apply",
			"gitopsPrToken": "github-pr-token",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	app := inst.(*App)
	defer app.Dispose()

	for _, path := range []string{"query", "remediate"} {
		var resp backend.CallResourceResponse
		err := app.CallResource(context.Background(), &backend.CallResourceRequest{
			PluginContext: editorPluginContext(),
			Path:          path,
			Method:        http.MethodPost,
			Body:          []byte(`{"intent":"test"}`),
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
	}

	if len(sawAuth) != 2 {
		t.Fatalf("expected 2 upstream calls, got %d %v", len(sawAuth), sawAuth)
	}
	for i, auth := range sawAuth {
		if auth != "Bearer analysis-no-apply" {
			t.Fatalf("call %d Authorization=%q (must be analysis token, never gitopsPrToken)", i, auth)
		}
		if strings.Contains(auth, "github-pr-token") {
			t.Fatal("analysis path used the PR-create token")
		}
	}
}

func gitopsStatusJSON(t *testing.T, app *App) gitopsStatusResponse {
	t.Helper()
	var resp backend.CallResourceResponse
	err := app.CallResource(context.Background(), &backend.CallResourceRequest{
		Path:   "gitops-status",
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
	var body gitopsStatusResponse
	if err := json.Unmarshal(resp.Body, &body); err != nil {
		t.Fatal(err)
	}
	return body
}

func readyGitopsApp(t *testing.T) *App {
	t.Helper()
	inst, err := NewApp(context.Background(), backend.AppInstanceSettings{
		JSONData: []byte(`{"gitopsProvider":"github","gitopsOwner":"acme","gitopsRepo":"gitops-prod","gitopsBaseBranch":"main"}`),
		DecryptedSecureJSONData: map[string]string{
			"apiKey":        "analysis-no-apply",
			"gitopsPrToken": "github-pr-token",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	app := inst.(*App)
	noDial := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		t.Fatal("gitops-propose must not dial SCM, Kubernetes, or dot-ai")
		return nil, nil
	})}
	app.httpClient = noDial
	app.toolHTTPClient = noDial
	return app
}

func callGitopsPropose(t *testing.T, app *App, pctx backend.PluginContext, body []byte) (int, gitopsProposeResponse, []byte) {
	t.Helper()
	var resp backend.CallResourceResponse
	err := app.CallResource(context.Background(), &backend.CallResourceRequest{
		PluginContext: pctx,
		Path:          "gitops-propose",
		Method:        http.MethodPost,
		Body:          body,
	}, callResourceResponseSenderFunc(func(r *backend.CallResourceResponse) error {
		resp = *r
		return nil
	}))
	if err != nil {
		t.Fatal(err)
	}
	var parsed gitopsProposeResponse
	if len(resp.Body) > 0 {
		if err := json.Unmarshal(resp.Body, &parsed); err != nil {
			t.Fatalf("json: %v body=%s", err, string(resp.Body))
		}
	}
	return resp.Status, parsed, resp.Body
}

func TestGitOpsProposeDry(t *testing.T) {
	t.Run("F1_not_configured_409", func(t *testing.T) {
		inst, err := NewApp(context.Background(), backend.AppInstanceSettings{
			DecryptedSecureJSONData: map[string]string{"apiKey": "analysis-no-apply"},
		})
		if err != nil {
			t.Fatal(err)
		}
		app := inst.(*App)
		defer app.Dispose()

		status, body, raw := callGitopsPropose(t, app, editorPluginContext(), []byte(`{"analysis":"checkout-api CrashLoop"}`))
		if status != http.StatusConflict {
			t.Fatalf("status=%d body=%s", status, raw)
		}
		if body.OK || !body.Dry || body.Created || body.Reason != gitopsReasonNotConfigured {
			t.Fatalf("got %+v", body)
		}
		if body.Title != "" || len(body.Files) != 0 {
			t.Fatalf("not-ready must not invent a proposal: %+v", body)
		}
		if strings.Contains(string(raw), "analysis-no-apply") {
			t.Fatalf("leaked secret: %s", raw)
		}
	})

	t.Run("F2_missing_token_409", func(t *testing.T) {
		inst, err := NewApp(context.Background(), backend.AppInstanceSettings{
			JSONData:                []byte(`{"gitopsOwner":"acme","gitopsRepo":"gitops-prod"}`),
			DecryptedSecureJSONData: map[string]string{"apiKey": "analysis-no-apply"},
		})
		if err != nil {
			t.Fatal(err)
		}
		app := inst.(*App)
		defer app.Dispose()

		status, body, raw := callGitopsPropose(t, app, editorPluginContext(), []byte(`{"analysis":"x"}`))
		if status != http.StatusConflict || body.Reason != gitopsReasonMissingToken || body.Created {
			t.Fatalf("status=%d body=%+v raw=%s", status, body, raw)
		}
	})

	t.Run("F4_token_mixup_409", func(t *testing.T) {
		inst, err := NewApp(context.Background(), backend.AppInstanceSettings{
			JSONData: []byte(`{"gitopsOwner":"acme","gitopsRepo":"gitops-prod"}`),
			DecryptedSecureJSONData: map[string]string{
				"apiKey":        "same-secret",
				"gitopsPrToken": "same-secret",
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		app := inst.(*App)
		defer app.Dispose()

		status, body, raw := callGitopsPropose(t, app, editorPluginContext(), []byte(`{"analysis":"x"}`))
		if status != http.StatusConflict || body.Reason != gitopsReasonTokenMixup || body.Created {
			t.Fatalf("status=%d body=%+v raw=%s", status, body, raw)
		}
		if strings.Contains(string(raw), "same-secret") {
			t.Fatalf("leaked token: %s", raw)
		}
	})

	t.Run("F6_ready_dry_preview_no_scm", func(t *testing.T) {
		app := readyGitopsApp(t)
		defer app.Dispose()

		status, body, raw := callGitopsPropose(t, app, editorPluginContext(), []byte(`{"analysis":"checkout-api CrashLoop in prod"}`))
		if status != http.StatusOK {
			t.Fatalf("status=%d body=%s", status, raw)
		}
		if !body.OK || !body.Dry || body.Created || body.Reason != gitopsReasonReady {
			t.Fatalf("got %+v", body)
		}
		if body.Title != "fix: checkout-api CrashLoop in prod" {
			t.Fatalf("title=%q", body.Title)
		}
		if body.Owner != "acme" || body.Repo != "gitops-prod" || body.Provider != "github" || body.BaseBranch != "main" {
			t.Fatalf("repo fields %+v", body)
		}
		if !strings.Contains(body.Body, "has not opened a pull request") {
			t.Fatalf("body missing preview disclaimer: %s", body.Body)
		}
		if !strings.Contains(body.Body, "never the analysis token") {
			t.Fatalf("body must name the token split: %s", body.Body)
		}
		if len(body.Files) != 1 || body.Files[0].Path != "values.yaml" {
			t.Fatalf("files %+v", body.Files)
		}
		if !strings.Contains(body.Files[0].Diff, "checkout-api CrashLoop in prod") {
			t.Fatalf("diff missing analysis excerpt: %s", body.Files[0].Diff)
		}
		if !strings.Contains(body.Files[0].Diff, "top-level values") {
			t.Fatalf("diff must stay OQ2 top-level: %s", body.Files[0].Diff)
		}
		low := strings.ToLower(string(raw))
		if strings.Contains(string(raw), "github-pr-token") || strings.Contains(string(raw), "analysis-no-apply") {
			t.Fatalf("leaked secret: %s", raw)
		}
		if strings.Contains(low, "api.github.com") || strings.Contains(low, "/repos/") {
			t.Fatalf("dry preview must not mention a live SCM URL: %s", raw)
		}
	})

	t.Run("body_cannot_retarget_repo_or_apply", func(t *testing.T) {
		app := readyGitopsApp(t)
		defer app.Dispose()

		payload := []byte(`{
			"analysis":"scale checkout-api",
			"owner":"evil","repo":"pwned","baseBranch":"attacker",
			"apply":true,"execute":true,"executeChoice":"apply","sessionId":"s1"
		}`)
		status, body, raw := callGitopsPropose(t, app, editorPluginContext(), payload)
		if status != http.StatusOK {
			t.Fatalf("status=%d body=%s", status, raw)
		}
		if body.Owner != "acme" || body.Repo != "gitops-prod" || body.BaseBranch != "main" {
			t.Fatalf("request retargeted saved repo: %+v", body)
		}
		if body.Created || !body.Dry {
			t.Fatalf("apply/execute must not create: %+v", body)
		}
	})

	t.Run("empty_analysis_400", func(t *testing.T) {
		app := readyGitopsApp(t)
		defer app.Dispose()

		status, body, raw := callGitopsPropose(t, app, editorPluginContext(), []byte(`{"analysis":"  "}`))
		if status != http.StatusBadRequest || body.OK || body.Created {
			t.Fatalf("status=%d body=%+v raw=%s", status, body, raw)
		}
	})

	t.Run("viewer_forbidden", func(t *testing.T) {
		app := readyGitopsApp(t)
		defer app.Dispose()

		status, body, raw := callGitopsPropose(t, app, viewerPluginContext(), []byte(`{"analysis":"x"}`))
		if status != http.StatusForbidden || body.Created {
			t.Fatalf("status=%d body=%+v raw=%s", status, body, raw)
		}
	})
}

func TestGitOpsPRCreateRouteAbsentInM2(t *testing.T) {
	app := readyGitopsApp(t)
	defer app.Dispose()

	var resp backend.CallResourceResponse
	err := app.CallResource(context.Background(), &backend.CallResourceRequest{
		PluginContext: editorPluginContext(),
		Path:          "gitops-pr",
		Method:        http.MethodPost,
		Body:          []byte(`{"analysis":"x"}`),
	}, callResourceResponseSenderFunc(func(r *backend.CallResourceResponse) error {
		resp = *r
		return nil
	}))
	if err != nil {
		t.Fatal(err)
	}
	if resp.Status != http.StatusNotFound {
		t.Fatalf("M3 create route must stay unregistered; status=%d body=%s", resp.Status, string(resp.Body))
	}
}
