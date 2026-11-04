/**
 * Token-level streaming for the chat surface.
 *
 * The orchestrator does not stream: it needs whole tool calls, and a partial
 * JSON tool call is useless. Chat is the opposite — the value of streaming
 * there is evidential as much as cosmetic. Tokens arriving one at a time, with
 * the provider and model named and the token counts reported at the end, is
 * direct observable proof that a model is genuinely being called rather than a
 * canned answer being replayed.
 *
 * Kept separate from `llm.ts` so the request/response providers the agent
 * depends on are not reshaped around a concern only the chat has.
 */

import { spawn } from "node:child_process";
import {
  claudeCodeBinary,
  resolveProviderId,
  type LlmMessage,
  type ProviderId,
} from "./llm";

export type StreamUsage = {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
};

export type StreamEvent =
  | { type: "meta"; provider: ProviderId; model: string; streaming: boolean }
  | { type: "delta"; text: string }
  | { type: "done"; text: string; usage?: StreamUsage }
  | { type: "error"; message: string };

export function streamingProvider(): { id: ProviderId; model: string; streaming: boolean } | null {
  const id = resolveProviderId();
  switch (id) {
    case "claude-code":
      return { id, model: process.env.CLAUDE_CODE_MODEL ?? "haiku", streaming: !!claudeCodeBinary() };
    case "gemini":
      return { id, model: process.env.GEMINI_MODEL ?? "gemini-2.0-flash", streaming: true };
    case "groq":
      return { id, model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile", streaming: true };
    case "openai":
      return { id, model: process.env.OPENAI_MODEL ?? "gpt-4o-mini", streaming: true };
    case "anthropic":
      return { id, model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5", streaming: true };
    default:
      return null;
  }
}

export async function* streamChat(messages: LlmMessage[]): AsyncGenerator<StreamEvent> {
  const provider = streamingProvider();
  if (!provider) {
    yield { type: "error", message: "No model provider is configured." };
    return;
  }

  yield { type: "meta", provider: provider.id, model: provider.model, streaming: provider.streaming };

  try {
    switch (provider.id) {
      case "claude-code":
        yield* streamClaudeCode(messages, provider.model);
        return;
      case "gemini":
        yield* streamGemini(messages, provider.model);
        return;
      case "anthropic":
        yield* streamAnthropic(messages, provider.model);
        return;
      default:
        yield* streamOpenAiCompatible(messages, provider.id, provider.model);
        return;
    }
  } catch (e) {
    yield { type: "error", message: (e as Error).message };
  }
}

function flatten(messages: LlmMessage[]): { system: string; prompt: string } {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const prompt = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${"content" in m ? m.content : ""}`)
    .join("\n\n");
  return { system, prompt };
}

/**
 * Reads an SSE body line by line.
 *
 * Chunk boundaries fall wherever the network puts them, so a `data:` line can
 * arrive split across two reads; the remainder is carried over rather than
 * parsed as a truncated line.
 */
async function* sseLines(res: Response): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("data:")) yield trimmed.slice(5).trim();
    }
  }
  const tail = buffer.trim();
  if (tail.startsWith("data:")) yield tail.slice(5).trim();
}

async function* streamClaudeCode(messages: LlmMessage[], model: string): AsyncGenerator<StreamEvent> {
  const binary = claudeCodeBinary();
  if (!binary) {
    yield { type: "error", message: "Claude Code CLI not found on PATH." };
    return;
  }

  const { system, prompt } = flatten(messages);
  const child = spawn(
    binary,
    [
      "-p",
      "--output-format", "stream-json",
      "--include-partial-messages",
      "--verbose",
      "--model", model,
      "--allowed-tools", "",
      "--exclude-dynamic-system-prompt-sections",
    ],
    { stdio: ["pipe", "pipe", "pipe"], env: process.env },
  );

  child.stdin.end(system ? `${system}\n\n${prompt}` : prompt);

  const queue: StreamEvent[] = [];
  let finished = false;
  let failure: string | null = null;
  let wake: (() => void) | null = null;
  const nudge = () => { wake?.(); wake = null; };

  let text = "";
  let usage: StreamUsage | undefined;
  let buffer = "";

  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (parsed.type === "stream_event") {
        const event = parsed.event as { type?: string; delta?: { type?: string; text?: string } } | undefined;
        const delta = event?.delta;
        if (event?.type === "content_block_delta" && delta?.type === "text_delta" && delta.text) {
          text += delta.text;
          queue.push({ type: "delta", text: delta.text });
        }
      } else if (parsed.type === "result") {
        const u = parsed.usage as { input_tokens?: number; output_tokens?: number } | undefined;
        usage = {
          inputTokens: u?.input_tokens,
          outputTokens: u?.output_tokens,
          costUsd: typeof parsed.total_cost_usd === "number" ? parsed.total_cost_usd : undefined,
        };
        if (parsed.is_error) failure = String(parsed.result ?? "The CLI reported an error.");
        else if (typeof parsed.result === "string" && parsed.result.trim()) text = parsed.result;
      }
    }
    nudge();
  });

  child.stderr.on("data", () => { /* progress chatter; the result event carries failures */ });
  child.on("error", (e: Error) => { failure = e.message; finished = true; nudge(); });
  child.on("close", () => { finished = true; nudge(); });

  const timeoutMs = Number(process.env.CLAUDE_CODE_TIMEOUT_MS ?? 180_000);
  const timer = setTimeout(() => {
    failure = `Claude Code CLI timed out after ${timeoutMs}ms`;
    finished = true;
    child.kill("SIGKILL");
    nudge();
  }, timeoutMs);

  try {
    for (;;) {
      while (queue.length) yield queue.shift()!;
      if (finished) break;
      await new Promise<void>((resolve) => { wake = resolve; });
    }
    while (queue.length) yield queue.shift()!;
    if (failure) yield { type: "error", message: failure };
    else yield { type: "done", text, usage };
  } finally {
    clearTimeout(timer);
  }
}

async function* streamGemini(messages: LlmMessage[], model: string): AsyncGenerator<StreamEvent> {
  const { system, prompt } = flatten(messages);
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY ?? "",
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0 },
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      }),
    },
  );
  if (!res.ok) {
    yield { type: "error", message: `${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}` };
    return;
  }

  let text = "";
  let usage: StreamUsage | undefined;
  for await (const data of sseLines(res)) {
    if (!data || data === "[DONE]") continue;
    let parsed: any;
    try {
      parsed = JSON.parse(data);
    } catch {
      continue;
    }
    for (const part of parsed.candidates?.[0]?.content?.parts ?? []) {
      if (typeof part.text === "string" && part.text) {
        text += part.text;
        yield { type: "delta", text: part.text };
      }
    }
    if (parsed.usageMetadata) {
      usage = {
        inputTokens: parsed.usageMetadata.promptTokenCount,
        outputTokens: parsed.usageMetadata.candidatesTokenCount,
      };
    }
  }
  yield { type: "done", text, usage };
}

async function* streamAnthropic(messages: LlmMessage[], model: string): AsyncGenerator<StreamEvent> {
  const { system, prompt } = flatten(messages);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      temperature: 0,
      stream: true,
      ...(system ? { system } : {}),
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    yield { type: "error", message: `${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}` };
    return;
  }

  let text = "";
  let usage: StreamUsage | undefined;
  for await (const data of sseLines(res)) {
    if (!data) continue;
    let parsed: any;
    try {
      parsed = JSON.parse(data);
    } catch {
      continue;
    }
    if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
      text += parsed.delta.text;
      yield { type: "delta", text: parsed.delta.text };
    }
    if (parsed.type === "message_delta" && parsed.usage) {
      usage = { outputTokens: parsed.usage.output_tokens };
    }
  }
  yield { type: "done", text, usage };
}

async function* streamOpenAiCompatible(
  messages: LlmMessage[],
  id: ProviderId,
  model: string,
): AsyncGenerator<StreamEvent> {
  const baseUrl = id === "groq"
    ? process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1"
    : process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const apiKey = id === "groq" ? process.env.GROQ_API_KEY : process.env.OPENAI_API_KEY;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey ?? ""}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      stream: true,
      stream_options: { include_usage: true },
      messages: messages.map((m) => ({
        role: m.role === "tool" ? "user" : m.role,
        content: "content" in m ? m.content : "",
      })),
    }),
  });
  if (!res.ok) {
    yield { type: "error", message: `${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}` };
    return;
  }

  let text = "";
  let usage: StreamUsage | undefined;
  for await (const data of sseLines(res)) {
    if (!data || data === "[DONE]") continue;
    let parsed: any;
    try {
      parsed = JSON.parse(data);
    } catch {
      continue;
    }
    const delta = parsed.choices?.[0]?.delta?.content;
    if (typeof delta === "string" && delta) {
      text += delta;
      yield { type: "delta", text: delta };
    }
    if (parsed.usage) {
      usage = {
        inputTokens: parsed.usage.prompt_tokens,
        outputTokens: parsed.usage.completion_tokens,
      };
    }
  }
  yield { type: "done", text, usage };
}
