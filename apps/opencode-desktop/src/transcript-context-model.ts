import type { Model, Session } from "@opencode-ai/sdk/v2";
import type { MessageItem } from "./opencode.js";

export interface ContextMetrics {
  total: number;
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  contextLimit?: number;
  contextPercent?: number;
  cost: number;
  model: string;
  agent: string;
}

/** Mirrors OpenCode's latest-token-bearing-message context calculation. */
export function transcriptContextMetrics(messages: MessageItem[], models: Model[], session?: Session): ContextMetrics | undefined {
  const assistants = messages.filter((message) => message.info.role === "assistant");
  let latest: MessageItem | undefined;
  for (let index = assistants.length - 1; index >= 0; index--) {
    const message = assistants[index]!;
    if (message.info.role !== "assistant") continue;
    const tokens = message.info.tokens;
    if (tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write <= 0) continue;
    latest = message;
    break;
  }
  if (!latest || latest.info.role !== "assistant") return undefined;
  const info = latest.info;
  const tokens = info.tokens;
  const total = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write;
  const model = models.find((candidate) => candidate.providerID === info.providerID && candidate.id === info.modelID);
  const contextLimit = model?.limit.context;
  const fallbackCost = assistants.reduce((sum, message) => sum + (message.info.role === "assistant" ? message.info.cost : 0), 0);
  return {
    total,
    input: tokens.input,
    output: tokens.output,
    reasoning: tokens.reasoning,
    cacheRead: tokens.cache.read,
    cacheWrite: tokens.cache.write,
    contextLimit,
    contextPercent: contextLimit ? Math.round(total / contextLimit * 100) : undefined,
    cost: session?.cost ?? fallbackCost,
    model: model?.name ?? `${info.providerID}/${info.modelID}`,
    agent: info.agent,
  };
}
