const express = require("express");
const crypto = require("crypto");
const { auditUrl } = require("./audit");
const TTLCache = require("./cache");
const createRateLimiter = require("./rateLimiter");

function createApp() {
  const app = express();
  app.use(express.json());

  // Cache TTL is configurable via env var (in ms). Defaults to 5 minutes.
  const cacheTtlMs = parseInt(process.env.CACHE_TTL_MS || "300000", 10);
  const cache = new TTLCache(cacheTtlMs);

  // Max 10 audits per minute per IP by default — configurable too.
  const rateLimiter = createRateLimiter({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX || "10", 10),
  });

  // --- Structured logging middleware ---
  // Every request gets a unique ID so logs from the same request can be
  // traced together — essential once you have real traffic and need to
  // debug "what happened for this one user's request?"
  app.use((req, res, next) => {
    req.requestId = crypto.randomUUID();
    const start = Date.now();
    res.on("finish", () => {
      console.log(
        JSON.stringify({
          requestId: req.requestId,
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          durationMs: Date.now() - start,
          timestamp: new Date().toISOString(),
        })
      );
    });
    next();
  });

  app.get("/health", (req, res) => {
    res.json({ status: "ok" });
  });
  
  app.get("/", (req, res) => {
  res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Page Pulse — URL Audit Service</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 60px auto; padding: 0 20px; color: #1a1a1a; }
    h1 { margin-bottom: 4px; }
    code { background: #f2f2f2; padding: 2px 6px; border-radius: 4px; }
    pre { background: #f7f7f7; padding: 16px; border-radius: 8px; overflow-x: auto; }
    footer { margin-top: 60px; font-size: 0.85rem; color: #666; border-top: 1px solid #eee; padding-top: 16px; }
    footer a { color: #666; }
  </style>
</head>
<body>
  <h1>Page Pulse</h1>
  <p>A production-grade URL audit service. Send a URL, get back SEO, performance, and mobile-readiness signals.</p>

  <h2>Endpoints</h2>
  <p><code>GET /health</code> — service health check</p>
  <p><code>POST /audit</code> — run an audit</p>
  <pre>curl -X POST /audit -H "Content-Type: application/json" -d '{"url": "https://example.com"}'</pre>

  <footer>
    Built for <a href="https://digitalheroesco.com" target="_blank" rel="noopener noreferrer">Digital Heroes Training Task</a>
  </footer>
</body>
</html>`);
});

  app.post("/audit", rateLimiter, async (req, res) => {
    const { url } = req.body || {};

    if (!url) {
      return res.status(400).json({
        error: "bad_request",
        message: "Request body must include a 'url' field.",
        requestId: req.requestId,
      });
    }

    const cached = cache.get(url);
    if (cached) {
      return res.status(200).json({
        ...cached,
        cached: true,
        requestId: req.requestId,
      });
    }

    try {
      const result = await auditUrl(url);
      cache.set(url, result);
      return res.status(200).json({
        ...result,
        cached: false,
        requestId: req.requestId,
      });
    } catch (err) {
      const statusByCode = {
        INVALID_URL: 400,
        TIMEOUT: 504,
        FETCH_FAILED: 502,
      };
      const status = statusByCode[err.code] || 500;
      return res.status(status).json({
        error: err.code || "internal_error",
        message: err.message,
        requestId: req.requestId,
      });
    }
  });

  return app;
}

// Only start listening if this file is run directly (not when imported by tests)
if (require.main === module) {
  const app = createApp();
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Page Pulse listening on port ${port}`);
  });
}

module.exports = createApp;
