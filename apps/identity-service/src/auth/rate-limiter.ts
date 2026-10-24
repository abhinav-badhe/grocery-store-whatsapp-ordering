/**
 * Rate limiter interface for authentication abuse resistance.
 */
export interface RateLimiter {
  isRateLimited(key: string): Promise<boolean> | boolean;
  recordFailure(key: string): Promise<void> | void;
  reset(key: string): Promise<void> | void;
}

export interface InMemoryRateLimiterOptions {
  readonly maxAttempts?: number;
  readonly windowMs?: number;
}

/**
 * In-memory sliding-window rate limiter.
 *
 * CRITICAL ARCHITECTURAL BOUNDARY:
 * This implementation is strictly in-process and memory-resident.
 * It is suitable for unit testing, test suites, and local development ONLY.
 * In a production multi-replica deployment across Render private network containers,
 * rate limiting MUST be enforced via distributed Redis storage at the API Gateway layer
 * per ADR-001 §3 and ADR-003 §5.2.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly attempts = new Map<string, number[]>();

  constructor(options: InMemoryRateLimiterOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? 5; // ADR-003 §5.2: 5 attempts
    this.windowMs = options.windowMs ?? 15 * 60 * 1000; // ADR-003 §5.2: 15 minutes
  }

  isRateLimited(key: string): boolean {
    const now = Date.now();
    const timestamps = this.attempts.get(key);
    if (!timestamps || timestamps.length === 0) {
      return false;
    }
    const valid = timestamps.filter((t) => now - t < this.windowMs);
    if (valid.length !== timestamps.length) {
      if (valid.length === 0) {
        this.attempts.delete(key);
        return false;
      }
      this.attempts.set(key, valid);
    }
    return valid.length >= this.maxAttempts;
  }

  recordFailure(key: string): void {
    const now = Date.now();
    const timestamps = this.attempts.get(key) ?? [];
    const valid = timestamps.filter((t) => now - t < this.windowMs);
    valid.push(now);
    this.attempts.set(key, valid);
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }

  clear(): void {
    this.attempts.clear();
  }
}
