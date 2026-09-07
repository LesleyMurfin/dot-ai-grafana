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

- **Response rendering — plain text today, markdown once #51 lands** — On `main` the response area is plain text (`<pre>` in `src/pages/DotAIPage.tsx`); there is no renderer and no markdown or sanitizer dependency. **PR #51** adds `src/components/ResponseMarkdown.tsx` and swaps that `<pre>` for it; from then on the response area renders the model's own GFM markdown (headings, lists, tables, code, links) as sanitized HTML, with code blocks **unhighlighted** (the sanitizer strips `class`, including the `language-*` marked derives from the fence info string, and no highlighter ships). This bullet amends the original text-only decision for **rendering only** and takes effect with #51 — it must not merge ahead of it. Unconditional either way: the plugin adds no charts or interactive visualizations of its own, and never *requests* rich visualizations from dot-ai — never prefixes `[visualization]` to the intent (PRD Design Decision 1). Rationale: PRD Design Decision 12, PRD Decision Log 2026-09-05.
- **Read-only** — No action execution. Remediate shows analysis only, without the option to proceed to remediation.
- **Grafana-native** — Grafana session is required to open the app; Configuration and Test connection are Admin-only; Query/Remediate require org **Editor or Admin**, enforced in the Go handlers (`isEditorOrAbove`) because `plugin.json` cannot gate app resource routes (`includes[].role` is nav visibility; `routes[].reqRole` does not apply to `resources/*`). Upstream calls still use the single shared configured Bearer, so the role check is per-user *authorization*, not per-user upstream identity. Rationale: issue #26, PR #25, PRD Decision Log.
- **Plugin ID** — `devopstoolkit-dotai-app` (unsigned load requires allow-list).
- **Grafana floor** — `grafanaDependency: ">=11.0.0"`; reference host **11.4**; `@grafana/*` libs pinned to 11.4.x for M1.
