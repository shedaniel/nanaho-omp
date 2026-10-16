import { describe, expect, test } from "bun:test";
import type { UsageFetchParams } from "@oh-my-pi/pi-ai/usage";
import { createUsageProvider } from "./usage";

const provider = createUsageProvider("http://gateway.invalid/v1/");
const params: UsageFetchParams = {
  provider: "nanaho",
  credential: { type: "api_key", apiKey: "test-only-not-a-real-key" },
};
const capturedLimit = { limit: 5, remaining: 5, used: 0, window: "7d", window_start: null };

function fetchPayload(payload: unknown) {
  return provider.fetchUsage(params, { fetch: async () => Response.json(payload) });
}

describe("Nanaho quota reporting", () => {
  test("maps the captured USD quota and leaves an unstarted reset unknown", async () => {
    const report = await fetchPayload({ isValid: true, rate_limits: [capturedLimit] });
    expect(report?.provider).toBe("nanaho");
    expect(report?.limits[0].amount).toEqual({
      unit: "usd", limit: 5, used: 0, remaining: 5, usedFraction: 0, remainingFraction: 1,
    });
    expect(report?.limits[0].status).toBe("ok");
    expect(report?.limits[0].window).toEqual({ id: "7d", label: "7d", durationMs: 604_800_000 });
  });

  test.each([
    [1.25, 3.75, "ok", 0.25, 0.75],
    [5, 0, "exhausted", 1, 0],
    [6, -1, "exhausted", 1.2, 0],
  ] as const)("maps used %s and remaining %s", async (used, remaining, status, usedFraction, remainingFraction) => {
    const report = await fetchPayload({ rate_limits: [{ ...capturedLimit, used, remaining }] });
    expect(report?.limits[0].status).toBe(status);
    expect(report?.limits[0].amount).toEqual({ unit: "usd", limit: 5, used, remaining, usedFraction, remainingFraction });
  });

  test("zero quota is exhausted without dividing by zero", async () => {
    const report = await fetchPayload({ rate_limits: [{ ...capturedLimit, limit: 0, remaining: 0 }] });
    expect(report?.limits[0].status).toBe("exhausted");
    expect(report?.limits[0].amount.usedFraction).toBeUndefined();
    expect(report?.limits[0].amount.remainingFraction).toBeUndefined();
  });

  test("derives a reset only from an explicit timestamp and supported duration", async () => {
    const start = "2026-10-01T00:00:00Z";
    const report = await fetchPayload({ rate_limits: [
      { ...capturedLimit, window_start: start },
      { ...capturedLimit, window: "monthly", window_start: start },
      { ...capturedLimit, window_start: 1_790_812_800 },
      { ...capturedLimit, window_start: "not a timestamp" },
    ] });
    expect(report?.limits[0].window?.resetsAt).toBe(Date.parse("2026-10-08T00:00:00Z"));
    for (const limit of report!.limits.slice(1)) expect(limit.window?.resetsAt).toBeUndefined();
  });

  test("reports all configured windows and total quota independently", async () => {
    const report = await fetchPayload({
      rate_limits: [
        { window: "5h", limit: 3, used: 1, remaining: 2 },
        { window: "1d", limit: 4, used: 4, remaining: 0 },
        { window: "7d", limit: 5, used: 1, remaining: 4 },
      ],
      quota: { unit: "USD", limit: 10, used: 2, remaining: 8 },
    });
    expect(report?.limits.map(limit => [limit.window?.id, limit.amount.remaining, limit.status])).toEqual([
      ["5h", 2, "ok"], ["1d", 0, "exhausted"], ["7d", 4, "ok"], ["total", 8, "ok"],
    ]);
    expect(report?.limits[3].window?.resetsAt).toBeUndefined();
  });

  test("a total-only key needs no rolling windows", async () => {
    const report = await fetchPayload({ quota: { unit: "USD", limit: 10, used: 10, remaining: 0 } });
    expect(report?.limits.map(limit => [limit.window?.id, limit.status])).toEqual([["total", "exhausted"]]);
  });

  test.each([
    { isValid: true },
    { rate_limits: [] },
    { isValid: true, quota: null, rate_limits: null },
  ])("no configured quotas do not become exhausted or invented limits: %j", async payload => {
    const report = await fetchPayload(payload);
    expect(report?.limits).toEqual([]);
  });

  test("calendar reset_at overrides a 24-hour duration across DST", async () => {
    const reset = "2026-11-02T00:00:00-05:00";
    const report = await fetchPayload({ rate_limits: [{
      ...capturedLimit, window: "1d", window_start: "2026-11-01T00:00:00-04:00", reset_at: reset,
    }] });
    expect(report?.limits[0].window?.resetsAt).toBe(Date.parse(reset));
  });

  test.each([
    null,
    {},
    { rate_limits: {} },
    { rate_limits: [null] },
    { rate_limits: [{ ...capturedLimit, remaining: "5" }] },
    { rate_limits: [{ ...capturedLimit, used: -1 }] },
    { isValid: false, rate_limits: [capturedLimit] },
  ])("rejects malformed or invalid payload %j rather than reporting zero", async payload => {
    await expect(fetchPayload(payload)).rejects.toThrow();
  });


  test("HTTP and JSON errors are explicit and never echo upstream secrets", async () => {
    await expect(provider.fetchUsage(params, {
      fetch: async () => new Response(params.credential.apiKey, { status: 401 }),
    })).rejects.toThrow("HTTP 401");
    await expect(provider.fetchUsage(params, {
      fetch: async () => new Response("invalid json"),
    })).rejects.toThrow();
    const error = await provider.fetchUsage(params, {
      fetch: async () => { throw new Error(params.credential.apiKey); },
    }).catch(error => error as Error);
    if (!(error instanceof Error)) throw new Error("Expected the failed request to reject");
    expect(error.message).not.toContain(params.credential.apiKey!);
  });
});
