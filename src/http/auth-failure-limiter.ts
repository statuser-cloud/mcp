/**
 * Brake on rejected keys, counted per client address.
 *
 * The API rate limits hosted traffic per API key, and that bucket is built
 * before the key is checked — so a stream of made-up keys gets a fresh bucket
 * per key. What such a stream has in common is a 401 on every request, so that
 * is what we count. A plain per-address limit would not do: cloud-hosted
 * clients reach us from a few shared provider addresses, and it would throttle
 * all of their users together.
 *
 * In memory and per replica: this is a brake, not an exact quota.
 */
export class AuthFailureLimiter {
  private readonly entries = new Map<
    string,
    { failures: number; since: number }
  >();

  constructor(
    private readonly maxFailures: number,
    private readonly windowMs: number,
    private readonly maxEntries = 50_000,
  ) {}

  /** Seconds until the address may try again, or null when it is not blocked. */
  retryAfter(address: string, now = Date.now()): number | null {
    if (this.maxFailures <= 0) return null;
    const entry = this.current(address, now);
    if (!entry || entry.failures < this.maxFailures) return null;
    return Math.max(1, Math.ceil((entry.since + this.windowMs - now) / 1000));
  }

  recordFailure(address: string, now = Date.now()): void {
    if (this.maxFailures <= 0) return;
    const entry = this.current(address, now);
    if (entry) {
      entry.failures += 1;
      return;
    }
    if (this.entries.size >= this.maxEntries) this.prune(now);
    // Still full after pruning means a flood from many addresses; forgetting
    // everyone is the fail-open choice, the API limits still stand behind us.
    if (this.entries.size >= this.maxEntries) this.entries.clear();
    this.entries.set(address, { failures: 1, since: now });
  }

  private current(address: string, now: number) {
    const entry = this.entries.get(address);
    if (entry && now - entry.since >= this.windowMs) {
      this.entries.delete(address);
      return undefined;
    }
    return entry;
  }

  private prune(now: number): void {
    for (const [address, entry] of this.entries) {
      if (now - entry.since >= this.windowMs) this.entries.delete(address);
    }
  }
}
