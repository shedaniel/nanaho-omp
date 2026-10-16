import type { ProviderConfig, ProviderModelConfig } from "@oh-my-pi/pi-coding-agent";
import { z } from "zod";
import { metadataFromCatalog, ModelsDevCatalog } from "./pricing";

const ModelList = z.object({ data: z.array(z.object({
  id: z.string().min(1),
  display_name: z.string().optional(),
  owned_by: z.string(),
})) });
const Manifest = z.object({ models: z.array(z.object({
  slug: z.string(),
  context_window: z.number().positive(),
  input_modalities: z.array(z.string()),
})) });

export function createModelDiscovery(baseUrl: string): NonNullable<ProviderConfig["fetchDynamicModels"]> {
  return async (apiKey) => {
    if (!apiKey) return [];
    const options = {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
      redirect: "error" as const,
    };
    const [listResponse, manifestResponse, catalogResponse] = await Promise.all([
      fetch(`${baseUrl}/models`, options),
      fetch(`${baseUrl}/models?client_version=0.159.0`, options),
      // Never attach Nanaho credentials to a public pricing request.
      fetch("https://models.dev/api.json", { signal: options.signal, redirect: "error" }),
    ]);
    for (const [label, response] of [["model list", listResponse], ["model capabilities", manifestResponse], ["models.dev catalog", catalogResponse]] as const) {
      if (!response.ok) throw new Error(`Nanaho ${label} request failed (HTTP ${response.status}).`);
    }
    const list = ModelList.parse(await listResponse.json());
    const manifest = Manifest.parse(await manifestResponse.json());
    const catalog = ModelsDevCatalog.parse(await catalogResponse.json());
    const capabilities = new Map(manifest.models.map((model) => [model.slug, model]));
    return list.data.map((row): ProviderModelConfig => {
      const metadata = metadataFromCatalog(catalog, row.owned_by, row.id);
      const live = capabilities.get(row.id);
      return {
        id: row.id,
        name: `${row.display_name ?? row.id}${metadata.priced ? "" : " (pricing unknown)"}`,
        api: "openai-responses",
        ...metadata.model,
        ...(live ? {
          contextWindow: live.context_window,
          input: live.input_modalities.includes("image") ? ["text", "image"] : ["text"],
        } : {}),
        compat: {
          supportsReasoningEffort: true,
          supportsReasoningParams: true,
          thinkingFormat: "openai",
          streamIdleTimeoutMs: 3_000_000,
        },
      };
    });
  };
}
