# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

KazEDS is a digital signature ecosystem that replaces Kazakhstan's NCALayer desktop application with a cloud-based architecture. Websites using the standard `ncalayer-js-client` library work without modification — a Chrome Extension emulates the NCALayer WebSocket API, while signing happens on a separate mobile device via a PWA.

## Architecture

**Flow:** Website → Chrome Extension (emulates NCALayer WS on `wss://127.0.0.1:13579`) → Cloud Relay (creates session) → QR code displayed → Mobile PWA scans QR → signs with Web Crypto API → POSTs signature to Relay → Extension polls and returns result to website.

**Monorepo** (pnpm workspaces) with 5 projects under `projects/`:

| Package | Role | Tech |
|---------|------|------|
| `@kazeds/shared` | Types, constants, zero deps | TypeScript |
| `@kazeds/relay` | REST API, in-memory session store | Fastify 4, zod |
| `@kazeds/web-app` | PWA signer (QR scan, key storage, signing) | Next.js 14, Web Crypto, pkijs, idb, html5-qrcode |
| `@kazeds/extension` | NCALayer emulator, QR overlay | Chrome MV3, vanilla JS |
| `@kazeds/demo-site` | Test site using standard NCALayer client | Next.js 14, ncalayer-js-client |

**Dependency rule:** All projects import `@kazeds/shared`. Projects are otherwise isolated — they communicate only via HTTP (Relay) or WebSocket (NCALayer protocol).

## Build & Dev Commands

```bash
pnpm install                    # Install all dependencies
pnpm build:shared               # Must rebuild after changing shared types
pnpm build                      # Build all projects

pnpm dev:relay                  # Relay server (tsx watch)
pnpm dev:web-app                # Web App on port 5173
pnpm dev:demo-site              # Demo Site on port 3000

pnpm lint                       # Lint all projects
pnpm --filter @kazeds/web-app lint  # Lint single project
```

**Extension:** No build step — load `projects/extension/` as unpacked extension in Chrome. Must manually reload after changes.

**Important:** After changing `projects/shared/src/types.ts` or `constants.ts`, run `pnpm build:shared` before dependent projects will see the changes.

## Key Design Decisions

- **Relay is stateless (in-memory):** Sessions stored in a `Map<UUID, Session>` with 5-minute TTL and periodic cleanup. No database — intentional MVP constraint.
- **Extension knows nothing about crypto:** It only relays QR payloads and signature results. All cryptographic operations happen in the Web App.
- **Private keys encrypted at rest:** Web App stores keys in IndexedDB encrypted with AES-256-GCM, key derived from user PIN via PBKDF2 (600k iterations).
- **NCALayer JSON-RPC 2.0 compatibility:** Extension handles methods like `basicsAuthenticate`, `createCMSSignature`, `getKeys`, `signPlainData`, `browseKeyStore` — same API surface as real NCALayer.
- **Session status flow:** `pending` → `scanned` → `completed` | `rejected` | `expired`

## Key Files

- `projects/shared/src/types.ts` — All shared type definitions (QRPayload, Session, SigningResult, JsonRpc types)
- `projects/shared/src/constants.ts` — Config values (URLs, TTLs, crypto params, rate limits)
- `projects/relay/src/services/session-store.ts` — Core session management logic
- `projects/relay/src/routes/sessions.ts` — REST endpoints (create, status, complete, cancel)
- `projects/web-app/src/lib/crypto/key-manager.ts` — Key generation, encryption, signing
- `projects/web-app/src/lib/network/relay-client.ts` — HTTP client for Cloud Relay
- `projects/web-app/src/lib/qr/parser.ts` — QR payload validation
- `projects/extension/src/background/ncalayer-handler.js` — NCALayer method dispatch
- `projects/extension/src/background/session-manager.js` — Relay polling logic
- `projects/extension/src/content/inject.js` — Page-level WebSocket emulation

## API Endpoints (Relay)

- `POST /v1/sessions` — Create session (Extension calls this)
- `GET /v1/sessions/{id}/status` — Poll session status (Extension polls this)
- `POST /v1/sessions/{id}/complete` — Submit signature (Web App calls this)
- `DELETE /v1/sessions/{id}` — Cancel session
- `GET /` — Health check
