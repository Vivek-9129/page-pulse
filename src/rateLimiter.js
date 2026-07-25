/**
 * A simple fixed-window rate limiter, keyed by client IP.
 *
 * Concept: each client gets `maxRequests` requests per `windowMs` window.
 * We track counts per IP in memory. When the window passes, the count
 * resets. If a client exceeds the limit mid-window, we reject with 429
 * (the standard HTTP status for "Too Many Requests").
 *
 * This is Express *middleware* — a function that runs before your route
 * handler. It can either call next() to let the request continue, or
 * respond directly and stop the chain.
 */
function createRateLimiter({ windowMs = 60 * 1000, maxRequests = 10 } = {}) {
  const hits = new Map(); // ip -> { count, windowStart }

  return function rateLimiterMiddleware(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress || "unknown";
    const now = Date.now();
    const record = hits.get(ip);

    if (!record || now - record.windowStart > windowMs) {
      // first request from this IP, or the old window has expired
      hits.set(ip, { count: 1, windowStart: now });
      return next();
    }

    if (record.count >= maxRequests) {
      const retryAfterSec = Math.ceil(
        (windowMs - (now - record.windowStart)) / 1000
      );
      res.set("Retry-After", String(retryAfterSec));
      return res.status(429).json({
        error: "rate_limited",
        message: `Too many requests. Try again in ${retryAfterSec}s.`,
      });
    }

    record.count += 1;
    return next();
  };
}

module.exports = createRateLimiter;
