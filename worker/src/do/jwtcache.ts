import { DurableObject } from "cloudflare:workers";
import type { Env } from "../lib/env";

/**
 * Per-tenant (or platform-wide for staging) Peruri JWT cache. Keyed by the
 * Durable Object name, i.e. tenant id, or "platform" for the shared staging
 * account. Tokens expire in the DO storage via expirationTtl.
 */
export class JwtCacheDO extends DurableObject<Env> {
  async get(): Promise<string | null> {
    return (await this.ctx.storage.get<string>("token")) ?? null;
  }

  async set(token: string, ttlSeconds: number): Promise<void> {
    await this.ctx.storage.put("token", token, { expirationTtl: ttlSeconds } as never);
  }

  async clear(): Promise<void> {
    await this.ctx.storage.delete("token");
  }
}
