# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

KazEDS is a digital-signature ecosystem that replaces Kazakhstan's NCALayer desktop application with a cloud-based architecture. Sites that already use the standard `ncalayer-js-client` library keep working unchanged: either a Chrome Extension or a one-line `eds.js` widget intercepts the NCALayer WebSocket (`wss://127.0.0.1:13579`), creates a session in the Cloud Relay, and shows a QR. A mobile PWA scans the QR, performs the actual cryptographic signing locally, and POSTs the signature back to the Relay. The Extension/widget polls the Relay and resolves the original WS call.

## Architecture

**Flow:** Site → Extension or `eds.js` widget (NCALayer WS emulator) → Cloud Relay (creates session, holds QR payload) → QR shown to user → Mobile PWA scans QR → signs locally → POST to Relay → Extension polls and resolves the original WS call.

**Monorepo** — pnpm workspaces, all packages under `projects/*`:

| Package | Role | Tech |
|---|---|---|
| `@kazeds/shared` | Types, constants. Zero deps. | TypeScript |
| `@kazeds/relay` | REST API, in-memory session store, eGov shim | Fastify 4, zod |
| `@kazeds/web-app` | PWA signer: QR scan, key storage, signing | Next.js 14, Web Crypto, pkijs, idb, html5-qrcode |
| `@kazeds/extension` | NCALayer WS emulator (MV3) + `eds.js` widget served via CDN | Chrome MV3, vanilla JS |
| `@kazeds/demo-site` | Test site using stock `ncalayer-js-client` | Next.js 14 |
| `landing/` | Static landing page (HTML, served by nginx) | HTML |
| `miniapp/` | Aitu Super-App miniapp version of the signer (static HTML) | HTML + Tailwind CDN |
| `verifier/` | Signature-verification service (CAdES/CMS/XMLDSig) | Java 21 + BouncyCastle, Dockerized |

**Dependency rule:** every TS package imports `@kazeds/shared`; otherwise packages are isolated and communicate only over HTTP (Relay) or the NCALayer WebSocket protocol.

## Signing internals (the non-obvious part)

The mobile signer runs **two crypto engines side by side**:

- **GOST (production)** — Go compiled to WebAssembly (`crypto.wasm`, ~7 MB, lazy-loaded). Implements GOST R 34.10-2012/2015 (256/512-bit) for real НУЦ РК `.p12` keys. Produces:
  - **Raw** signature for `signPlainData` / `signXmls`-raw paths
  - **CMS / PKCS#7 (CAdES-BES)** attached and detached for `createCMSSignature*`
  - **CAdES-T** — CMS + RFC 3161 timestamp from `tsp.pki.gov.kz`; falls back to CAdES-BES if TSA is unreachable
  - **XMLDSig** enveloped signatures for `signXml` / `signXmls`
- **ECDSA P-256 + SHA-256 (demo)** — pure Web Crypto, ephemeral keys generated in-browser. Used only for demo flows where a real cert isn't required.

`.p12` material lives in IndexedDB on the phone, encrypted with **AES-256-GCM**, key derived from a user PIN via **PBKDF2 (600 000 iterations, SHA-256)**. Keys never leave the device; the Relay and Extension never see them.

Relevant code:
- `projects/web-app/src/lib/crypto/signer.ts` — engine selection (GOST vs ECDSA, format dispatch)
- `projects/web-app/src/lib/crypto/wasm-bridge.ts` — Go→WASM bridge
- `projects/web-app/src/lib/crypto/key-manager.ts` — encryption + IndexedDB persistence

## Build & dev commands

```bash
pnpm install                    # Install everything (Node 20+, pnpm 9+)
pnpm build:shared               # MUST run after editing projects/shared/* before consumers see changes
pnpm build                      # Build every package (-r)
pnpm build:relay                # Per-package builds
pnpm build:web-app
pnpm build:demo-site

pnpm dev:relay                  # Relay on :3001 (tsx watch)
pnpm dev:web-app                # PWA on :5173
pnpm dev:demo-site              # Demo on :3000

pnpm lint                       # Lint all
pnpm --filter @kazeds/web-app lint   # Lint one package

pnpm test                       # Vitest run from root (149 tests across 10 files)
pnpm vitest run <path>          # Run a single test file
pnpm vitest run -t "name"       # Run a single test by name

pnpm pack:extension             # Zip the Extension as eds_v<manifest.version>.zip (clears prior zips)
```

The host machine in this setup typically has **no local Node** — everything runs inside `node:22-alpine` Docker containers mapped to the repo, fronted by an nginx reverse proxy that exposes the `*-sign.aitu.uz` hosts. See README for the full Docker invocations. When iterating with a local toolchain, the `pnpm …` commands above behave the same way.

**Extension has no build step.** Load `projects/extension/` as an unpacked extension at `chrome://extensions` (Developer mode). After editing source, click reload in `chrome://extensions` and refresh the target page.

**Re-running `pnpm build:shared` is required** after any change to `projects/shared/src/types.ts` or `constants.ts` — consumer packages import the built artifacts, not the source.

## Test layout

Vitest is configured at the repo root (`vitest.config.ts`, `globals: true`). Tests live alongside source under `__tests__/`:

- `projects/shared/src/__tests__/constants.test.ts`
- `projects/relay/src/__tests__/{session-store,session-schema,routes,e2e-signing-flow,egov}.test.ts`
- `projects/web-app/src/__tests__/{qr-parser,relay-client,key-manager}.test.ts`
- `projects/extension/src/__tests__/ncalayer-handler.test.mjs`

`e2e-signing-flow.test.ts` re-registers the Fastify routes inline rather than importing the real server — keep both in sync when adding endpoints.

