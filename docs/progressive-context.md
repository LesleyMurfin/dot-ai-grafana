# Progressive context (Query / Remediate)

Client-side context packing for follow-up questions. **Not** MCP session management: there is no `sessionId`, no server-side conversation store, and no new REST fields. The plugin still calls the same endpoints:

| Tool | Body |
|------|------|
| Query | `POST …/query` with `{ intent }` |
| Remediate | `POST …/remediate` with `{ issue, intent }` (analysis only — no execute) |

Both `intent` and `issue` are **plain text** strings built in the browser. History never appears in that string.

## Four kinds of context

| Kind | Role | Sent on submit? |
|------|------|-----------------|
| **Stable** | Fixed framing for the active tool (Query vs Remediate; analysis-only rules). | Yes |
| **Current** | On **Query**, filled **before** `callDotAITool` from Grafana datasource reads (Loki + Prometheus + Tempo + Alertmanager), last 15m, capped. After a successful answer it is rewritten. | Yes (when non-empty) |
| **Map** | Grafana stack datasources discovered in this Grafana (Loki, Prometheus, Tempo, Alertmanager) + short pod/ns hints. | Yes (when non-empty) |
| **History** | On-screen You / answer list for the active tool. Display only. | **No** |

### Compose order (request text)

```
Stable
[Current]
[Map]
Question: | Issue:   ← contents of the input box (the user’s question)
```

**Current = Grafana DS facts**; the **question** stays in the Ask box and is packed with them into one plain-text `intent` for **dot-ai**. Together: K3s (via dot-ai) + Grafana observability — not Grafana-only, not cluster-only.

### One click may be several hops

A single **Ask** issues **up to 3** dot-ai POSTs (`MAX_ASK_HOPS`, `src/utils/askOrchestrator.ts`).
Every hop re-packs the compose order above, so each POST carries a fresh or refined **Current**;
**History is still never sent** on any hop. Grafana datasource reads are **not** hops — only dot-ai
POSTs are counted (one ask-log line each, scored by test plan §7 `hops`). Hop 1 answers from the
packed Current; hops 2–3 fire only when the question is unscoped ("all clusters") or the answer
contradicts evidence already sitting in Current. **Remediate is always a single hop** and reuses
whatever Current the thread already holds — it does not read the Grafana stack itself.

## Query path: Grafana stack → Current → dot-ai

On **Ask** (Query only), before packing and calling dot-ai — **connect-only**, same Tool / box / Ask / thread, **no new UI**:

1. Parse **pod** / **namespace** hints from the question (best-effort).
2. Discover configured datasources with Grafana runtime only (no hardcoded uids, no `/api/datasources/proxy` client, no DataSourcePicker):

   ```ts
   getDataSourceSrv().getList({ type: 'loki' | 'prometheus' | 'tempo' | 'alertmanager' })
   const ds = await getDataSourceSrv().get(ref)  // ref = uid || name
   await ds.query({ targets, range })            // DataQueryRequest → DataFrames
   ```

   Same pattern as official apps (`grafana-lokiexplore-app`, metrics drilldown, llm-app) and Grafana scenes `getDataSource`.
3. Pack short DataFrame text into **Current** with markers:
   - `Loki last 15m:`
   - `Prometheus last 15m:`
   - `Tempo last 15m:`
   - `Alertmanager:`
4. If a type is missing or returns nothing, that section is a **one-line note** (e.g. `Loki datasource missing`, `no log lines`).
5. **Map** lists the four discovered sources (name/uid from `getList`) + pod/ns tokens.
6. Pack Stable + Current + Map + **Question** and `callDotAITool('query', …)` (existing plugin resource → dot-ai).
7. **History is not sent.** No `sessionId`. No execute.

No observability credentials in plugin settings — the browser uses the signed-in Grafana session through DataSourceApi.

## Per-tool threads

- Query and Remediate each keep their own **Current**, **Map**, and **History**.
- Switching tools does **not** wipe the other tool’s thread.
- **Clear thread** resets only the active tool’s Current, Map, History, and last response.
- While a request is in flight, the tool selector, input, and submit stay disabled (loading lock).

## History (display-only)

- Append a You turn + Answer turn after each successful reply.
- Show at most the **last 5** turns on screen.
- History is never concatenated into `intent` / `issue` and is never POSTed as a separate field.

## Current rewrite (after answer)

After each **ok** answer, Current is **replaced** with a short block derived from the latest question + answer (resource hints, “what’s true now”, next step), size-capped. The pre-call Grafana Current is what dot-ai saw for that turn; the rewrite is what the UI keeps for follow-ups and **Analyze this**.

## Analyze this

When Query has a non-empty Current (after a successful answer):

1. Switch tool to **Remediate (analysis only)**.
2. Copy **Current** into the Remediate issue box.
3. **Query History stays**.
4. Still analysis-only — no execute UI, no apply flags, no new API shape.

## Out of scope

- **No** MCP/server session IDs or multi-turn protocol fields.
- **No** new UI chrome (no Debug panel, no datasource picker, no SceneQueryRunner UI, no extra pages).
- **No** raw `/api/datasources/proxy/...` HTTP clients or hardcoded datasource uids.
- **No** inventing visualization / structured prefixes in the POST body.

## Try it

1. Open the plugin page → **Query**.
2. Ask e.g. `show logs for pod checkout-api in namespace prod`.
3. **Current** fills with Grafana stack sections (or one-line missing/empty notes); **Map** shows discovered DS + hints; then **Response** from dot-ai.
4. Network still receives a single `{ intent }` string (Stable+Current+Map+box — no History, no sessionId).
5. **Analyze this** → Remediate with Current copied into the issue field.
6. **Clear thread** on either tool to start fresh for that tool only.
