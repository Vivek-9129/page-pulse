/**
 * A very small in-memory cache with a Time-To-Live (TTL).
 *
 * Why: re-auditing the same URL every single request wastes time and
 * hammers the target site. If someone requests the same URL again within
 * `ttlMs`, we hand back the saved result instead of re-fetching.
 *
 * This is intentionally simple (a JS Map). In a real multi-server production
 * setup you'd swap this for Redis so all instances share one cache — the
 * TTL/get/set *interface* below would stay identical, only the storage
 * backend would change. That's worth saying explicitly in your README.
 */
class TTLCache {
  constructor(ttlMs = 5 * 60 * 1000) {
    this.ttlMs = ttlMs;
    this.store = new Map(); // key -> { value, expiresAt }
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      // expired — remove it and act like it was never there
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value) {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  clear() {
    this.store.clear();
  }
}

module.exports = TTLCache;
