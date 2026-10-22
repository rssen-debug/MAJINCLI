# MAJIN V4 — platform contract

The reason this is V4 and not "yet another rewrite" is that new capability should
be a module or a flag, not a fork.

## Versioned interfaces

| Interface | Version | Contract | Where |
|---|---|---|---|
| Kernel API | `1` | `registerTool/Provider/Voice/Memory/Surface`, manifest schema | `src/v4/kernel.js` |
| Goal schema | `majin.v2.goal/v1` | acceptance, receipts, transitions | `src/v2/runtime/goal.js` |
| Receipt schema | `majin.v2.receipt/v1` | hashed evidence, `verified` flag | `src/v2/runtime/receipts.js` |
| Conversation schema | `majin.v4.conversation/v1` | messages, requests, modelId | `src/v4/store.js` |
| Tool contract | `majin.v2.tool/v1` | zod input/output, tier, execute | `src/v2/tools/registry.js` |
| HTTP API | `v4` | `/api/health`, `/api/me`, `/api/auth/*`, `/api/chat`, `/api/models`, `/api/conversation(s)`, `/api/goal`, `/api/kernel`, `/api/sessions`, `/api/cancel`, `/api/approve`, `/api/model` | `src/v4/server.js` |

Breaking any of these means a new version field and a documented migration —
not a silent change.

## Adding capability without touching the core

1. **A new tool** → add to `createToolRegistry` (built-in) or ship a plugin.
2. **A new provider** → already data: add it to the V1 config; V4 discovers it.
3. **A new voice engine** → `registerVoice` in a plugin, behind a flag.
4. **A new surface** → `registerSurface`; the mobile PWA stays the default.
5. **An experimental feature** → `MAJIN_V4_FLAGS=<name>=1`, gated off by default.

## Plugin lifecycle (as implemented)

```
scan dir → validate manifest → permission check → flag check → API check
        → import + activate → capabilities registered (frozen)
        ↳ any failure: every registration rolled back, plugin marked failed
```

Statuses in `GET /api/kernel`: `active`, `failed`, `rejected`, `incompatible`,
`flagged-off`.

## Scaling rules

- Stay a modular monolith while one process is enough. Splitting early buys
  latency, not reliability.
- Everything that must survive a restart lives on disk with a schema field.
- Anything that can fail gets a class from the V2 failure vocabulary.
- No capability is advertised before it has executable evidence in the matrix.

## Explicit non-claims

The platform is designed to *reduce* future rewrites. It is not future-proof and
it does not anticipate every requirement. When a real constraint appears, the
answer is a versioned interface and a migration — documented, tested, reversible.
