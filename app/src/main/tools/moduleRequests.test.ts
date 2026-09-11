// Run with: npm test
//
// A custom module lets the model choose an argument — and, in freeform mode, a
// path, method, query and body. These are the claims that keep that safe:
// the argument cannot escape the operator's command, and the request cannot
// leave the operator's origin.
import { test } from "node:test";
import assert from "node:assert/strict";
import { describeCall, freeformRequest, posixQuote, psQuote, renderCommand, templateRequest, windowsArgProblem } from "./moduleRequests.ts";

const mod = (over: Partial<Parameters<typeof freeformRequest>[0]> = {}) => ({
  name: "api", url: "https://api.example.com/v1/", secretValues: { KEY: "s3cretvalue" },
  headers: [{ name: "Authorization", value: "Bearer {{KEY}}" }], ...over,
});

test("POSIX quoting: a hostile argument is one literal word", () => {
  const cmd = renderCommand("tool {input} --flag", "x'; rm -rf / #", false);
  assert.equal(cmd, "tool 'x'\\''; rm -rf / #' --flag");
  assert.equal(posixQuote("plain"), "'plain'");
});

test("PowerShell quoting: only the doubled quote is an escape, cmd metacharacters stay inert", () => {
  const cmd = renderCommand("tool {input}", "a' | Remove-Item C:\\ & %PATH% $env:X", true);
  assert.equal(cmd, "tool 'a'' | Remove-Item C:\\ & %PATH% $env:X'");
  assert.equal(psQuote("it's"), "'it''s'");
  // Typographic quotes would end a PowerShell string too.
  assert.equal(psQuote("it\u2019s"), "'it''s'");
});

test("a slot the operator quoted by habit becomes one properly quoted argument", () => {
  assert.equal(renderCommand('tool "{input}" -x', "a b", false), "tool 'a b' -x");
  assert.equal(renderCommand("tool '{input}'", "a b", true), "tool 'a b'");
});

test("a slot inside the operator's own quotes is refused, on both shells", () => {
  // Without the refusal, an input with a double quote would close the
  // operator's string and start a command.
  for (const win of [false, true]) {
    for (const tpl of ['tool "x {input} y"', "tool 'x {input} y'", 'tool "--arg={input}"']) {
      const r = renderCommand(tpl, 'a"; rm -rf ~; "', win);
      assert.ok(typeof r !== "string", `${tpl} (win=${win}) must be refused`);
    }
  }
  // Quotes that are closed before the slot are fine.
  assert.equal(renderCommand('tool "a b" {input}', "c", false), 'tool "a b" \'c\'');
  // A POSIX backslash-escaped quote does not open a region.
  assert.equal(renderCommand('echo \\" {input}', "c", false), 'echo \\" \'c\'');
});

test("Windows: an argument that PowerShell/cmd cannot carry is refused, others pass", () => {
  assert.ok(windowsArgProblem('1.2.3.4 " --script=x'));
  assert.ok(windowsArgProblem("a & del C:\\x"));
  assert.ok(windowsArgProblem("%PATH%"));
  assert.ok(windowsArgProblem("line\nbreak"));
  assert.equal(windowsArgProblem("jane.doe@example.com"), undefined);
  assert.equal(windowsArgProblem("it's a 'test' with $env:X and `backticks`"), undefined);
});

test("template request: {input} is URL-encoded in the URL, raw in a POST body, secrets filled", () => {
  const r = templateRequest(mod({ url: "https://api.example.com/search?q={input}&k={{KEY}}", method: "POST", body: '{"q":"{input}"}' }), "a b&c");
  assert.ok(!("error" in r));
  assert.equal(r.url, "https://api.example.com/search?q=a%20b%26c&k=s3cretvalue");
  assert.equal(r.body, '{"q":"a b&c"}');
  assert.equal(r.headers.Authorization, "Bearer s3cretvalue");
  assert.ok(r.headers["User-Agent"]);
});

