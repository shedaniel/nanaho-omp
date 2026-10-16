# nanaho-omp

Nanaho provider plugin for [oh-my-pi](https://omp.sh/docs/plugins), targeting omp 18.11.1.

- OpenAI Responses API, authenticated model discovery, and reasoning controls.
- Masked API-key entry through omp's native `/login nanaho` flow.
- Optional five-hour, daily, weekly, and total account quotas in `/usage` and `/nanaho usage`; keys with no limits are supported.
- Dynamic pricing from [models.dev](https://models.dev/) in omp's native `/model` picker, including cache and long-context rates. No bundled model list, price table, or separate pricing command.

## Run locally

Requires Bun and omp 18.11.1.

```sh
bun install
export NANAHO_BASE_URL="http://your-gateway:port/v1"
omp --extension .
```

`NANAHO_BASE_URL` is required for model discovery and account usage. It has no built-in server address. Use HTTPS when available: the supplied HTTP gateway sends credentials and prompts without transport encryption.

Inside omp:

```text
/login nanaho
/nanaho refresh
/model
```

Enter the key only in the masked login prompt, then choose a `nanaho/…` model. omp stores the key in its own credential backend (or configured auth broker), not in this repository. Hosts unable to mask input reject the secret prompt. `/logout nanaho` removes stored credentials. `NANAHO_API_KEY` is an optional environment fallback; a saved Nanaho login takes precedence. Logout does not unset an environment key.

To keep the plugin enabled across sessions, run from this directory:

```sh
omp plugin link .
```

Restart omp after changing extension source. Continue setting `NANAHO_BASE_URL` in your shell environment when launching omp.

## Commands

| Command | Behavior |
| --- | --- |
| `/nanaho` | Setup menu; API-key action prepares `/login nanaho` in the composer |
| `/nanaho status` | Key presence, endpoint, and loaded model count; never prints the key |
| `/model` | Native model selection and registered models.dev pricing |
| `/nanaho refresh` | Reload gateway models and current models.dev metadata |
| `/nanaho usage` | Live USD quota windows plus recorded tokens on the current session branch |
| `/usage` | omp's native provider usage view |

## Discovery and pricing

The plugin joins these live sources:

1. `${NANAHO_BASE_URL}/models`: authoritative available IDs and `owned_by`.
2. `${NANAHO_BASE_URL}/models?client_version=0.159.0`: Sub2API/Codex capability manifest; live context windows and image support override catalog metadata.
3. `https://models.dev/api.json`: exact `owned_by` provider and model-ID matches supply prices, output limits, modalities, and reasoning support.
4. `${NANAHO_BASE_URL}/usage`: authoritative key quota, used amount, remaining amount, and reset window.

All requests reject redirects. The Nanaho key is attached only to gateway requests, never to models.dev. Discovery requests have a 10-second deadline; Responses streaming retains the requested `3_000_000` ms idle timeout and OpenAI reasoning compatibility settings.

omp caches dynamically discovered models for up to 24 hours. Use `/nanaho refresh` to explicitly update models and pricing sooner. Failed discovery is reported through omp's discovery status; it does not invent prices. Catalog models are matched exactly within their owner, never by fuzzy alias or a different provider's cheaper rate.

Models absent from models.dev have **“pricing unknown”** appended to their display names. At the initial live check, these were `codex-auto-review` and `gpt-reserve`. omp 18.11.1 requires numeric cost fields and its picker rows label zero rates “free”; the plugin cannot provide a true unknown-price row through the current provider registration API. Check the model's display name/details: these aliases are unpriced, not free, and their session cost totals are incomplete. Account quota still comes directly from the gateway.

Pricing uses models.dev's standard token rates and first long-context tier. Account billing and quota are reported separately by the server. The plugin maps whichever `rate_limits` windows and total `quota` are present; it does not manufacture missing limits. A valid key with none reports “No quota limits reported.” Explicit `reset_at` timestamps take precedence over duration-based reset calculations, including calendar/DST boundaries. Total quota has no invented reset time. No local spending cap is imposed, and the plugin does not deliberately consume quota to test exhaustion.

## Development

```sh
bun run typecheck
bun test
omp plugin install --dry-run .
```

Tests cover pricing identity/units/context tiers, unknown versus published-zero prices, malformed rate cards, mixed/absent/total-only quotas, exhaustion and overage, reset-time precedence, and sanitized request failures. No real credentials or live API requests are used by tests.

## References

- [omp plugin packaging and installation](https://omp.sh/docs/plugins)
- [omp extension authoring and provider registration](https://omp.sh/docs/extension-authoring)
- [models.dev API](https://models.dev/api.json)
