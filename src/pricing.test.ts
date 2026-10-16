import { expect, test } from "bun:test";
import { metadataFromCatalog, ModelsDevCatalog } from "./pricing";

const catalog = ModelsDevCatalog.parse({
  openai: { models: {
    "example-model": {
      cost: {
        input: 3, output: 9, cache_read: 0.25, cache_write: 4,
        tiers: [{ input: 6, output: 13.5, tier: { type: "context", size: 250_000 } }],
      },
      limit: { context: 1_000_000, output: 64_000 },
      modalities: { input: ["text", "image", "pdf"] },
      reasoning: true,
    },
    "free-model": { cost: { input: 0, output: 0 } },
    "bad-price": { cost: { input: -1, output: 2 } },
  } },
  other: { models: { "example-model": { cost: { input: 99, output: 99 } } } },
});

test("preserves per-million units, cache rates, and context-tier prices without mixing providers", () => {
  const result = metadataFromCatalog(catalog, "openai", "example-model");
  expect(result.model.cost).toEqual({
    input: 3, output: 9, cacheRead: 0.25, cacheWrite: 4,
    longContext: { inputThreshold: 250_000, input: 6, output: 13.5, cacheRead: 0.25, cacheWrite: 4 },
  });
  expect(result.model.contextWindow).toBe(1_000_000);
  expect(result.model.maxTokens).toBe(64_000);
  expect(result.model.input).toEqual(["text", "image"]);
});

test("opaque aliases and unknown owners do not borrow another model's price", () => {
  expect(metadataFromCatalog(catalog, "openai", "example-model-latest").priced).toBe(false);
  expect(metadataFromCatalog(catalog, "unknown", "example-model").priced).toBe(false);
});

test("published zero prices remain distinct from missing prices", () => {
  expect(metadataFromCatalog(catalog, "openai", "free-model").priced).toBe(true);
  expect(metadataFromCatalog(catalog, "openai", "unlisted-model").priced).toBe(false);
});

test("invalid rate cards are rejected rather than displaying free usage", () => {
  expect(() => metadataFromCatalog(catalog, "openai", "bad-price")).toThrow();
});
