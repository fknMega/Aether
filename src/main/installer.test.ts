// Run with: npm test
//
// The installer runs package managers on the user's machine, so the properties
// that keep it safe are asserted rather than assumed: nothing is interpolated
// into a command, nothing runs as root, and an id we do not recognise does not
// reach a shell.
import { test } from "node:test";
import assert from "node:assert/strict";
import { delimiter } from "node:path";
import { allTools, toolFor, installTool } from "./installer.ts";
import { repairPath } from "./env.ts";

test("every bundled command module maps to exactly one installable tool", () => {
  const ids = allTools().map((t) => t.moduleId);
  assert.equal(new Set(ids).size, ids.length, "duplicate moduleId in the catalog");
  for (const t of allTools()) {
    assert.match(t.moduleId, /^def:/, `${t.moduleId} should be a bundled default id`);
    assert.ok(t.bin.length > 0, `${t.moduleId} has no binary name`);
    assert.ok(t.recipes.length > 0, `${t.moduleId} has no way to install it`);
  }
});

test("recipes are argv arrays, never shell strings", () => {
  // A recipe that reached a shell would be the one place a metacharacter could
  // matter. spawn() with an argv array cannot be talked into a second command.
  for (const t of allTools()) {
    for (const r of t.recipes) {
      assert.ok(Array.isArray(r.argv), `${t.bin}: argv must be an array`);
      for (const arg of r.argv) {
        assert.equal(typeof arg, "string");
        assert.doesNotMatch(arg, /[;&|`$><\n]/, `${t.bin}: argv contains a shell metacharacter: ${arg}`);
      }
      assert.doesNotMatch(r.manager, /[^a-z]/, `${t.bin}: manager must be a bare binary name`);
    }
  }
});

test("no recipe contains a placeholder that something could be substituted into", () => {
  // Recipes are constants. If one ever grew a {template} it would mean some
  // caller is expected to fill it in, which is exactly what must not happen.
  for (const t of allTools()) {
    for (const r of t.recipes) {
      for (const arg of r.argv) {
        assert.doesNotMatch(arg, /\{|\}|\$\{/, `${t.bin}: recipe argument looks templated: ${arg}`);
      }
    }
  }
});

test("an unknown module id is refused without spawning anything", async () => {
  const events: unknown[] = [];
  const ok = await installTool("def:definitely-not-real", (e) => events.push(e));
  assert.equal(ok, false);
  assert.equal(events.length, 1);
});

test("a module id that is not a known tool cannot be looked up", () => {
  assert.equal(toolFor("../../etc/passwd"), undefined);
  assert.equal(toolFor("def:nmap; rm -rf /"), undefined);
  assert.ok(toolFor("def:nmap"));
});

test("sudo recipes exist but are never the runnable choice on their own", () => {
  // Some tools genuinely only ship via apt. Those are allowed in the catalog so
  // the UI can show the command — but they must be flagged, so pick() refuses
  // to run them.
  for (const t of allTools()) {
    for (const r of t.recipes) {
      if (r.manager === "apt") {
        assert.equal(r.sudo, true, `${t.bin}: an apt recipe must be marked sudo so it is never executed`);
      }
    }
  }
});

test("repairPath puts the common install dirs ahead of the system ones", () => {
  const before = process.env.PATH;
  try {
    process.env.PATH = "/usr/bin:/bin";
    repairPath();
    const dirs = (process.env.PATH ?? "").split(delimiter);
    const usrBin = dirs.indexOf("/usr/bin");
    // Whichever brew prefix exists on this machine must come first; on a box
    // with neither, the test still asserts /usr/bin survived.
    for (const brewDir of ["/opt/homebrew/bin", "/usr/local/bin"]) {
      const i = dirs.indexOf(brewDir);
      if (i >= 0) assert.ok(i < usrBin, `${brewDir} must precede /usr/bin`);
    }
    assert.ok(usrBin >= 0, "/usr/bin must be preserved");
    assert.equal(new Set(dirs).size, dirs.length, "PATH must not gain duplicates");
  } finally {
    process.env.PATH = before;
  }
});

test("repairPath never drops an entry the user already had", () => {
  const before = process.env.PATH;
  try {
    // A directory that does not exist is kept if it was already on PATH — it
    // may be created later, and silently editing someone's PATH is rude.
    process.env.PATH = ["/usr/bin", "/definitely/not/here"].join(delimiter);
    repairPath();
    assert.ok((process.env.PATH ?? "").split(delimiter).includes("/definitely/not/here"));
  } finally {
    process.env.PATH = before;
  }
});
