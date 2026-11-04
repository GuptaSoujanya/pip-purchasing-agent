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

export type ProviderId = "gemini" | "groq" | "openai" | "anthropic" | "none";

/** Which provider to use, inferred from whichever key is present. */
export function resolveProviderId(): ProviderId {
  const explicit = process.env.LLM_PROVIDER?.toLowerCase() as ProviderId | undefined;
  if (explicit && explicit !== "none") return explicit;
  if (explicit === "none") return "none";
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return "none";
}

export function getProvider(): LlmProvider | null {
  switch (resolveProviderId()) {
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
