import { DurableObject } from "cloudflare:workers";
import type { Env } from "../lib/env";

export interface QuotaStatus {
  allowed: boolean;
  used: number;
  remaining: number;
  limit: number;
  reset_at: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function nextUtcMidnight(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0)).toISOString();
}

interface StagingState {
  date: string;
  count: number;
}

/**
 * Per-tenant staging quota. Single Durable Object instance per tenant (named
 * by tenant id) so increments are serialized — no lost-update races.
 *
 * Deduction happens ONLY after a successful `stampv2` call (see pipeline).
 */
export class StagingQuotaDO extends DurableObject<Env> {
  private async load(tenantId: string): Promise<StagingState> {
    const key = `staging:${tenantId}`;
    let state = (await this.ctx.storage.get<StagingState>(key)) ?? { date: today(), count: 0 };
    if (state.date !== today()) state = { date: today(), count: 0 };
    return state;
  }

  async increment(tenantId: string, limit: number): Promise<QuotaStatus> {
    const key = `staging:${tenantId}`;
    const state = await this.load(tenantId);
    const reset_at = nextUtcMidnight();
    if (state.count >= limit) {
      return { allowed: false, used: state.count, remaining: 0, limit, reset_at };
    }
    state.count += 1;
    await this.ctx.storage.put(key, state);
    return { allowed: true, used: state.count, remaining: limit - state.count, limit, reset_at };
  }

  async peek(tenantId: string, limit: number): Promise<QuotaStatus> {
    const state = await this.load(tenantId);
    return {
      allowed: state.count < limit,
      used: state.count,
      remaining: Math.max(0, limit - state.count),
      limit,
      reset_at: nextUtcMidnight(),
    };
  }
}
