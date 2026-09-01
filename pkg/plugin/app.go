package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/httpclient"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/resource/httpadapter"
)

// Make sure App implements required interfaces. This is important to do
// since otherwise we will only get a not implemented error response from plugin in
// runtime. Plugin should not implement all these interfaces - only those which are
// required for a particular task.
var (
	_ backend.CallResourceHandler   = (*App)(nil)
	_ instancemgmt.InstanceDisposer = (*App)(nil)
	_ backend.CheckHealthHandler    = (*App)(nil)
)

// App is the dot-ai Grafana app backend (settings + resource routes).
type App struct {
	backend.CallResourceHandler

	apiURL         string
	apiKey         string
	httpClient     *http.Client // short timeout (version/health)
	toolHTTPClient *http.Client // longer timeout (query/remediate)
}

type appJSONData struct {
	APIURL string `json:"apiUrl"`
}

// NewApp creates a new *App instance from Grafana app settings.
func NewApp(_ context.Context, settings backend.AppInstanceSettings) (instancemgmt.Instance, error) {
	var app App

	var jd appJSONData
	if len(settings.JSONData) > 0 {
		if err := json.Unmarshal(settings.JSONData, &jd); err != nil {
			return nil, err
		}
	}
	app.apiURL = strings.TrimRight(strings.TrimSpace(jd.APIURL), "/")
	if settings.DecryptedSecureJSONData != nil {
		app.apiKey = strings.TrimSpace(settings.DecryptedSecureJSONData["apiKey"])
	}

	// SDK httpclient applies DefaultMiddlewares (tracing, headers) and sane dial/TLS
	// timeouts; only overall request Timeout differs between probe vs tool traffic.
	httpClient, err := newPluginHTTPClient(15 * time.Second)
	if err != nil {
		return nil, fmt.Errorf("create http client: %w", err)
	}
	toolHTTPClient, err := newPluginHTTPClient(120 * time.Second)
	if err != nil {
		return nil, fmt.Errorf("create tool http client: %w", err)
	}
	app.httpClient = httpClient
	app.toolHTTPClient = toolHTTPClient

	// Use a httpadapter (provided by the SDK) for resource calls. This allows us
	// to use a *http.ServeMux for resource calls, so we can map multiple routes
	// to CallResource without having to implement extra logic.
	mux := http.NewServeMux()
	app.registerRoutes(mux)
	app.CallResourceHandler = httpadapter.New(mux)

	return &app, nil
}

// newPluginHTTPClient builds an *http.Client via grafana-plugin-sdk-go/backend/httpclient.
// Starts from DefaultTimeoutOptions so dial/TLS/idle knobs stay non-zero; only Timeout is overridden.
// Tool traffic uses 120s: a known Grafana plugin-host request limit (vs Headlamp's ~30m tool window); no async 202 in this pass.
// Tests may replace App.httpClient / App.toolHTTPClient after NewApp (e.g. custom Transport).
func newPluginHTTPClient(timeout time.Duration) (*http.Client, error) {
	timeouts := httpclient.DefaultTimeoutOptions
	timeouts.Timeout = timeout
	return httpclient.New(httpclient.Options{
		Timeouts: &timeouts,
	})
}

// Dispose here tells plugin SDK that plugin wants to clean up resources when a new instance
// created.
func (a *App) Dispose() {
	// cleanup
}

// CheckHealth handles health checks sent from Grafana to the plugin process.
// Reuses the same dot-ai version probe as the /health and /test-connection resources
// so Grafana's native health indicator can't report Ok while dot-ai is unreachable.
func (a *App) CheckHealth(ctx context.Context, _ *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
	if a.apiURL == "" || a.apiKey == "" {
		return &backend.CheckHealthResult{
			Status:  backend.HealthStatusUnknown,
			Message: "dot-ai apiUrl or auth token not configured",
		}, nil
	}
	result, code := a.probeVersion(ctx, a.apiURL, a.apiKey)
	if code != http.StatusOK {
		return &backend.CheckHealthResult{
			Status:  backend.HealthStatusError,
			Message: result.Message,
		}, nil
	}
	return &backend.CheckHealthResult{
		Status:  backend.HealthStatusOk,
		Message: result.Message,
	}, nil
}
