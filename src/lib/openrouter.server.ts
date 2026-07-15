import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/**
 * OpenRouter provider for the Vercel AI SDK.
 * Uses the OpenAI-compatible chat completions API at
 * https://openrouter.ai/api/v1.
 *
 * OpenRouter requires (or recommends) two extra headers:
 *   - HTTP-Referer: your app's URL, for attribution.
 *   - X-Title:      your app's name.
 * Both are set on every request from this provider.
 */
export function createOpenRouterProvider(
  apiKey: string,
  opts: { appUrl?: string; appTitle?: string } = {},
) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  };
  if (opts.appUrl) headers["HTTP-Referer"] = opts.appUrl;
  if (opts.appTitle) headers["X-Title"] = opts.appTitle;

  return createOpenAICompatible({
    name: "openrouter",
    baseURL: "https://openrouter.ai/api/v1",
    headers,
  });
}
