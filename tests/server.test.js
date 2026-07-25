// Mock node-fetch BEFORE requiring anything that uses it, so no real
// network calls happen during tests — this keeps tests fast and reliable
// (they'd otherwise randomly fail if a real website was slow or down).
jest.mock("node-fetch");
const fetch = require("node-fetch");
const request = require("supertest");
const createApp = require("../src/server");

function mockFetchOnce(html, status = 200) {
  fetch.mockResolvedValueOnce({
    status,
    text: async () => html,
  });
}

describe("POST /audit", () => {
  let app;

  beforeEach(() => {
    app = createApp();
    fetch.mockReset();
  });

  test("returns 400 when url is missing", async () => {
    const res = await request(app).post("/audit").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("bad_request");
  });

  test("returns 400 for a malformed url", async () => {
    const res = await request(app).post("/audit").send({ url: "not-a-url" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_URL");
  });

  test("returns a full audit for a valid url", async () => {
    mockFetchOnce(
      `<html><head><title>Hi</title></head><body><h1>Hello</h1></body></html>`
    );

    const res = await request(app)
      .post("/audit")
      .send({ url: "https://example.com" });

    expect(res.status).toBe(200);
    expect(res.body.seo.title).toBe("Hi");
    expect(res.body.cached).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("serves the second identical request from cache without refetching", async () => {
    mockFetchOnce(`<html><head><title>Cached Page</title></head></html>`);

    const first = await request(app)
      .post("/audit")
      .send({ url: "https://example.com/cached" });
    const second = await request(app)
      .post("/audit")
      .send({ url: "https://example.com/cached" });

    expect(first.body.cached).toBe(false);
    expect(second.body.cached).toBe(true);
    expect(second.body.seo.title).toBe("Cached Page");
    // fetch should only have been called ONCE across both requests
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