test("freeform: relative paths resolve under the base, absolute paths from the site root", () => {
  const a = freeformRequest(mod(), { path: "users/jane", query: { page: 2 } });
  assert.ok(!("error" in a));
  assert.equal(a.url, "https://api.example.com/v1/users/jane?page=2");
  const b = freeformRequest(mod(), { path: "/v2/search", method: "post", body: '{"q":1}' });
  assert.ok(!("error" in b));
  assert.equal(b.url, "https://api.example.com/v2/search");
  assert.equal(b.method, "POST");
  assert.equal(b.headers["Content-Type"], "application/json");
  const c = freeformRequest(mod(), {});
  assert.ok(!("error" in c));
  assert.equal(c.url, "https://api.example.com/v1/");
});

test("freeform: the model cannot leave the operator's origin", () => {
  for (const path of ["https://evil.example/x", "//evil.example/x", "http://api.example.com/v1/x", "\\\\evil", "javascript:alert(1)", "user@evil.example:443/x"]) {
    const r = freeformRequest(mod(), { path });
    if (!("error" in r)) assert.equal(new URL(r.url).origin, "https://api.example.com", `${path} must stay on the origin`);
  }
  // Explicitly refused forms (an absolute URL, protocol-relative, a UNC-ish path).
  for (const path of ["https://evil.example/x", "//evil.example/x", "\\\\evil", "javascript:alert(1)"]) {
    assert.ok("error" in freeformRequest(mod(), { path }), `${path} must be refused`);
  }
  // Climbing is allowed — the origin is the boundary, and a leading slash
  // reaches the site root anyway — but it never leaves the host.
  const up = freeformRequest(mod(), { path: "../../../etc" });
  assert.ok(!("error" in up) && up.url === "https://api.example.com/etc");
  // A different port is a different origin.
  const r = freeformRequest(mod({ url: "https://api.example.com:8443/" }), { path: "/x" });
  assert.ok(!("error" in r) && r.url.startsWith("https://api.example.com:8443/"));
});

test("freeform: a key the operator put in the base query cannot be overridden, and unknown methods fall back to GET", () => {
  const r = freeformRequest(mod({ url: "https://api.example.com/v1?apikey={{KEY}}" }), { path: "x", query: { apikey: "mine", q: "z" }, method: "TRACE", body: "ignored" });
  assert.ok(!("error" in r));
  const u = new URL(r.url);
  assert.equal(u.searchParams.get("apikey"), "s3cretvalue");
  assert.equal(u.searchParams.get("q"), "z");
  assert.equal(r.method, "GET");
  assert.equal(r.body, undefined);
});

test("describeCall shows secret names, never values — raw or URL-encoded", () => {
  const r = freeformRequest(mod({ url: "https://api.example.com/v1?apikey={{KEY}}" }), { path: "x" });
  assert.ok(!("error" in r));
  const shown = describeCall(r, mod());
  assert.doesNotMatch(shown, /s3cretvalue/);
  assert.match(shown, /\{\{KEY\}\}/);
  // A secret with a space is form-encoded ("+") by the URL serializer.
  const enc = mod({ url: "https://api.example.com/v1?apikey={{KEY}}", secretValues: { KEY: "a b.c" } });
  const r2 = freeformRequest(enc, { path: "x" });
  assert.ok(!("error" in r2));
  assert.doesNotMatch(describeCall(r2, enc), /a%20b\.c|a b\.c|a\+b/);
  // Form-encoded (URLSearchParams) and path-encoded renderings are masked too.
  const odd = mod({ url: "https://api.example.com/v1?apikey={{KEY}}", secretValues: { KEY: "tok!abc~1 x" } });
  const r3 = freeformRequest(odd, { path: "x" });
  assert.ok(!("error" in r3));
  const shown3 = describeCall(r3, odd);
  assert.doesNotMatch(shown3, /tok%21abc%7E1|tok!abc~1|\+x/);
  assert.match(shown3, /\{\{KEY\}\}/);
});
