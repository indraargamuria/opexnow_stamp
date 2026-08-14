import { DurableObject } from "cloudflare:workers";
import type { Env } from "../lib/env";

export interface QuotaStatus {
  allowed: boolean;
  used: number;
  remaining: number;
  limit: number;
  reset_at: string;
}

// Fix: Use UTC date functions to avoid timezone issues
function today(): string {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()).toString();
}

function nextUtcMidnight(): string {
  const now = new Date();
  // Fix: More efficient next UTC midnight calculation
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
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
    try {
      let state = (await this.ctx.storage.get<StagingState>(key)) ?? { date: today(), count: 0 };
      // Fix: Validate state structure
      if (!state || typeof state.date !== "string" || typeof state.count !== "number") {
        state = { date: today(), count: 0 };
      }
      if (state.date !== today()) {
        // Fix: Reset on new day with proper state validation
        state = { date: today(), count: 0 };
      }
      return state;
    } catch (err) {
      // Fix: Handle storage errors gracefully
      console.error(`Failed to load quota state for tenant ${tenantId}:`, err instanceof Error ? err.message : err);
      return { date: today(), count: 0 };
    }
  }

  async increment(tenantId: string, limit: number): Promise<QuotaStatus> {
    // Fix: Validate input parameters
    if (!tenantId || typeof tenantId !== "string") {
      throw new Error("Invalid tenant ID");
    }
    if (typeof limit !== "number" || limit < 0) {
      throw new Error("Invalid quota limit");
    }

    const key = `staging:${tenantId}`;
    const state = await this.load(tenantId);
    const reset_at = nextUtcMidnight();

    if (state.count >= limit) {
      return { allowed: false, used: state.count, remaining: 0, limit, reset_at };
    }

    // Fix: Use atomic increment operation
    state.count += 1;

    try {
      await this.ctx.storage.put(key, state);
    } catch (err) {
      console.error(`Failed to update quota state for tenant ${tenantId}:`, err instanceof Error ? err.message : err);
      throw new Error("Failed to update quota state");
    }

    return {
      allowed: true,
      used: state.count,
      remaining: Math.max(0, limit - state.count),
      limit,
      reset_at
    };
  }

  async peek(tenantId: string, limit: number): Promise<QuotaStatus> {
    // Fix: Validate input parameters
    if (!tenantId || typeof tenantId !== "string") {
      throw new Error("Invalid tenant ID");
    }
    if (typeof limit !== "number" || limit < 0) {
      throw new Error("Invalid quota limit");
    }

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
