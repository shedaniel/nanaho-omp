import type { ExtensionAPI, ExtensionContext, ProviderConfig } from "@oh-my-pi/pi-coding-agent";
import { createModelDiscovery } from "./provider";
import { createUsageProvider } from "./usage";
import { loadBaseUrl, saveBaseUrl } from "./config";

const PROVIDER = "nanaho";
const HELP = "Nanaho: /nanaho setup to configure your endpoint; /login nanaho to enter an API key; /nanaho refresh; /model to select a model and see prices; /nanaho status; /nanaho usage; /logout nanaho to remove saved keys.";

function show(pi: ExtensionAPI, ctx: ExtensionContext, text: string): void {
  if (ctx.hasUI) {
    ctx.ui.notify(text, "info");
  } else {
    pi.sendMessage({ customType: "nanaho", content: text, display: true });
  }
}

function usageText(ctx: ExtensionContext): string {
  let responses = 0;
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;

  // Read persisted branch history so reloads and branching need no separate counters.
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message" || entry.message.role !== "assistant") continue;
    const message = entry.message;
    if (message.provider !== PROVIDER) continue;
    responses++;
    input += message.usage.input;
    output += message.usage.output;
    cacheRead += message.usage.cacheRead;
    cacheWrite += message.usage.cacheWrite;
  }

  const local = responses === 0
    ? "No Nanaho responses recorded on this session branch."
    : `${responses} recorded Nanaho responses on this session branch.\nTokens: ${input} input, ${output} output, ${cacheRead} cache read, ${cacheWrite} cache write.`;

  return `${local}\nSession tokens are not account-wide billing data.`;
}

async function showUsage(pi: ExtensionAPI, ctx: ExtensionContext, baseUrl: string | undefined): Promise<void> {
  if (!baseUrl) {
    show(pi, ctx, "Nanaho endpoint is not configured. Run /nanaho setup first.");
    return;
  }
  const apiKey = await ctx.modelRegistry.getApiKeyForProvider(PROVIDER);
  if (!apiKey) {
    show(pi, ctx, "No Nanaho API key configured. Enter it with /login nanaho.");
    return;
  }
  try {
    const report = await createUsageProvider(baseUrl).fetchUsage({
      provider: PROVIDER,
      credential: { type: "api_key", apiKey },
      signal: AbortSignal.timeout(10_000),
    }, { fetch });
    if (!report) throw new Error("Nanaho returned no usage report.");
    const windows = report.limits.map((limit) => {
      const money = (amount: number | undefined) => amount === undefined ? "unknown" : `$${amount.toFixed(4)}`;
      const reset = limit.window?.resetsAt === undefined ? "unknown" : new Date(limit.window.resetsAt).toISOString();
      return `${limit.label}: ${money(limit.amount.used)} used / ${money(limit.amount.limit)} limit; ${money(limit.amount.remaining)} remaining (${limit.status}).${limit.window?.id === "total" ? "" : ` Reset: ${reset}.`}`;
    });
    show(pi, ctx, ["Nanaho account usage", ...windows, ...(report.notes ?? []), usageText(ctx)].join("\n"));
  } catch (error) {
    show(pi, ctx, `Nanaho usage unavailable: ${error instanceof Error ? error.message : "request failed"}`);
  }
}

