import { NextResponse } from "next/server";
import { z } from "zod";
import { answerPurchasingChat } from "@/lib/agent/chat";

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
const headers = { "Cache-Control": "no-store" };

export async function POST(req: Request) {
  if (Number(req.headers.get("content-length")) > MAX_BODY) {
    return NextResponse.json(
      { error: "This conversation is too long. Start a new chat." },
      { status: 413, headers },
    );
  }
  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY)
      return NextResponse.json(
        { error: "This conversation is too long. Start a new chat." },
        { status: 413, headers },
      );
    body = JSON.parse(text);
  } catch {
    return NextResponse.json(
      { error: "Send a JSON body with your messages." },
      { status: 400, headers },
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          "Send 1–20 messages of 1–2,000 characters each, ending with a user question.",
      },
      { status: 400, headers },
    );
  }
  try {
    return NextResponse.json(await answerPurchasingChat(parsed.data.messages), {
      headers,
    });
  } catch {
    return NextResponse.json(
      { error: "I couldn’t read the purchasing workspace. Please try again." },
      { status: 500, headers },
    );
  }
}
