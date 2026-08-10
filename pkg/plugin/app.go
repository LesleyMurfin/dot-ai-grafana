package plugin

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
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

	app.httpClient = &http.Client{Timeout: 15 * time.Second}
	app.toolHTTPClient = &http.Client{Timeout: 120 * time.Second}

	// Use a httpadapter (provided by the SDK) for resource calls. This allows us
	// to use a *http.ServeMux for resource calls, so we can map multiple routes
	// to CallResource without having to implement extra logic.
	mux := http.NewServeMux()
	app.registerRoutes(mux)
	app.CallResourceHandler = httpadapter.New(mux)

	return &app, nil
}

// Dispose here tells plugin SDK that plugin wants to clean up resources when a new instance
// created.
func (a *App) Dispose() {
	// cleanup
}

// CheckHealth handles health checks sent from Grafana to the plugin process.
// Cluster connectivity is validated via the Test connection resource (version tool).
func (a *App) CheckHealth(_ context.Context, _ *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
	if a.apiURL == "" || a.apiKey == "" {
		return &backend.CheckHealthResult{
			Status:  backend.HealthStatusUnknown,
			Message: "dot-ai apiUrl or auth token not configured",
		}, nil
	}
	return &backend.CheckHealthResult{
		Status:  backend.HealthStatusOk,
		Message: "configured",
	}, nil
}