export default async function nanaho(pi: ExtensionAPI): Promise<void> {
  let baseUrl = await loadBaseUrl(process.cwd());
  const providerConfig: ProviderConfig = {
    // Only configure the fallback when it exists; unresolved key strings can be literals.
    ...(process.env.NANAHO_API_KEY?.trim() ? { apiKey: "NANAHO_API_KEY" } : {}),
    // omp's login contract accepts a plain API key; no OAuth server is required.
    oauth: {
      name: "Nanaho",
      async login(callbacks) {
        if (!baseUrl) {
          const endpoint = await callbacks.onPrompt({
            message: "Nanaho gateway API base URL (including /v1; saved for future sessions)",
            placeholder: "https://your-gateway/v1",
            allowEmpty: false,
          });
          baseUrl = await saveBaseUrl(process.cwd(), endpoint);
          register();
        }
        const key = (await callbacks.onPrompt({
          message: "Nanaho API key (saved in omp's credential store)",
          secret: true,
          allowEmpty: false,
        })).trim();
        if (!key) throw new Error("Nanaho API key cannot be empty.");
        return key;
      },
    },
  };

  function register(): void {
    pi.registerProvider(PROVIDER, {
      ...providerConfig,
      ...(baseUrl ? {
        baseUrl,
        api: "openai-responses" as const,
        authHeader: true,
        fetchDynamicModels: createModelDiscovery(baseUrl),
        usage: createUsageProvider(baseUrl),
      } : {}),
    });
  }
  register();

  async function setup(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI) {
      show(pi, ctx, "Configure Nanaho with /nanaho setup in the TUI, or set NANAHO_BASE_URL before starting omp.");
      return;
    }
    const endpoint = await ctx.ui.input("Nanaho gateway API base URL (including /v1)", baseUrl ?? "https://your-gateway/v1");
    if (endpoint === undefined) return;
    baseUrl = await saveBaseUrl(ctx.cwd, endpoint);
    register();
    if (!ctx.modelRegistry.authStorage.keys.source(PROVIDER)) {
      show(pi, ctx, "Nanaho endpoint saved. Run /login nanaho to enter your API key.");
      return;
    }
    await ctx.modelRegistry.refreshProvider(PROVIDER, "online");
    const state = ctx.modelRegistry.getProviderDiscoveryState(PROVIDER);
    show(pi, ctx, state?.error ? `Nanaho discovery failed: ${state.error}` : `Nanaho endpoint saved: ${ctx.modelRegistry.getProviderModels(PROVIDER).length} models loaded. Open /model to select one.`);
  }

  pi.on("session_start", (_event, ctx) => {
    if (!baseUrl) show(pi, ctx, "Nanaho endpoint is not configured. Run /nanaho setup, or /login nanaho to configure both endpoint and API key.");
  });

  pi.registerCommand("nanaho", {
    description: "Nanaho API-key setup, status, account quota, and session usage",
    getArgumentCompletions: (prefix) => [
      { value: "setup", label: "setup — save the gateway endpoint and discover models" },
      { value: "status", label: "status — API-key and connection status" },
      { value: "usage", label: "usage — live account quota and session tokens" },
      { value: "refresh", label: "refresh — reload live models and models.dev prices" },
    ].filter((item) => item.value.startsWith(prefix)),
    async handler(args, ctx) {
      const action = args.trim();
      if (action === "setup") {
        await setup(ctx);
        return;
      }
      if (action === "refresh") {
        if (!baseUrl) {
          show(pi, ctx, "Nanaho endpoint is not configured. Run /nanaho setup first.");
          return;
        }
        await ctx.modelRegistry.refreshProvider(PROVIDER, "online");
        const state = ctx.modelRegistry.getProviderDiscoveryState(PROVIDER);
        show(pi, ctx, state?.error ? `Nanaho refresh failed: ${state.error}` : `Nanaho refreshed: ${ctx.modelRegistry.getProviderModels(PROVIDER).length} models loaded.`);
        return;
      }
      if (action === "usage") {
        await showUsage(pi, ctx, baseUrl);
        return;
      }
      if (action === "status") {
        const configured = ctx.modelRegistry.authStorage.keys.source(PROVIDER) !== undefined;
        show(pi, ctx, `Nanaho\nAPI key: ${configured ? "configured" : "not configured"}.\nResponses endpoint: ${baseUrl ?? "not configured — run /nanaho setup"}\nModels: ${ctx.modelRegistry.getProviderModels(PROVIDER).length} loaded (prices from models.dev; see /model).\n${HELP}`);
        return;
      }
      if (action || !ctx.hasUI || ctx.mode !== "tui") {
        show(pi, ctx, HELP);
        return;
      }

      const choice = await ctx.ui.select("Nanaho", [
        "Configure endpoint",
        "Enter API key",
        "Check usage",
        "Status",
      ]);
      if (choice === "Configure endpoint") {
        await setup(ctx);
      } else if (choice === "Enter API key") {
        // Let the host own masked input and credential persistence; never put a key in chat.
        ctx.ui.setEditorText("/login nanaho");
        ctx.ui.notify("Press Enter to open omp's masked Nanaho API-key prompt.", "info");
      } else if (choice === "Check usage") {
        await showUsage(pi, ctx, baseUrl);
      } else if (choice === "Status") {
        ctx.ui.setEditorText("/nanaho status");
      }
    },
  });
}
