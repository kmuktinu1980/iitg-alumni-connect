import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/**
 * One place to build the Claude client. Keys are trimmed (stray spaces from
 * pasting are common), and ANTHROPIC_WORKSPACE_ID is sent when set, for API
 * keys created at the organization level rather than inside a workspace.
 */
export function claudeClient(opts: { timeout: number }) {
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY?.trim(),
    timeout: opts.timeout,
    maxRetries: 1,
    defaultHeaders: workspace ? { "anthropic-workspace-id": workspace } : undefined,
  });
}