## Key design decisions

- **Relay is stateless and in-memory.** Sessions live in `Map<UUID, Session>` with a 2-minute TTL (`SESSION_TTL_SECONDS`) and periodic cleanup; both `pending` and `scanned` sessions expire. Intentional MVP constraint — no database, no Redis. Scaling beyond one Relay process requires picking a backing store first.
- **Distributed tracing is opt-in.** All components can POST trace events (full payloads) to `/v1/trace` on the relay (in-memory ring buffer, 2000 events). Web App enables via `localStorage.kazeds_trace="1"` or `trace=true` in URL; extension via `chrome.storage.local {kazeds_trace: true}`; relay always self-traces session lifecycle. Read back with `GET /v1/trace?session_id=`.
- **Extension knows nothing about crypto.** It only relays QR payloads and signature results and emulates the NCALayer JSON-RPC 2.0 surface (`basicsAuthenticate`, `createCMSSignature*`, `getKeys`, `signPlainData`, `signXml(s)`, `browseKeyStore`, …). All cryptographic work happens in the Web App.
- **Session state machine:** `pending` → `scanned` → `completed` | `rejected` | `expired`.
- **GOST is the legally significant path; ECDSA is demo only.** Don't add ECDSA fallbacks to GOST-mandated flows — eGov / damubala / etc. will reject anything that isn't GOST + a НУЦ РК certificate.
- **TSA timestamping is best-effort.** CAdES-T degrades to CAdES-BES on TSA failure; tests should cover both branches.
- **`eds.js` widget is a drop-in for the Extension.** Sites can include `<script src="https://sign.aitu.uz/ext/eds.js">` instead of asking the user to install the Extension. Behaviour must stay equivalent between the two paths.
- **All public traffic is consolidated under `sign.aitu.uz`** with path-based routing: `/` landing, `/app/` PWA, `/relay/` API (incl. `/relay/verify/` for the Java verifier), `/ext/` widget CDN. The demo site lives at the separate host `demo.aitu.uz`. Old per-service hosts (`app-sign`, `relay-sign`, `extension-sign`, `miniapp-sign`, `demo-sign`) are retired — remove them from the cloudflared tunnel and DNS.

## Key files

- `projects/shared/src/types.ts` — All shared types (`QRPayload`, `Session`, `SigningResult`, JSON-RPC types).
- `projects/shared/src/constants.ts` — URLs, TTLs, crypto params, rate limits.
- `projects/relay/src/index.ts` — Fastify entry, route registration.
- `projects/relay/src/routes/sessions.ts` — REST endpoints: create / payload / status / complete / cancel.
- `projects/relay/src/routes/egov.ts` — eGov mGov shim under `/v1/egov/*` (`sessions`, `:id/mgovSign`, `:id/documents`, `:id/status`).
- `projects/relay/src/routes/health.ts` — `/health`.
- `projects/relay/src/services/session-store.ts` — Core in-memory session logic.
- `projects/web-app/src/lib/crypto/{signer,wasm-bridge,key-manager}.ts` — Signing engines + key vault.
- `projects/web-app/src/lib/network/relay-client.ts` — HTTP client to the Relay.
- `projects/web-app/src/lib/qr/parser.ts` — QR-payload validation.
- `projects/extension/manifest.json` — MV3 manifest; bump `version` before `pnpm pack:extension`.
- `projects/extension/src/background/service-worker.js` — MV3 service worker entry.
- `projects/extension/src/background/ncalayer-api.js` — NCALayer JSON-RPC method dispatch.
- `projects/extension/src/background/sign-flow.js` — Session create + poll + result-resolve loop.
- `projects/extension/src/content/ws-intercept.js` — MAIN-world `WebSocket` monkey-patch (replaces `wss://127.0.0.1:13579`).
- `projects/extension/src/content/bridge.js` — ISOLATED↔MAIN messaging bridge.
- `projects/extension/src/content/qr-overlay.{js,css}` — In-page QR overlay UI.
- `projects/extension/src/lib/relay-client.js` — Extension-side Relay HTTP client.
- `projects/verifier/src/Verifier.java` — Signature-verification HTTP service (port 8082).
- `nginx.conf` — Reverse proxy for the `*-sign.aitu.uz` domains; also serves `landing/` and the `extension/` directory as the widget CDN.

## API endpoints (Relay)

| Method | Path | Caller | Purpose |
|---|---|---|---|
| `POST` | `/v1/sessions` | Extension / widget | Create session |
| `GET` | `/v1/sessions/:id/payload` | Mobile PWA | Fetch QR payload after scan |
| `GET` | `/v1/sessions/:id/status` | Extension / widget | Poll status |
| `POST` | `/v1/sessions/:id/complete` | Mobile PWA | Submit signature |
| `DELETE` | `/v1/sessions/:id` | Extension / widget | Cancel session |
| `POST` | `/v1/egov/sessions` | eGov shim | Create eGov-flavoured session |
| `GET` | `/v1/egov/:id/{mgovSign,documents,status}` | eGov shim | Mimic mGov endpoints for legacy flows |
| `GET` | `/health` | Liveness probes | Health check |

## Helper scripts (`scripts/`)

- `scripts/sign.sh <data>` — Locally sign `<data>` with the demo ECDSA key; emits JSON `{signature, certificate}`.
- `scripts/verify.sh <data> <signature>` — Verify a signature against the embedded demo cert.
- `scripts/complete.sh [session_id] [data]` — Sign and POST to the Relay (simulates the mobile PWA). With an empty `session_id`, it finds the most recent pending session.
- `scripts/verify-web.sh`, `scripts/notify.sh` — Smaller utilities used during manual QA.
