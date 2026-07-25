# Page Pulse — URL Audit Service (Production-Grade)

Built for Digital Heroes Training Task

## Assumption stated up front

This task references "the same Page Pulse service" from an earlier stage of
the process, which I did not have access to. I've defined the spec myself,
per the brief's note that "assumptions are part of the test":

> Page Pulse is a URL-audit service. Given a URL, it fetches the page and
> returns a structured audit covering HTTP status/response time, basic SEO
> signals (title, meta description, H1 count), basic accessibility/performance
> signals (image alt-text coverage, page size), and mobile-readiness
> (viewport tag presence).

## API Contract

### `POST /audit`

**Request body**
```json
{ "url": "https://example.com" }
```

**Success response — `200`**
```json
{
  "url": "https://example.com",
  "auditedAt": "2026-07-24T12:00:00.000Z",
  "statusCode": 200,
  "responseTimeMs": 341,
  "seo": {
    "title": "Example Domain",
    "titleLength": 14,
    "metaDescription": null,
    "metaDescriptionLength": 0,
    "h1Count": 1
  },
  "performance": {
    "pageSizeBytes": 1256,
    "imageCount": 0,
    "imagesMissingAlt": 0
  },
  "mobile": { "hasViewportTag": true },
  "linkCount": 1,
  "cached": false,
  "requestId": "b3f1..."
}
```

**Error responses**
| Status | Code           | Meaning                                   |
|--------|----------------|--------------------------------------------|
| 400    | `bad_request`  | Missing `url` in request body              |
| 400    | `INVALID_URL`  | URL is malformed or not http/https         |
| 429    | `rate_limited` | Client exceeded the rate limit             |
| 502    | `FETCH_FAILED` | Target site refused the connection/errored |
| 504    | `TIMEOUT`      | Target site did not respond within 8s      |

### `GET /health`
Returns `{ "status": "ok" }`. Used for uptime checks.

## Production-grade features (per Task A requirements)

- **Input validation** — rejects non-http(s) URLs and missing input before
  any network call is made (`src/audit.js::isValidUrl`).
- **Timeouts** — every outbound fetch is aborted after 8 seconds
  (`AbortController`), so one slow target site can never hang the service.
- **Concurrency/rate limiting** — a per-IP fixed-window limiter
  (`src/rateLimiter.js`), default 10 requests/minute, configurable via
  `RATE_LIMIT_WINDOW_MS` and `RATE_LIMIT_MAX` env vars.
- **Caching** — repeat audits of the same URL within a configurable window
  are served from an in-memory TTL cache instead of refetching
  (`src/cache.js`), default 5 minutes, configurable via `CACHE_TTL_MS`.
  In a multi-instance production deployment this would move to Redis —
  the get/set interface would stay the same.
- **Structured logging** — every request gets a UUID `requestId`, logged
  as JSON with method, path, status code, and duration, so a single
  request's logs can be traced end-to-end.
- **Tests + CI** — `tests/audit.test.js` and `tests/server.test.js` cover
  validation, caching (hit/miss/expiry), rate limiting, and the full HTTP
  contract. `.github/workflows/test.yml` runs the suite on every push.

## Running locally

```bash
npm install
npm start        # starts the server on :3000
npm test         # runs the full test suite
```

## Design decisions and rejected alternatives

- **In-memory cache/rate-limit state, not Redis**: kept the scope
  deployable on a free tier with zero extra infra for this exercise.
  Documented as the first thing to swap for true horizontal scaling.
- **`node-fetch` v2 over native `fetch`**: guarantees compatibility across
  Node versions without extra flags, and pairs cleanly with
  `AbortController` timeouts.
- **Fixed-window rate limiting over sliding-window/token-bucket**: simpler
  to reason about and sufficient for this service's traffic profile;
  noted as a tradeoff rather than claimed as the "best" approach.


## Live Deployment

🔗 **Live URL**: https://page-pulse-g2gp.onrender.com

Try it:
```bash
curl -X POST https://page-pulse-g2gp.onrender.com/audit \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

> **Note**: This is deployed on Render's free tier, which spins down after ~15 minutes of inactivity. The first request after idle time may take 30–50 seconds while the service wakes up — subsequent requests are fast.