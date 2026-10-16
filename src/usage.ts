import type { UsageLimit, UsageProvider, UsageWindow } from "@oh-my-pi/pi-ai/usage";
import { z } from "zod";

const QuotaAmount = z.object({
  limit: z.number().nonnegative(),
  used: z.number().nonnegative(),
  remaining: z.number(),
});
const RateLimit = QuotaAmount.extend({
  window: z.string().trim().min(1),
  window_start: z.unknown().optional(),
  reset_at: z.unknown().optional(),
});
const UsagePayload = z.object({
  isValid: z.boolean().optional(),
  rate_limits: z.array(RateLimit).nullish(),
  quota: QuotaAmount.extend({ unit: z.literal("USD").optional() }).nullish(),
}).refine(value => value.isValid === true || value.rate_limits != null || value.quota != null);

function quotaWindow(id: string, start: unknown, reset: unknown): UsageWindow {
  const window: UsageWindow = { id, label: id };
  const duration = /^([1-9]\d*)([smhdw])$/.exec(id);
  const units: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
  const durationMs = duration ? Number(duration[1]) * units[duration[2]] : undefined;
  if (durationMs !== undefined && Number.isSafeInteger(durationMs)) window.durationMs = durationMs;
  const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
  // Explicit server reset wins, including calendar windows crossing DST.
  if (typeof reset === "string" && timestamp.test(reset) && Number.isFinite(Date.parse(reset))) {
    window.resetsAt = Date.parse(reset);
  } else if (reset == null && typeof start === "string" && timestamp.test(start) && window.durationMs !== undefined) {
    const resetsAt = Date.parse(start) + window.durationMs;
    if (Number.isSafeInteger(resetsAt)) window.resetsAt = resetsAt;
  }
  return window;
}

function parseLimit(value: z.infer<typeof RateLimit>, index: number): UsageLimit {
  const { limit, used, remaining } = value;
  return {
    id: `nanaho:usd:${value.window}:${index}`,
    label: value.window === "total" ? "Nanaho total USD quota" : `Nanaho USD quota (${value.window})`,
    scope: { provider: "nanaho", windowId: value.window, shared: true },
    window: quotaWindow(value.window, value.window_start, value.reset_at),
    amount: {
      unit: "usd", limit, used, remaining,
      ...(limit > 0 ? {
        usedFraction: used / limit,
        remainingFraction: Math.min(1, Math.max(0, remaining / limit)),
      } : {}),
    },
    status: remaining <= 0 ? "exhausted" : "ok",
  };
}

export function createUsageProvider(baseUrl: string): UsageProvider {
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/usage`;
  return {
    id: "nanaho",
    cacheVersion: 1,
    validatesCredentials: true,
    supports: params => params.provider === "nanaho" && params.credential.type === "api_key",
    async fetchUsage(params, ctx) {
      if (params.provider !== "nanaho" || params.credential.type !== "api_key") return null;
      const key = params.credential.apiKey;
      if (!key) throw new Error("Nanaho usage requires an API key");
      let response: Response;
      try {
        response = await ctx.fetch(endpoint, {
          method: "GET",
          headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
          signal: params.signal,
          redirect: "error",
        });
      } catch {
        throw new Error("Nanaho usage request failed");
      }
      if (!response.ok) throw new Error(`Nanaho usage request failed (HTTP ${response.status})`);
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new Error("Nanaho usage response is not valid JSON");
      }
      const parsed = UsagePayload.safeParse(payload);
      if (!parsed.success) throw new Error("Nanaho usage response has invalid quota data");
      if (parsed.data.isValid === false) throw new Error("Nanaho usage response reports an invalid API key");
      const limits = (parsed.data.rate_limits ?? []).map(parseLimit);
      if (parsed.data.quota) limits.push(parseLimit({ ...parsed.data.quota, window: "total" }, 0));
      return {
        provider: "nanaho",
        fetchedAt: Date.now(),
        limits,
        ...(limits.length === 0 ? { notes: ["No quota limits reported for this key."] } : {}),
      };
    },
  };
}
