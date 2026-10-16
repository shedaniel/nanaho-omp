import type { ProviderModelConfig } from "@oh-my-pi/pi-coding-agent";
import type { ModelCost } from "@oh-my-pi/pi-ai/types";
import { z } from "zod";

export const ModelsDevCatalog = z.record(z.string(), z.object({ models: z.record(z.string(), z.unknown()) }));
export type ModelsDevCatalog = z.infer<typeof ModelsDevCatalog>;

const TokenCost = z.object({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cache_read: z.number().nonnegative().optional(),
  cache_write: z.number().nonnegative().optional(),
});
const CatalogModel = z.object({
  cost: TokenCost.extend({
    tiers: z.array(TokenCost.extend({
      tier: z.object({ type: z.string(), size: z.number().positive() }),
    })).optional(),
  }).optional(),
  limit: z.object({ context: z.number().positive(), output: z.number().nonnegative() }).optional(),
  modalities: z.object({ input: z.array(z.string()) }).optional(),
  reasoning: z.boolean().optional(),
});

export function metadataFromCatalog(catalog: ModelsDevCatalog, provider: string, id: string): {
  model: Pick<ProviderModelConfig, "contextWindow" | "maxTokens" | "input" | "reasoning"> & { cost: ModelCost };
  priced: boolean;
} {
  const raw = catalog[provider]?.models[id];
  const entry = raw === undefined ? undefined : CatalogModel.parse(raw);
  const rates = entry?.cost;
  const cost: ModelCost = {
    input: rates?.input ?? 0,
    output: rates?.output ?? 0,
    cacheRead: rates?.cache_read ?? 0,
    cacheWrite: rates?.cache_write ?? 0,
  };
  for (const tier of rates?.tiers ?? []) {
    if (tier.tier.type !== "context" || (cost.longContext && tier.tier.size >= cost.longContext.inputThreshold)) continue;
    cost.longContext = {
      inputThreshold: tier.tier.size,
      input: tier.input,
      output: tier.output,
      cacheRead: tier.cache_read ?? cost.cacheRead,
      cacheWrite: tier.cache_write ?? cost.cacheWrite,
    };
  }
  return {
    priced: rates !== undefined,
    model: {
      cost,
      contextWindow: entry?.limit?.context ?? 128_000,
      maxTokens: entry?.limit?.output || 16_384,
      input: entry?.modalities?.input.includes("image") ? ["text", "image"] : ["text"],
      reasoning: entry?.reasoning ?? true,
    },
  };
}
