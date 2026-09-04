# Claude Code Instructions

## Project Overview

This is a Grafana App Plugin that provides AI-powered Kubernetes cluster intelligence. It embeds two read-only tools from the dot-ai MCP server into Grafana:

1. **Query** — Natural language questions about cluster resources
2. **Remediate (Analysis only)** — AI-powered issue analysis without execution

## Tech Stack

- **Framework**: Grafana App Plugin (React, TypeScript)
- **Build**: @grafana/create-plugin toolchain
- **Backend**: Proxies requests to dot-ai MCP server REST endpoints

## MCP Integration

This plugin communicates with the dot-ai MCP server via HTTP REST endpoints:
- `/api/v1/tools/query` POST — Natural language cluster queries
- `/api/v1/tools/remediate` POST — Issue analysis (read-only, no execution)

## Key Design Decisions

- **Sanitized markdown answers, plain-text *requests*** — The agent's answer is rendered as sanitized GFM markdown (headings, lists, tables, code, links) through Grafana's own `renderMarkdown`; no Mermaid diagrams, no cards, no client-side charts. The request half is unchanged: send dot-ai the **plain** intent and **never** prefix `[visualization]` — the plugin renders markdown the model already emits, it does not ask for rich output. Supersedes the earlier *Text-only responses — no Mermaid diagrams, cards, or rich visualizations; displays plain text agent responses* decision, in its **rendering** half only. Decision record: PRD Decision 12 + Decision Log. Measured at `efd80a4`, `main` renders the answer in a `<pre>` block; the rendering code lands in the feature PRs split out of PR #13.
- **Read-only** — No action execution. Remediate shows analysis only, without the option to proceed to remediation.
- **Grafana-native** — Grafana session is required to open the app; Configuration and Test connection are Admin-only; Query/Remediate require org **Editor or Admin**, enforced in the Go handlers (`isEditorOrAbove`) because `plugin.json` cannot gate app resource routes (`includes[].role` is nav visibility; `routes[].reqRole` does not apply to `resources/*`). Upstream calls still use the single shared configured Bearer, so the role check is per-user *authorization*, not per-user upstream identity. Rationale: issue #26, PR #25, PRD Decision Log.
- **Plugin ID** — `devopstoolkit-dotai-app` (unsigned load requires allow-list).
- **Grafana floor** — `grafanaDependency: ">=11.0.0"`; reference host **11.4**; `@grafana/*` libs pinned to 11.4.x for M1.
