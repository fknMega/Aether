// ─────────────────────────────────────────────────────────────────────────────
// How a custom module's configuration plus an argument becomes a request or a
// command line. Pure functions, no Electron, so the two properties that matter
// most — the model cannot leave the operator's origin, and the model's argument
// cannot break out of the operator's command — are unit-tested.
// ─────────────────────────────────────────────────────────────────────────────
import { platform } from "node:os";

/** The parts of a live module these functions read. */
export interface RequestModule {
  name: string;
  url?: string;
  method?: "GET" | "POST";
  body?: string;
  headers?: Array<{ name: string; value: string }>;
  secretValues: Record<string, string>;
}

export interface HttpCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export const FREEFORM_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type FreeformMethod = (typeof FREEFORM_METHODS)[number];
export interface FreeformArgs {
  path?: string;
  method?: string;
  query?: Record<string, string | number | boolean>;
  body?: string;
}

const isWin = platform() === "win32";

/** Replace {{NAME}} with the module's decrypted secret value. */
export const fillSecrets = (t: string, secrets: Record<string, string>) =>
  t.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_m, k) => secrets[k] ?? "");

// ── command lines ───────────────────────────────────────────────────────────
// The template is the operator's; the one free-form argument is the model's.
// On POSIX the argument is single-quoted, which the shell takes literally. On
// Windows the template runs in PowerShell rather than cmd.exe: cmd expands
// %VARS% and honours & | < > even inside quotes, so there is no safe way to
// quote an untrusted argument for it — PowerShell's single-quoted string is
// literal, and -EncodedCommand bypasses cmd's parsing entirely.

/** POSIX single-quote so an AI-supplied `input` can't break out of the command. */
export const posixQuote = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
/** PowerShell single-quote: the only escape inside is a doubled quote.
 *  PowerShell also treats the typographic single quotes (U+2018–U+201B) as
 *  string delimiters, so those are folded to a doubled ASCII quote too. */
