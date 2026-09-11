// Run with: npm test
//
// The Ollama protocol helpers, plus one live check against a local server:
// the request Aether builds is accepted, and a tool call comes back in the
// shape the runner parses. The live test is skipped when nothing listens on
// localhost:11434, so `npm test` stays green on a machine without Ollama.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildChatBody, drainNdjson, explainOllamaHttp, numCtxFor, thinkFor, toOllamaTools, toolResultMessage, DEFAULT_NUM_CTX,
} from "./ollamaWire.ts";
import { ollamaModelInfo } from "./models.ts";

test("num_ctx: Aether's floor wins over a small server default", () => {
  // A model loaded at Ollama's 4k laptop default, with plenty of room above it.
  assert.equal(numCtxFor({ id: "llama3.1", contextLength: 131072, numCtx: 4096 }), DEFAULT_NUM_CTX);
  assert.equal(numCtxFor(undefined), DEFAULT_NUM_CTX);
});

test("num_ctx: never above what the architecture supports", () => {
  assert.equal(numCtxFor({ id: "tiny", contextLength: 8192 }), 8192);
});

test("num_ctx: never shrinks a baked or loaded context", () => {
  // The operator baked 64k into the Modelfile — asking for 32k would reload it smaller.
  assert.equal(numCtxFor({ id: "gemma4", contextLength: 262144, numCtx: 65536, bakedNumCtx: 65536 }), 65536);
  // Loaded at 64k without a baked value: keep it, no reload.
  assert.equal(numCtxFor({ id: "gemma4", contextLength: 262144, numCtx: 65536 }), 65536);
});

test("num_ctx: a model loaded below the floor is reloaded larger, honouring a baked value", () => {
  // Baked 8k, currently loaded at 8k: too small for the brief -> 32k.
  assert.equal(numCtxFor({ id: "small", contextLength: 262144, numCtx: 8192, bakedNumCtx: 8192 }), DEFAULT_NUM_CTX);
  // Baked 64k but someone loaded it at 8k (another client): back to the operator's 64k.
  assert.equal(numCtxFor({ id: "gemma4", contextLength: 262144, numCtx: 8192, bakedNumCtx: 65536 }), 65536);
});

test("num_ctx: OLLAMA_NUM_CTX overrides the floor, garbage does not", () => {
  assert.equal(numCtxFor({ id: "m", contextLength: 131072 }, "16384"), 16384);
  assert.equal(numCtxFor({ id: "m", contextLength: 131072 }, "banana"), DEFAULT_NUM_CTX);
  assert.equal(numCtxFor({ id: "m", contextLength: 131072 }, "512"), DEFAULT_NUM_CTX);
});

test("think: boolean models, level models, and models that do not think", () => {
  const thinks = { id: "qwen3", thinking: true };
  assert.equal(thinkFor("qwen3", "low", thinks), false);
  assert.equal(thinkFor("qwen3", "high", thinks), true);
  // gpt-oss ignores booleans and wants a level.
  assert.equal(thinkFor("gpt-oss:20b", "low", { id: "gpt-oss:20b", thinking: true }), "low");
  assert.equal(thinkFor("gpt-oss:20b", "max", { id: "gpt-oss:20b", thinking: true }), "high");
  // A model that does not think must not be sent the field at all.
  assert.equal(thinkFor("llama3.1", "high", { id: "llama3.1", thinking: false }), undefined);
  // Unknown capability: only opt in when effort asks for it (the runner retries without on refusal).
  assert.equal(thinkFor("mystery", "low", undefined), undefined);
  assert.equal(thinkFor("mystery", "high", undefined), true);
});

test("the request body carries tools, think and num_ctx, and omits what is unset", () => {
  const tools = toOllamaTools([{ name: "a", description: "d", schema: { type: "object", properties: {} } }, { name: "b", description: "d", schema: null }]);
  assert.equal(tools.length, 1);
  const body = buildChatBody("m", [{ role: "user", content: "hi" }], tools, undefined, 32768);
  assert.equal(body.stream, true);
  assert.equal(body.options.num_ctx, 32768);
  assert.ok(!("think" in body));
  assert.equal(body.tools?.[0].function.name, "a");
  const withThink = buildChatBody("m", [], [], false, 4096);
  assert.equal(withThink.think, false);
  assert.ok(!("tools" in withThink));
});

test("NDJSON is split on newlines and a torn tail is kept", () => {
  const { chunks, rest } = drainNdjson('{"message":{"content":"a"}}\n{"message":{"content":"b"},"done":true}\n{"mess');
  assert.equal(chunks.length, 2);
  assert.equal(chunks[1].done, true);
  assert.equal(rest, '{"mess');
});

test("a tool result names its function and its call id", () => {
  const m = toolResultMessage({ id: "call_x", function: { name: "dns_lookup", arguments: {} } }, "ok");
  assert.deepEqual(m, { role: "tool", content: "ok", tool_name: "dns_lookup", tool_call_id: "call_x" });
  assert.ok(!("tool_call_id" in toolResultMessage({ function: { name: "f", arguments: {} } }, "ok")));
});

test("HTTP failures become instructions", () => {
  assert.match(explainOllamaHttp(404, '{"error":"model \'zzz\' not found"}', "zzz"), /ollama pull zzz/);
  assert.match(explainOllamaHttp(400, '{"error":"registry.ollama.ai/library/x does not support tools"}', "x"), /tool calling/);
});

// ── live: only when a local Ollama answers ─────────────────────────────────
const ROOT = process.env.OLLAMA_TEST_ROOT ?? "http://localhost:11434";
const live = await fetch(`${ROOT}/api/tags`, { signal: AbortSignal.timeout(1500) })
  .then((r) => (r.ok ? r.json() as Promise<{ models?: Array<{ name: string }> }> : null))
  .catch(() => null);
const firstModel = live?.models?.[0]?.name;

test("live: a native /api/chat request with tools streams a tool call", { skip: !firstModel && "no local Ollama" }, async () => {
  const model = firstModel!;
  const show = await fetch(`${ROOT}/api/show`, { method: "POST", body: JSON.stringify({ model }) }).then((r) => r.json()) as { capabilities?: string[] };
  if (!show.capabilities?.includes("tools")) return; // nothing to assert against a chat-only model
  const tools = toOllamaTools([{ name: "get_weather", description: "Weather for a city", schema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } }]);
  // Size the request exactly as the app would, so the test never reloads the
  // developer's model smaller than it already is; and if the test is what
  // loads it, do not keep it resident for long.
  const info = await ollamaModelInfo(ROOT, model);
  const body = { ...buildChatBody(model, [{ role: "user", content: "What is the weather in Lisbon right now? Use the tool." }], tools, show.capabilities.includes("thinking") ? false : undefined, numCtxFor(info, process.env.OLLAMA_NUM_CTX)), ...(info?.running ? {} : { keep_alive: "1m" }) };
  const res = await fetch(`${ROOT}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(180_000) });
  if (res.status !== 200) assert.fail(`HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "", sawCall = false, sawDone = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const { chunks, rest } = drainNdjson(buf);
    buf = rest;
    for (const c of chunks) {
      assert.ok(!c.error, c.error);
      for (const tc of c.message?.tool_calls ?? []) {
        if (tc.function.name === "get_weather" && typeof tc.function.arguments === "object") sawCall = true;
      }
      if (c.done) sawDone = true;
    }
  }
  assert.ok(sawDone, "stream ended with done:true");
  assert.ok(sawCall, "the model called get_weather with object arguments");
});
