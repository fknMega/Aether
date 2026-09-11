// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatEffortFor, drainSse, isNativeOpenAi, isReasoningModel, openAiFamily, responsesEffortFor } from "./openaiWire.ts";

test("model families are recognised, with and without a gateway prefix", () => {
  assert.equal(openAiFamily("gpt-6-astra"), "gpt6");
  assert.equal(openAiFamily("openai/gpt-5.6-terra"), "gpt56");
  assert.equal(openAiFamily("gpt-5.4-mini"), "gpt54");
  assert.equal(openAiFamily("gpt-5.2"), "gpt52");
  assert.equal(openAiFamily("gpt-5"), "gpt5");
  assert.equal(openAiFamily("gpt-5-mini"), "gpt5");
  assert.equal(openAiFamily("o4-mini"), "o");
  assert.equal(openAiFamily("gpt-oss:120b"), "gpt-oss");
  assert.equal(openAiFamily("gpt-4.1"), "plain");
  assert.equal(openAiFamily("gpt-4o"), "plain");
  assert.equal(openAiFamily("claude-opus-5"), "plain");
  assert.ok(!isReasoningModel("gpt-4.1"));
});

test("Responses effort is clamped to what each family accepts", () => {
  assert.equal(responsesEffortFor("gpt-6-astra", "max"), "max");
  assert.equal(responsesEffortFor("gpt-5.6-sol", "xhigh"), "xhigh");
  assert.equal(responsesEffortFor("gpt-5.4", "max"), "xhigh");
  assert.equal(responsesEffortFor("gpt-5.1", "xhigh"), "high");
  assert.equal(responsesEffortFor("o3", "max"), "high");
  assert.equal(responsesEffortFor("gpt-5.6-luna", "low"), "low");
  // A model that does not reason gets no reasoning block at all.
  assert.equal(responsesEffortFor("gpt-4.1", "high"), undefined);
});

test("Chat Completions: GPT-5.4+ with tools must be `none`; older families keep their effort", () => {
  assert.equal(chatEffortFor("gpt-5.6-terra", "high", true), "none");
  assert.equal(chatEffortFor("gpt-5.4-mini", "medium", true), "none");
  assert.equal(chatEffortFor("gpt-5.6-terra", "high", false), "high");
  assert.equal(chatEffortFor("gpt-5.2", "xhigh", true), "xhigh");
  assert.equal(chatEffortFor("o3", "high", true), "high");
  assert.equal(chatEffortFor("gpt-4.1", "high", true), undefined);
});

test("only api.openai.com takes the Responses API", () => {
  assert.ok(isNativeOpenAi("https://api.openai.com/v1"));
  assert.ok(isNativeOpenAi("https://api.openai.com/v1/"));
  assert.ok(!isNativeOpenAi("https://openrouter.ai/api/v1"));
  assert.ok(!isNativeOpenAi("http://localhost:1234/v1"));
  assert.ok(!isNativeOpenAi("https://api.openai.com.evil.example/v1"));
});

test("SSE blocks are split on blank lines, keep their event name, and leave a torn tail", () => {
  const raw = 'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Hi"}\n\ndata: [DONE]\n\nevent: x\ndata: {"partial';
  const { events, rest } = drainSse(raw);
  assert.equal(events.length, 2);
  assert.equal(events[0].event, "response.output_text.delta");
  assert.equal(JSON.parse(events[0].data).delta, "Hi");
  assert.equal(events[1].data, "[DONE]");
  assert.match(rest, /partial$/);
  // CRLF and multi-line data are handled per the spec.
  const crlf = drainSse("data: a\r\ndata: b\r\n\r\n");
  assert.equal(crlf.events[0].data, "a\nb");
});
