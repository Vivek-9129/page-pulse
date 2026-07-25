const fetch = require("node-fetch");
const cheerio = require("cheerio");

/**
 * Validate that a string is a well-formed http/https URL.
 * We reject anything else (ftp://, javascript:, malformed strings, etc.)
 * This is our "input validation" requirement — never trust user input.
 */
function isValidUrl(input) {
  try {
    const parsed = new URL(input);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false; // new URL() throws on garbage input
  }
}

/**
 * Fetch a URL with a hard timeout, so a slow/hanging site can never
 * block the whole service. AbortController is the standard way to
 * cancel an in-flight fetch in Node.
 */
async function fetchWithTimeout(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
    });
    const html = await response.text();
    return {
      status: response.status,
      responseTimeMs: Date.now() - start,
      html,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run the actual "audit" checks against fetched HTML.
 * This is where you'd expand functionality later (broken links,
 * more SEO checks, etc.) — kept intentionally focused for the brief.
 */
function analyzeHtml(html) {
  const $ = cheerio.load(html);

  const title = $("title").first().text().trim();
  const metaDescription =
    $('meta[name="description"]').attr("content")?.trim() || null;
  const h1Count = $("h1").length;
  const hasViewportTag = $('meta[name="viewport"]').length > 0;
  const imageCount = $("img").length;
  const imagesMissingAlt = $("img:not([alt])").length;
  const linkCount = $("a[href]").length;

  return {
    title: title || null,
    titleLength: title ? title.length : 0,
    metaDescription,
    metaDescriptionLength: metaDescription ? metaDescription.length : 0,
    h1Count,
    hasViewportTag,
    imageCount,
    imagesMissingAlt,
    linkCount,
    pageSizeBytes: Buffer.byteLength(html, "utf8"),
  };
}

/**
 * The main entry point: given a URL, validate it, fetch it, and
 * return a structured audit result. Throws typed errors that the
 * route layer can translate into the right HTTP status code.
 */
async function auditUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    const err = new Error("URL is required");
    err.code = "INVALID_URL";
    throw err;
  }

  if (!isValidUrl(rawUrl)) {
    const err = new Error(`"${rawUrl}" is not a valid http/https URL`);
    err.code = "INVALID_URL";
    throw err;
  }

  let fetched;
  try {
    fetched = await fetchWithTimeout(rawUrl);
  } catch (e) {
    if (e.name === "AbortError") {
      const err = new Error(`Request to ${rawUrl} timed out`);
      err.code = "TIMEOUT";
      throw err;
    }
    const err = new Error(`Failed to fetch ${rawUrl}: ${e.message}`);
    err.code = "FETCH_FAILED";
    throw err;
  }

  const analysis = analyzeHtml(fetched.html);

  return {
    url: rawUrl,
    auditedAt: new Date().toISOString(),
    statusCode: fetched.status,
    responseTimeMs: fetched.responseTimeMs,
    seo: {
      title: analysis.title,
      titleLength: analysis.titleLength,
      metaDescription: analysis.metaDescription,
      metaDescriptionLength: analysis.metaDescriptionLength,
      h1Count: analysis.h1Count,
    },
    performance: {
      pageSizeBytes: analysis.pageSizeBytes,
      imageCount: analysis.imageCount,
      imagesMissingAlt: analysis.imagesMissingAlt,
    },
    mobile: {
      hasViewportTag: analysis.hasViewportTag,
    },
    linkCount: analysis.linkCount,
  };
}

module.exports = { auditUrl, isValidUrl, analyzeHtml, fetchWithTimeout };
