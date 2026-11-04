/**
 * Pluggable LLM layer.
 *
 * Four providers are supported, two of which have genuinely free tiers
 * (Google Gemini and Groq). If no key is configured at all, the system does not
 * break — it runs in deterministic mode, which exercises every part of the
 * pipeline except the natural-language reasoning. That matters: the demo is
 * always runnable, and the evaluation harness has a baseline to compare against.
 *
 * Implemented with plain fetch rather than four vendor SDKs to keep the
 * dependency surface small and the request shapes visible.
 */

import { spawn } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";
import { delimiter as pathDelimiter, join as pathJoin } from "node:path";

export type LlmToolCall = { id: string; name: string; args: Record<string, unknown> };

export type LlmMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: LlmToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type LlmToolSpec = { name: string; description: string; parameters: Record<string, unknown> };

export type LlmResponse = { text: string; toolCalls: LlmToolCall[]; raw?: unknown };

export interface LlmProvider {
  readonly id: string;
  readonly model: string;
  chat(messages: LlmMessage[], tools: LlmToolSpec[]): Promise<LlmResponse>;
}

export type ProviderId =
  | "gemini"
  | "groq"
  | "openai"
  | "anthropic"
  | "claude-code"
  | "none";

/**
 * Which provider to use.
 *
 * Explicit `LLM_PROVIDER` wins. Otherwise an API key picks the provider, and
 * failing that we look for a locally authenticated Claude Code CLI — which
 * means a developer who already uses Claude Code gets real model reasoning
 * with no key and no configuration at all. Deterministic mode is the last
 * resort, not the default experience.
 */
export function resolveProviderId(): ProviderId {
  const explicit = process.env.LLM_PROVIDER?.toLowerCase() as ProviderId | undefined;
  if (explicit === "none") return "none";
  if (explicit) return explicit;
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.CLAUDE_CODE_BRIDGE !== "off" && claudeCodeBinary()) return "claude-code";
  return "none";
}

/** Human-readable description of how reasoning is currently configured. */
export function describeProvider(): { id: ProviderId; label: string; real: boolean } {
  const id = resolveProviderId();
  const labels: Record<ProviderId, string> = {
    gemini: `Google Gemini (${process.env.GEMINI_MODEL ?? "gemini-2.0-flash"})`,
    groq: `Groq (${process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile"})`,
    openai: `OpenAI (${process.env.OPENAI_MODEL ?? "gpt-4o-mini"})`,
    anthropic: `Anthropic API (${process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5"})`,
    "claude-code": `Claude Code CLI bridge (${process.env.CLAUDE_CODE_MODEL ?? "haiku"}, local auth, no API key)`,
    none: "Deterministic policy engine (no model configured)",
  };
  return { id, label: labels[id], real: id !== "none" };
}

export function getProvider(): LlmProvider | null {
  switch (resolveProviderId()) {
    case "claude-code": return new ClaudeCodeProvider();
    case "gemini": return new GeminiProvider();
    case "groq": return new OpenAiCompatibleProvider({
      id: "groq",
      baseUrl: process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
      apiKey: process.env.GROQ_API_KEY ?? "",
      model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
    });
    case "openai": return new OpenAiCompatibleProvider({
      id: "openai",
      baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      apiKey: process.env.OPENAI_API_KEY ?? "",
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    });
    case "anthropic": return new AnthropicProvider();
    default: return null;
  }
}

const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 60_000);

// ---------------------------------------------------------------------------
// Claude Code CLI bridge
//
// Uses a locally installed, already-authenticated `claude` CLI as the model
// backend, so no API key is needed. The CLI has no tool-calling API, so tool
// use is emulated: the tool catalogue and the conversation so far are rendered
// into one prompt, and the model is asked to reply with a JSON object naming
// the tool it wants. That object is parsed back into the same LlmResponse
// shape the HTTP providers return, so the orchestrator cannot tell the
// difference.
//
// The CLI is invoked with its own agentic behaviour switched off — no tools,
// no dynamic system prompt — because what is wanted here is a completion, not
// a second agent operating on the filesystem.
// ---------------------------------------------------------------------------

let cachedBinary: string | null | undefined;

/** Absolute path to a `claude` executable on PATH, or null. */
export function claudeCodeBinary(): string | null {
  if (cachedBinary !== undefined) return cachedBinary;
  cachedBinary = null;
  const explicit = process.env.CLAUDE_CODE_BIN;
  const candidates = explicit
    ? [explicit]
    : (process.env.PATH ?? "").split(pathDelimiter).filter(Boolean).map((dir) => pathJoin(dir, "claude"));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, fsConstants.X_OK);
      cachedBinary = candidate;
      break;
    } catch {
      // not on this PATH entry; keep looking
    }
  }
  return cachedBinary;
}

function renderToolCatalogue(tools: LlmToolSpec[]): string {
  return tools
    .map((t) => `- ${t.name}: ${t.description}\n  parameters: ${JSON.stringify(t.parameters)}`)
    .join("\n");
}

