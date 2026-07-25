const { isValidUrl, analyzeHtml } = require("../src/audit");
const TTLCache = require("../src/cache");
const createRateLimiter = require("../src/rateLimiter");

describe("isValidUrl", () => {
  test("accepts a well-formed https URL", () => {
    expect(isValidUrl("https://example.com")).toBe(true);
  });

  test("accepts a well-formed http URL", () => {
    expect(isValidUrl("http://example.com/page")).toBe(true);
  });

  test("rejects a non-http(s) protocol", () => {
    expect(isValidUrl("ftp://example.com")).toBe(false);
  });

  test("rejects a completely malformed string", () => {
    expect(isValidUrl("not a url at all")).toBe(false);
  });

  test("rejects an empty string", () => {
    expect(isValidUrl("")).toBe(false);
  });
});

describe("analyzeHtml", () => {
  test("extracts title, meta description, and h1 count", () => {
    const html = `
      <html>
        <head>
          <title>Test Page</title>
          <meta name="description" content="A test page for auditing">
          <meta name="viewport" content="width=device-width">
        </head>
        <body>
          <h1>Heading One</h1>
          <img src="a.jpg" alt="a">
          <img src="b.jpg">
          <a href="/link1">link</a>
        </body>
      </html>
    `;
    const result = analyzeHtml(html);
    expect(result.title).toBe("Test Page");
    expect(result.metaDescription).toBe("A test page for auditing");
    expect(result.h1Count).toBe(1);
    expect(result.hasViewportTag).toBe(true);
    expect(result.imageCount).toBe(2);
    expect(result.imagesMissingAlt).toBe(1);
    expect(result.linkCount).toBe(1);
  });

  test("handles a page with no title or meta description gracefully", () => {
    const html = "<html><body><p>No head tags here</p></body></html>";
    const result = analyzeHtml(html);
    expect(result.title).toBeNull();
    expect(result.metaDescription).toBeNull();
    expect(result.h1Count).toBe(0);
  });
});

describe("TTLCache", () => {
  test("returns undefined for a key that was never set", () => {
    const cache = new TTLCache(1000);
    expect(cache.get("missing")).toBeUndefined();
  });

  test("returns a cached value within the TTL window", () => {
    const cache = new TTLCache(10000); // 10s TTL
    cache.set("https://example.com", { title: "Example" });
    expect(cache.get("https://example.com")).toEqual({ title: "Example" });
  });

  test("expires a value after the TTL window passes", () => {
    jest.useFakeTimers();
    const cache = new TTLCache(1000); // 1s TTL
    cache.set("https://example.com", { title: "Example" });

    jest.advanceTimersByTime(1500); // move time forward past the TTL

    expect(cache.get("https://example.com")).toBeUndefined();
    jest.useRealTimers();
  });
});

describe("rate limiter middleware", () => {
  function mockReqRes(ip) {
    const req = { ip };
    const res = {
      statusCode: null,
      body: null,
      headers: {},
      set(key, val) {
        this.headers[key] = val;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };
    return { req, res };
  }

  test("allows requests under the limit", () => {
    const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 3 });
    const next = jest.fn();
    const { req, res } = mockReqRes("1.2.3.4");

    limiter(req, res, next);
    limiter(req, res, next);
    limiter(req, res, next);

    expect(next).toHaveBeenCalledTimes(3);
    expect(res.statusCode).toBeNull(); // never blocked
  });

  test("blocks requests once the limit is exceeded", () => {
    const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 2 });
    const next = jest.fn();
    const { req, res } = mockReqRes("5.6.7.8");

    limiter(req, res, next); // 1st - allowed
    limiter(req, res, next); // 2nd - allowed
    limiter(req, res, next); // 3rd - blocked

    expect(next).toHaveBeenCalledTimes(2);
    expect(res.statusCode).toBe(429);
    expect(res.body.error).toBe("rate_limited");
  });

  test("tracks different IPs independently", () => {
    const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 1 });
    const next = jest.fn();
    const clientA = mockReqRes("1.1.1.1");
    const clientB = mockReqRes("2.2.2.2");

    limiter(clientA.req, clientA.res, next);
    limiter(clientB.req, clientB.res, next);

    // both allowed — separate IPs, separate limits
    expect(next).toHaveBeenCalledTimes(2);
    expect(clientA.res.statusCode).toBeNull();
    expect(clientB.res.statusCode).toBeNull();
  });
});
