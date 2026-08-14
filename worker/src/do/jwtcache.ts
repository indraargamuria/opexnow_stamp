import { DurableObject } from "cloudflare:workers";
import type { Env } from "../lib/env";

/**
 * Per-tenant (or platform-wide for staging) Peruri JWT cache. Keyed by the
 * Durable Object name, i.e. tenant id, or "platform" for the shared staging
 * account. Tokens expire in the DO storage via expirationTtl.
 */
export class JwtCacheDO extends DurableObject<Env> {
  private readonly TOKEN_KEY = "token";
  private readonly METADATA_KEY = "metadata";

  // Fix: Define proper storage options type
  private getStorageOptions(ttlSeconds: number): { expirationTtl: number } {
    return { expirationTtl: ttlSeconds };
  }

  async get(): Promise<string | null> {
    try {
      const token = await this.ctx.storage.get<string>(this.TOKEN_KEY);
      return token ?? null;
    } catch (err) {
      console.error("Failed to get JWT token from cache:", err instanceof Error ? err.message : err);
      return null;
    }
  }

  async set(token: string, ttlSeconds: number): Promise<void> {
    // Fix: Validate input parameters
    if (!token || typeof token !== "string") {
      throw new Error("Invalid token format");
    }
    if (typeof ttlSeconds !== "number" || ttlSeconds <= 0) {
      throw new Error("Invalid TTL value");
    }

    // Fix: Add reasonable TTL limits
    const MAX_TTL = 86400; // 24 hours max
    const clampedTtl = Math.min(ttlSeconds, MAX_TTL);

    try {
      await this.ctx.storage.put(this.TOKEN_KEY, token, this.getStorageOptions(clampedTtl));
      // Fix: Store metadata for debugging
      await this.ctx.storage.put(this.METADATA_KEY, {
        cached_at: new Date().toISOString(),
        ttl: clampedTtl,
        expires_at: new Date(Date.now() + clampedTtl * 1000).toISOString()
      }, this.getStorageOptions(clampedTtl));
    } catch (err) {
      console.error("Failed to cache JWT token:", err instanceof Error ? err.message : err);
      throw new Error("Failed to cache JWT token");
    }
  }

  async clear(): Promise<void> {
    try {
      await this.ctx.storage.delete(this.TOKEN_KEY);
      await this.ctx.storage.delete(this.METADATA_KEY);
    } catch (err) {
      console.error("Failed to clear JWT cache:", err instanceof Error ? err.message : err);
      throw new Error("Failed to clear JWT cache");
    }
  }

  // Fix: Add method to get cache metadata for debugging
  async getMetadata(): Promise<{ cached_at: string; ttl: number; expires_at: string } | null> {
    try {
      const metadata = await this.ctx.storage.get<{ cached_at: string; ttl: number; expires_at: string }>(this.METADATA_KEY);
      return metadata ?? null;
    } catch {
      return null;
    }
  }
}
