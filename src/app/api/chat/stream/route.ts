import { z } from "zod";
import {
  buildChatTurn,
  compactReply,
  validateModelReply,
  type ChatResponse,
} from "@/lib/agent/chat";
import { streamChat, type StreamUsage } from "@/lib/agent/llm-stream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY = 50_000;
const schema = z
  .object({
    messages: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            content: z.string().trim().min(1).max(2000),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict()
  .refine((body) => body.messages.at(-1)?.role === "user", {
    message: "The last message must be a user question.",
    path: ["messages"],
  });

type Frame =
  | { type: "meta"; provider: string; model: string; streaming: boolean }
  | { type: "delta"; text: string }
  | {
      type: "settled";
      accepted: boolean;
      reason?: string;
      detail?: string;
      reply: ChatResponse;
      latencyMs: number;
      usage?: StreamUsage;
    }
  | { type: "error"; message: string };

function badRequest(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function POST(req: Request) {
  if (Number(req.headers.get("content-length")) > MAX_BODY)
    return badRequest("This conversation is too long. Start a new chat.", 413);

  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY)
      return badRequest("This conversation is too long. Start a new chat.", 413);
    body = JSON.parse(text);
  } catch {
    return badRequest("Send a JSON body with your messages.", 400);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success)
    return badRequest(
      "Send 1–20 messages of 1–2,000 characters each, ending with a user question.",
      400,
    );

  let turn: ReturnType<typeof buildChatTurn>;
  try {
    turn = buildChatTurn(parsed.data.messages);
  } catch (cause) {
    console.error("[chat/stream] buildChatTurn failed", cause);
    return badRequest("I couldn’t read the purchasing workspace.", 500);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (frame: Frame) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
      const startedAt = Date.now();
      const unavailable = (): ChatResponse => ({
        ...turn.fallback,
        message: compactReply(
          `The language model is unavailable for this reply. Here’s the answer from current workspace records:\n\n${turn.fallback.message}`,
        ),
      });

      try {
        if (turn.topic === "unsupported") {
          send({
            type: "settled",
            accepted: false,
            reason: "The question is outside this workspace, so no model was called.",
            reply: turn.fallback,
            latencyMs: Date.now() - startedAt,
          });
          return;
        }

        let streamed = "";
        let usage: StreamUsage | undefined;
        let failure: string | undefined;

        for await (const event of streamChat(turn.modelMessages)) {
          switch (event.type) {
            case "meta":
              send({
                type: "meta",
                provider: event.provider,
                model: event.model,
                streaming: event.streaming,
              });
              break;
            case "delta":
              streamed += event.text;
              send({ type: "delta", text: event.text });
              break;
            case "done":
              if (event.text.length > streamed.length) streamed = event.text;
              usage = event.usage;
              break;
            case "error":
              failure = event.message;
              break;
          }
        }

        const latencyMs = Date.now() - startedAt;
        if (failure) {
          send({
            type: "settled",
            accepted: false,
            reason: failure,
            reply: unavailable(),
            latencyMs,
            usage,
          });
          return;
        }

        // The streamed tokens reached the browser before this check could run, so the
        // verdict is reported rather than silently swallowed.
        const verdict = validateModelReply(streamed.trim(), turn.fallback.message);
        send(
          verdict.ok
            ? {
                type: "settled",
                accepted: true,
                reply: {
                  ...turn.fallback,
                  message: compactReply(streamed.trim()),
                  mode: "llm",
                },
                latencyMs,
                usage,
              }
            : {
                type: "settled",
                accepted: false,
                reason: verdict.reason,
                detail: verdict.detail,
                reply: unavailable(),
                latencyMs,
                usage,
              },
        );
      } catch {
        send({
          type: "settled",
          accepted: false,
          reason: "The model stream failed.",
          reply: unavailable(),
          latencyMs: Date.now() - startedAt,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
