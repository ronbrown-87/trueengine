// Server-only, best-effort in-memory rate limiter (per server instance).
// For multi-instance / serverless production, back this with a shared store
// (Redis/Upstash, a Supabase table, or your edge platform's rate limiting).
import { getRequest } from "@tanstack/react-start/server";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

export class RateLimitError extends Error {
  constructor() {
    super("Too many requests. Please wait a few minutes and try again.");
  }
}

export function clientIp(): string {
  const h = getRequest()?.headers;
  const fwd = h?.get("cf-connecting-ip") ?? h?.get("x-real-ip") ?? h?.get("x-forwarded-for") ?? "";
  return fwd.split(",")[0]?.trim() || "unknown";
}

export function enforceRateLimit(name: string, limit: number, windowMs: number) {
  const now = Date.now();
  if (buckets.size > MAX_BUCKETS) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    if (buckets.size > MAX_BUCKETS) buckets.clear();
  }
  const key = `${name}:${clientIp()}`;
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (++b.count > limit) throw new RateLimitError();
}
