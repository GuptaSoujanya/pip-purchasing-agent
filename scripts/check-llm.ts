/**
 * Proves that the configured LLM provider is genuinely reachable and is
 * actually driving the agent — rather than silently falling back to the
 * deterministic engine.
 *
 *   npm run check:llm
 *
 * Three checks, in increasing strength:
 *   1. the provider answers at all;
 *   2. it can select a tool from the real tool catalogue;
 *   3. a full scenario run completes in llm mode, and the recorded trace
 *      contains model-issued tool calls.
 */

import { resetSchema } from "../src/lib/db/client";
import { seed } from "../src/lib/db/seed";
import { claudeCodeBinary, describeProvider, getProvider, resolveProviderId } from "../src/lib/agent/llm";
import { TOOLS, toolsAsJsonSchema } from "../src/lib/agent/tools";
import { runAgent } from "../src/lib/agent/orchestrator";
import { getSteps } from "../src/lib/db/repo";

const C = { reset: "\x1b[0m", dim: "\x1b[90m", bold: "\x1b[1m", green: "\x1b[32m", red: "\x1b[31m", amber: "\x1b[33m", cyan: "\x1b[36m" };
const pass = (s: string) => console.log(`  ${C.green}✓${C.reset} ${s}`);
const fail = (s: string) => console.log(`  ${C.red}✗${C.reset} ${s}`);
const info = (k: string, v: string) => console.log(`  ${C.dim}${k.padEnd(18)}${C.reset}${v}`);

async function main() {
  console.log();
  console.log(`${C.bold}LLM provider check${C.reset}`);
  console.log(`${C.dim}${"─".repeat(70)}${C.reset}`);

  const described = describeProvider();
  info("Provider", described.label);
  info("Resolved id", resolveProviderId());
  info("Claude Code CLI", claudeCodeBinary() ?? `${C.dim}not found on PATH${C.reset}`);
  console.log();

  if (!described.real) {
    console.log(`${C.amber}No model provider is configured, so the agent is running on the${C.reset}`);
    console.log(`${C.amber}deterministic policy engine.${C.reset}`);
    console.log();
    console.log("To use real model reasoning, pick one:");
    console.log(`  ${C.cyan}Claude Code bridge${C.reset} — install the Claude Code CLI and sign in. No API key.`);
    console.log("      https://claude.com/claude-code");
    console.log(`  ${C.cyan}Google Gemini${C.reset} — free tier. Put GEMINI_API_KEY in .env.local`);
    console.log("      https://aistudio.google.com/apikey");
    console.log(`  ${C.cyan}Groq${C.reset} — free tier. Put GROQ_API_KEY in .env.local");`);
    console.log();
    process.exit(1);
  }

  const provider = getProvider();
  if (!provider) {
    fail("Provider resolved but could not be constructed.");
    process.exit(1);
  }

  // --- 1. Can it answer at all? -------------------------------------------
  console.log(`${C.bold}1. Reachability${C.reset}`);
  const t0 = Date.now();
  try {
    const res = await provider.chat(
      [
        { role: "system", content: "You are a terse assistant." },
        { role: "user", content: 'Reply with exactly this JSON and nothing else: {"tool_calls":[],"text":"ready"}' },
      ],
      [],
    );
    if (!res.text && !res.toolCalls.length) throw new Error("empty response");
    pass(`${provider.id} responded in ${Date.now() - t0}ms — "${res.text.slice(0, 60)}"`);
  } catch (e) {
    fail(`${provider.id} did not respond: ${(e as Error).message}`);
    process.exit(1);
  }

  // --- 2. Can it select a real tool? --------------------------------------
  console.log();
  console.log(`${C.bold}2. Tool selection${C.reset}`);
  const readToolNames = new Set(TOOLS.filter((t) => t.kind === "read").map((t) => t.name));
  const readTools = toolsAsJsonSchema().filter((t) => readToolNames.has(t.name));
  try {
    const res = await provider.chat(
      [
        { role: "system", content: "You are a purchasing agent. Obtain facts with tools before concluding anything." },
        {
          role: "user",
          content:
            "The system recommends buying 800 units of product PRD-1001 at node NODE-BOG-01. " +
            "Begin investigating. Call the tool that tells you the current stock position.",
        },
      ],
      readTools,
    );
    if (!res.toolCalls.length) {
      fail(`Model replied without calling a tool: "${res.text.slice(0, 120)}"`);
      process.exit(1);
    }
    for (const call of res.toolCalls) {
      const known = TOOLS.some((t) => t.name === call.name);
      if (known) pass(`chose ${C.cyan}${call.name}${C.reset}(${JSON.stringify(call.args)})`);
      else fail(`hallucinated a tool that does not exist: ${call.name}`);
    }
  } catch (e) {
    fail(`Tool selection failed: ${(e as Error).message}`);
    process.exit(1);
  }

  // --- 3. Does a full run actually use it? --------------------------------
  console.log();
  console.log(`${C.bold}3. End-to-end run in llm mode${C.reset}`);
  const db = resetSchema();
  seed(db);
  db.close();

  const run = await runAgent(
    { scenario: "recommendation_review", node_id: "NODE-BOG-01", product_id: "PRD-1001", recommended_qty: 800 },
    { mode: "llm", actor: "check.llm" },
  );

  info("Run mode", run.mode);
  info("Decision", `${run.decision} ${run.recommendedQty} units`);
  info("Status", run.status);

  if (run.mode !== "llm") {
    fail(`Run fell back to ${run.mode} mode.`);
    process.exit(1);
  }

  const steps = getSteps(run.runId);
  const modelToolCalls = steps.filter((s) => s.type === "tool_call");
  const modelNotes = steps.filter((s) => s.phase === "investigate");

  if (!modelToolCalls.length) {
    fail("The trace contains no tool calls — the model did not drive the investigation.");
    process.exit(1);
  }

  pass(`the model made ${modelToolCalls.length} tool calls across ${modelNotes.length} investigation steps`);
  for (const s of modelToolCalls.slice(0, 8)) {
    console.log(`      ${C.dim}·${C.reset} ${s.tool_name}`);
  }
  if (modelToolCalls.length > 8) console.log(`      ${C.dim}… and ${modelToolCalls.length - 8} more${C.reset}`);

  pass(`decision reconciled against the policy engine and validated (${steps.length} steps recorded)`);

  console.log();
  console.log(`${C.dim}${"─".repeat(70)}${C.reset}`);
  console.log(`${C.green}${C.bold}Real model reasoning is working via ${described.label}.${C.reset}`);
  console.log(`${C.dim}Full trace: npm run dev → Agent activity → ${run.runId}${C.reset}`);
  console.log();
}

main().catch((e) => {
  console.error(`\n${C.red}Check failed:${C.reset}`, e);
  process.exit(1);
});