function renderConversation(messages: LlmMessage[]): string {
  const parts: string[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "user") {
      parts.push(`## Situation\n${m.content}`);
    } else if (m.role === "assistant") {
      const calls = (m.toolCalls ?? []).map((c) => `${c.name}(${JSON.stringify(c.args)})`).join(", ");
      parts.push(`## You previously said\n${m.content || "(no commentary)"}${calls ? `\nYou called: ${calls}` : ""}`);
    } else {
      parts.push(`## Result of ${m.name}\n${m.content}`);
    }
  }
  return parts.join("\n\n");
}

/** Pull the first balanced JSON object out of a model reply. */
function extractJsonObject(raw: string): Record<string, unknown> | null {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

class ClaudeCodeProvider implements LlmProvider {
  readonly id = "claude-code";
  readonly model = process.env.CLAUDE_CODE_MODEL ?? "haiku";

  async chat(messages: LlmMessage[], tools: LlmToolSpec[]): Promise<LlmResponse> {
    const binary = claudeCodeBinary();
    if (!binary) throw new Error("Claude Code CLI not found on PATH. Set CLAUDE_CODE_BIN or install it.");

    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");

    const prompt = [
      "# How this works — read this first",
      "",
      "You are being driven by an automated harness, not chatting with a person.",
      "You have NO direct tool access in this session, and you do not need any.",
      "",
      "You request a tool by emitting a JSON object naming it. The harness executes",
      "the tool against the real database and sends you the result in the next turn.",
      "This is how every tool below is called. Never reply that tools are unavailable",
      "to you, and never ask the harness for permission or clarification — emit the",
      "JSON and the harness will do the rest.",
      "",
      "# Tools available to you",
      renderToolCatalogue(tools),
      "",
      "# Your instructions",
      system,
      "",
      "# Conversation so far",
      renderConversation(messages),
      "",
      "# Reply format — STRICT",
      "Reply with ONE JSON object and nothing else. No prose outside it, no markdown fences.",
      "",
      'To call tools:  {"tool_calls":[{"name":"<tool>","args":{...}}],"text":"<why, one or two sentences>"}',
      'When finished:  {"tool_calls":[],"text":"<your conclusion>"}',
      "",
      "Rules:",
      "- Call only tools listed above, with exactly the parameters in their schema.",
      "- You may call several independent tools in one reply.",
      "- Do not invent numbers. Every figure must come from a tool result.",
      "- Do not stop to ask questions. If you lack a fact, call the tool that supplies it.",
    ].join("\n");

    const stdout = await this.invoke(binary, prompt);

    let envelope: Record<string, unknown>;
    try {
      envelope = JSON.parse(stdout) as Record<string, unknown>;
    } catch {
      throw new Error(`Claude Code CLI returned unparseable output: ${stdout.slice(0, 300)}`);
    }
    if (envelope.is_error) {
      throw new Error(`Claude Code CLI reported an error: ${String(envelope.result).slice(0, 300)}`);
    }

    const body = extractJsonObject(String(envelope.result ?? ""));
    if (!body) {
      return { text: String(envelope.result ?? ""), toolCalls: [], raw: envelope };
    }

    const rawCalls = Array.isArray(body.tool_calls) ? body.tool_calls : [];
    const toolCalls: LlmToolCall[] = rawCalls
      .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
      .filter((c) => typeof c.name === "string")
      .map((c, i) => ({
        id: `cc_${Date.now().toString(36)}_${i}`,
        name: String(c.name),
        args: (c.args ?? c.arguments ?? {}) as Record<string, unknown>,
      }));

    return { text: typeof body.text === "string" ? body.text : "", toolCalls, raw: envelope };
  }

  private invoke(binary: string, prompt: string): Promise<string> {
    const timeoutMs = Number(process.env.CLAUDE_CODE_TIMEOUT_MS ?? 180_000);
    return new Promise((resolve, reject) => {
      const child = spawn(
        binary,
        [
          "-p",
          "--output-format", "json",
          "--model", this.model,
          "--allowed-tools", "",
          "--exclude-dynamic-system-prompt-sections",
        ],
        { stdio: ["pipe", "pipe", "pipe"], env: process.env },
      );

      let out = "";
      let err = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`Claude Code CLI timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.stdout.on("data", (d: Buffer) => { out += d.toString(); });
      child.stderr.on("data", (d: Buffer) => { err += d.toString(); });
      child.on("error", (e: Error) => { clearTimeout(timer); reject(e); });
      child.on("close", (code: number | null) => {
        clearTimeout(timer);
        if (code !== 0) reject(new Error(`Claude Code CLI exited ${code}: ${err.slice(0, 300)}`));
        else resolve(out);
      });

      child.stdin.end(prompt);
    });
  }
}

async function postJson(url: string, body: unknown, headers: Record<string, string>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 500)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// OpenAI-compatible (covers OpenAI and Groq)
// ---------------------------------------------------------------------------

class OpenAiCompatibleProvider implements LlmProvider {
  readonly id: string;
  readonly model: string;
  private baseUrl: string;
  private apiKey: string;

  constructor(cfg: { id: string; baseUrl: string; apiKey: string; model: string }) {
    this.id = cfg.id;
    this.baseUrl = cfg.baseUrl;
    this.apiKey = cfg.apiKey;
    this.model = cfg.model;
  }

  async chat(messages: LlmMessage[], tools: LlmToolSpec[]): Promise<LlmResponse> {
    const body = {
      model: this.model,
      temperature: 0,
      messages: messages.map((m) => {
        if (m.role === "tool") {
          return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
        }
        if (m.role === "assistant" && m.toolCalls?.length) {
          return {
            role: "assistant",
            content: m.content || null,
            tool_calls: m.toolCalls.map((tc) => ({
              id: tc.id,
              type: "function",
              function: { name: tc.name, arguments: JSON.stringify(tc.args) },
            })),
          };
        }
        return { role: m.role, content: m.content };
      }),
      tools: tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
      tool_choice: "auto",
    };

    const json = await postJson(`${this.baseUrl}/chat/completions`, body, {
      authorization: `Bearer ${this.apiKey}`,
    });

    const choice = json.choices?.[0]?.message ?? {};
    const toolCalls: LlmToolCall[] = (choice.tool_calls ?? []).map((tc: any) => ({
      id: tc.id,
      name: tc.function?.name,
      args: safeParse(tc.function?.arguments),
    }));
    return { text: choice.content ?? "", toolCalls, raw: json };
  }
}

// ---------------------------------------------------------------------------
// Google Gemini (free tier)
// ---------------------------------------------------------------------------

class GeminiProvider implements LlmProvider {
  readonly id = "gemini";
  readonly model = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";
  private apiKey = process.env.GEMINI_API_KEY ?? "";

  async chat(messages: LlmMessage[], tools: LlmToolSpec[]): Promise<LlmResponse> {
    const systemText = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");

    const contents: unknown[] = [];
    for (const m of messages) {
      if (m.role === "system") continue;
      if (m.role === "user") {
        contents.push({ role: "user", parts: [{ text: m.content }] });
      } else if (m.role === "assistant") {
        const parts: unknown[] = [];
        if (m.content) parts.push({ text: m.content });
        for (const tc of m.toolCalls ?? []) {
          parts.push({ functionCall: { name: tc.name, args: tc.args } });
        }
        if (parts.length) contents.push({ role: "model", parts });
      } else {
        contents.push({
          role: "user",
          parts: [{ functionResponse: { name: m.name, response: { result: safeParse(m.content) } } }],
        });
      }
    }

    const body: Record<string, unknown> = {
      contents,
      generationConfig: { temperature: 0 },
      tools: [{
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: stripUnsupported(t.parameters),
        })),
      }],
    };
    if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };

    const json = await postJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
      body,
      { "x-goog-api-key": this.apiKey },
    );

    const parts = json.candidates?.[0]?.content?.parts ?? [];
    const text = parts.filter((p: any) => p.text).map((p: any) => p.text).join("");
    const toolCalls: LlmToolCall[] = parts
      .filter((p: any) => p.functionCall)
      .map((p: any, i: number) => ({
        id: `gemini-${Date.now()}-${i}`,
        name: p.functionCall.name,
        args: p.functionCall.args ?? {},
      }));
    return { text, toolCalls, raw: json };
  }
}

/** Gemini rejects `additionalProperties`; strip it recursively. */
function stripUnsupported(schema: Record<string, unknown>): Record<string, unknown> {
  const clone: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === "additionalProperties") continue;
    clone[k] = v && typeof v === "object" && !Array.isArray(v)
      ? stripUnsupported(v as Record<string, unknown>)
      : v;
  }
  return clone;
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

class AnthropicProvider implements LlmProvider {
  readonly id = "anthropic";
  readonly model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";
  private apiKey = process.env.ANTHROPIC_API_KEY ?? "";

  async chat(messages: LlmMessage[], tools: LlmToolSpec[]): Promise<LlmResponse> {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");

    const converted: unknown[] = [];
    for (const m of messages) {
      if (m.role === "system") continue;
      if (m.role === "user") {
        converted.push({ role: "user", content: m.content });
      } else if (m.role === "assistant") {
        const content: unknown[] = [];
        if (m.content) content.push({ type: "text", text: m.content });
        for (const tc of m.toolCalls ?? []) {
          content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.args });
        }
        if (content.length) converted.push({ role: "assistant", content });
      } else {
        converted.push({
          role: "user",
          content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }],
        });
      }
    }

    const json = await postJson(
      "https://api.anthropic.com/v1/messages",
      {
        model: this.model,
        max_tokens: 4096,
        temperature: 0,
        system: system || undefined,
        messages: converted,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        })),
      },
      { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
    );

    const blocks = json.content ?? [];
    const text = blocks.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    const toolCalls: LlmToolCall[] = blocks
      .filter((b: any) => b.type === "tool_use")
      .map((b: any) => ({ id: b.id, name: b.name, args: b.input ?? {} }));
    return { text, toolCalls, raw: json };
  }
}

function safeParse(s: unknown): any {
  if (typeof s !== "string") return s ?? {};
  try { return JSON.parse(s); } catch { return { _raw: s }; }
}
