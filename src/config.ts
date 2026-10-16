import { mkdir } from "node:fs/promises";
import { PluginManager } from "@oh-my-pi/pi-coding-agent/extensibility/plugins/manager";
import { getPluginsDir } from "@oh-my-pi/pi-utils";
import { z } from "zod";

const PluginSettings = z.object({ baseUrl: z.string().optional() });

export function normalizeBaseUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("Enter an HTTP(S) gateway API base URL, including its /v1 path.");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.search || url.hash) {
    throw new Error("The gateway URL must use HTTP(S), without credentials, query parameters, or fragments.");
  }
  return url.toString().replace(/\/+$/, "");
}

export async function loadBaseUrl(cwd: string): Promise<string | undefined> {
  const values = PluginSettings.parse(await new PluginManager(cwd).getPluginSettings("nanaho-omp"));
  const value = values.baseUrl ?? process.env.NANAHO_BASE_URL;
  return value?.trim() ? normalizeBaseUrl(value) : undefined;
}

export async function saveBaseUrl(cwd: string, input: string): Promise<string> {
  const value = normalizeBaseUrl(input);
  await mkdir(getPluginsDir(), { recursive: true });
  await new PluginManager(cwd).setPluginSetting("nanaho-omp", "baseUrl", value);
  return value;
}