export const psQuote = (s: string) => "'" + s.replace(/['\u2018\u2019\u201A\u201B]/g, "''") + "'";

const PLACEHOLDER = "{input}";

/**
 * Substitute the model's argument into the operator's template.
 *
 * `{input}` must stand on its own as a word, or be the whole of a quoted word
 * (`"{input}"` / `'{input}'`, which many people write by habit) — in both
 * cases it becomes exactly one correctly quoted argument. Anywhere else inside
 * a quoted region the operator's quotes and ours would cancel out and the
 * argument could close the string and start a command, so that is refused
 * with a message the operator sees in "Try it" and the model sees as the tool
 * result. Returns the command line, or `{ error }`.
 */
export function renderCommand(template: string, input: string, win = isWin): string | { error: string } {
  const quoted = win ? psQuote(input) : posixQuote(input);
  // 1. A slot that is the whole quoted word: drop the operator's quotes.
  let t = template.replaceAll(`"${PLACEHOLDER}"`, PLACEHOLDER).replaceAll(`'${PLACEHOLDER}'`, PLACEHOLDER);
  // 2. Any remaining slot must sit outside quotes.
  let out = "";
  let i = 0;
  let quote: string | null = null; // the character that opened the current region
  const opens = (c: string) => c === '"' || c === "'" || (win && /[\u2018\u2019\u201A\u201B\u201C\u201D]/.test(c));
  const closes = (c: string, q: string) =>
    c === q || (win && /[\u2018\u2019\u201A\u201B]/.test(q) && /[\u2018\u2019\u201A\u201B]/.test(c)) || (win && /[\u201C\u201D]/.test(q) && /[\u201C\u201D]/.test(c));
  while (i < t.length) {
    if (t.startsWith(PLACEHOLDER, i)) {
      if (quote) return { error: `The command puts ${PLACEHOLDER} inside a quoted string — write it on its own (or as "${PLACEHOLDER}") so the input is quoted safely.` };
      out += quoted;
      i += PLACEHOLDER.length;
      continue;
    }
    const c = t[i];
    if (!quote && !win && c === "\\") { out += c + (t[i + 1] ?? ""); i += 2; continue; } // POSIX escape outside quotes
    if (quote === '"' && !win && c === "\\") { out += c + (t[i + 1] ?? ""); i += 2; continue; }
    if (quote) { if (closes(c, quote)) quote = null; }
    else if (opens(c)) quote = c;
    out += c;
    i++;
  }
  return out;
}

/**
 * What a Windows argument cannot carry safely. PowerShell 5.1 (and pwsh for
 * .bat/.cmd targets) rebuilds the native command line in the legacy style:
 * an embedded `"` is not escaped and splits the argument, and a .bat/.cmd
 * shim (a gem binstub, npm) is re-parsed by cmd.exe, where `& | < > ^ !`
 * separate commands and `%NAME%` expands environment variables — which is
 * where the module's secrets live. The template cannot tell us what kind of
 * program it runs, so the characters are refused rather than guessed about.
 */
export function windowsArgProblem(input: string): string | undefined {
  const bad = input.match(/["&|<>^%!\r\n]/g);
  if (!bad) return undefined;
  const shown = [...new Set(bad)].map((c) => (c === "\n" || c === "\r" ? "a line break" : c)).join(" ");
  return `On Windows the input may not contain ${shown} — it cannot be passed to a program safely. Rephrase the input without it.`;
}

// ── requests ────────────────────────────────────────────────────────────────

export function baseHeaders(m: RequestModule): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const h of m.headers ?? []) if (h.name.trim()) headers[h.name.trim()] = fillSecrets(h.value ?? "", m.secretValues);
  // Many public APIs reject a missing/blank UA (or throttle it); set a polite
  // default when the module didn't specify one.
  if (!Object.keys(headers).some((k) => k.toLowerCase() === "user-agent")) {
    headers["User-Agent"] = "Aether-OSINT/1.0 (+https://github.com/fknMega/Aether)";
  }
  return headers;
}

/** The fixed-template request: `{input}` filled in, secrets resolved. */
export function templateRequest(m: RequestModule, input: string): HttpCall | { error: string } {
  if (!m.url) return { error: `Module "${m.name}" has no URL configured.` };
  const url = fillSecrets(m.url.replaceAll("{input}", encodeURIComponent(input)), m.secretValues);
  const method = m.method === "POST" ? "POST" : "GET";
  const body = method === "POST" && m.body ? fillSecrets(m.body.replaceAll("{input}", input), m.secretValues) : undefined;
  return { method, url, headers: baseHeaders(m), body };
}

/**
 * A request the model shaped, pinned to the module's origin. `path` resolves
 * against the base URL — relative to it, or from the site root with a leading
 * slash — and anything that would land on another host, scheme or port is
 * refused. The ORIGIN is the boundary, deliberately: any path on the
 * operator's host is fair game, the way any input to a template module is.
 * Query parameters the operator put in the base URL (a key, say) are kept and
 * cannot be overridden.
 */
export function freeformRequest(m: RequestModule, args: FreeformArgs): HttpCall | { error: string } {
  if (!m.url) return { error: `Module "${m.name}" has no base URL configured.` };
  let base: URL;
  try { base = new URL(fillSecrets(m.url, m.secretValues)); } catch { return { error: `Module "${m.name}" has an invalid base URL.` }; }
  if (base.protocol !== "https:" && base.protocol !== "http:") return { error: "The base URL must be http(s)." };

  const rawPath = (args.path ?? "").trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(rawPath) || rawPath.startsWith("//") || rawPath.startsWith("\\")) {
    return { error: "path must be relative to the module's base URL, not an absolute URL." };
  }
  let url: URL;
  try {
    if (!rawPath) url = new URL(base.href);
    else if (rawPath.startsWith("/")) url = new URL(rawPath, base.origin);
    else url = new URL(rawPath, base.href.endsWith("/") ? base.href : base.href + "/");
  } catch { return { error: "path is not a valid URL path." }; }
  if (url.origin !== base.origin) return { error: `Requests must stay on ${base.origin}.` };

  for (const [k, v] of base.searchParams) url.searchParams.set(k, v);
  for (const [k, v] of Object.entries(args.query ?? {})) {
    if (base.searchParams.has(k)) continue;
    url.searchParams.set(k, String(v));
  }

  const wanted = (args.method ?? "GET").toUpperCase();
  const method: FreeformMethod = (FREEFORM_METHODS as readonly string[]).includes(wanted) ? (wanted as FreeformMethod) : "GET";
  const headers = baseHeaders(m);
  let body: string | undefined;
  if (method !== "GET" && method !== "DELETE" && typeof args.body === "string" && args.body.length) {
    body = args.body;
    if (!Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
      headers["Content-Type"] = /^\s*[\[{]/.test(body) ? "application/json" : "text/plain";
    }
  }
  return { method, url: url.href, headers, body };
}

/** What the model (or the operator) is shown a request looked like: method,
 *  URL with secret VALUES replaced by their names, and the body it sent. */
/** Every rendering a secret can take once the URL serializer has touched it:
 *  raw, encodeURIComponent, form-encoded (query values: space → "+", !'()~
 *  escaped), and the WHATWG path percent-encode set (path segments). */
function secretForms(v: string): Set<string> {
  const forms = new Set([v, encodeURIComponent(v)]);
  forms.add(new URLSearchParams([["k", v]]).toString().slice(2));
  forms.add(v.replace(/[\u0000-\u0020"#<>?`{}\u007f-\uffff]/g, (c) => encodeURIComponent(c)));
  return forms;
}

export function describeCall(call: HttpCall, m: RequestModule): string {
  let shown = call.url;
  let body = call.body ?? "";
  for (const [k, v] of Object.entries(m.secretValues)) {
    if (!v || v.length < 4) continue;
    for (const form of secretForms(v)) {
      shown = shown.split(form).join(`{{${k}}}`);
      body = body.split(form).join(`{{${k}}}`);
    }
  }
  return `${call.method} ${shown}${body ? `\n${body.slice(0, 400)}` : ""}`;
}
