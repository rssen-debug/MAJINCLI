# MAJIN V4 — security model

## Threat model

| Actor | Capability | Mitigation |
|---|---|---|
| Anyone on the internet | sees only what the tunnel exposes | loopback bind, tunnel-only ingress, no port forwarding |
| Someone with the URL but no session | can hit `/api/health`, `/api/me`, `/api/auth/pair` | all other routes require a session; pairing is rate limited |
| Someone who guesses a pairing code | 32^8 ≈ 1.1e12 space, 5 attempts/min | code is HMAC-hashed at rest, rotated on demand |
| A malicious page in the owner's browser | cross-site POST | `Origin`/`Referer` must match; `X-MAJIN-CSRF: 1` required; cookies are `SameSite=Strict` |
| DNS rebinding | forged Host header | allowlist + optional `MAJIN_V4_PUBLIC_ORIGIN` match |
| A prompt-injected model | tries `../` paths or a shell | tools are typed, no shell tool exists, filenames are leaf-only, writes are `wx` create-only |
| A malicious plugin | arbitrary code | **not sandboxed** — opt-in, allowlisted, permission-declared, rollback on failure |
| XSS in a rendered answer | script execution | the client renders markdown manually (text nodes), CSP forbids inline and third-party script |
| Stolen phone, unlocked | read access | sessions are revocable (`/api/sessions` view, logout revokes immediately), 30-day expiry |

## Controls implemented

- **Pairing:** 8 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, displayed once, stored as
  HMAC-SHA256 with a 32-byte key in `v4/secret.key` (0600).
- **Sessions:** random 24-byte id + HMAC signature, stored server-side in `v4/sessions.json`
  (0600); `HttpOnly`, `SameSite=Strict`, `Secure` when HTTPS, `Max-Age` = TTL.
- **Revocation:** logout deletes the record; a token whose record is gone is rejected.
- **CSRF:** custom header + same-origin check on every POST/DELETE.
- **Rate limits:** pairing / turns / general, sliding window per client key.
  Behind a proxy the client key comes from `CF-Connecting-IP`/`X-Forwarded-For`
  only when `MAJIN_V4_TRUST_PROXY=1`.
- **Body limits:** 64 kB default, per-route smaller limits for auth.
- **Headers:** CSP `default-src 'none'`, `frame-ancestors 'none'`, `nosniff`,
  `no-referrer`, COOP same-origin, `Permissions-Policy: microphone=(self)`.
- **Tool boundary:** flat workspace, `wx` open (no overwrite), traversal and reserved
  Windows device names refused, 1 MB content cap, 60 s tool timeout.
- **Secrets:** provider keys never leave the host. `/api/models` returns labels and ids only.
  Logs print counts, never values. The pairing code prints once at boot.
- **Evidence:** sensitive external actions require an approval decision; `strict` policy
  turns every write into a human confirmation.

## Known gaps (do not treat as solved)

1. **Plugin isolation:** in-process, no seccomp/container. Roadmap item P6.
2. **Single-host session store:** a JSON file; no clustering, no distributed revocation.
3. **No 2FA/passkey yet:** pairing code + device session. Passkeys are a planned upgrade,
   not a shipped claim.
4. **No audit export UI:** receipts exist per goal; there is no operator audit console.
5. **Rate limiting is process-local** and resets on restart.
6. **No penetration test** has been run against a tunnelled deployment (matrix S14).

## Reporting

If you find a vulnerability, do not open a public issue with exploit details.
Rotate the pairing code first (`npm run v4:pair -- --rotate`), then revoke sessions
by logging out on each device.
