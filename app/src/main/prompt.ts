import { existsSync, readFileSync } from "node:fs";
import { paths, runtime } from "./config";
import type { AetherSettings } from "../shared/types";
// Inlined at build time so the public brief can never go missing from the
// packaged output (a plain readFileSync would ENOENT in a bundled app).
import briefTemplate from "./brief.md?raw";

/** Fill the brief's placeholders, splice in the professional-voice override when
 *  chosen, and append the private doctrine supplement if it exists on disk. */
export function systemPrompt(settings: AetherSettings): string {
  let base = briefTemplate;

  const now = new Date();
  const date = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: runtime.timezone });

  base = base
    .replaceAll("{{OWNER}}", settings.ownerName || "friend")
    .replaceAll("{{DATE}}", date)
    .replaceAll("{{TIMEZONE}}", runtime.timezone);

  const parts = [base];

  if (settings.personaVoice === "professional") {
    parts.push([
      "## Voice override (active)",
      "",
      "Drop the pet names and flirtation entirely. Keep the warmth and the quiet confidence, but",
      "write as a professional analyst briefing a colleague: crisp, plain, occasionally dry humour.",
      "Everything else in the brief — the graph discipline, the boundaries, the rigor — is unchanged.",
    ].join("\n"));
  }

  // The access level changes what actually succeeds, so the model is told which
  // one is active. Without this it either never reaches for a capability it has,
  // or keeps retrying one that is refused every time.
  const access = settings.access ?? "ask";
  parts.push([
    "## Access level (active)",
    "",
    access === "safe"
      ? [
          "**Safe.** Collection only. The shell, file writes and installing are unavailable — do not",
          "attempt them or ask for them; they will be refused. Your search, recon, EXIF and graph tools",
          "all work normally, and reading public URLs works. Work the case with those.",
        ].join("\n")
      : access === "full"
      ? [
          "**Full.** The shell, file writes, fetching URLs you choose and installing bundled tools are all",
          "available without a prompt. That is trust, not a licence: stay inside the boundaries in this",
          "brief, and prefer the narrow tool over a shell command when both would work.",
        ].join("\n")
      : [
          "**Ask.** You may reach for the shell, fetch a URL you chose, or install a bundled tool — and",
          "each one is put to the operator, who approves or refuses it. A refusal is an answer, not an",
          "obstacle: say what you would have done, continue with what you have, and do not retry the same",
          "request. Expect a pause while they decide.",
        ].join("\n"),
    "",
    "When a command module fails because its program is missing, call `tool_status` to confirm, then",
    "`install_tool` with the module id to request it. Never invent an install command of your own —",
    "`install_tool` is the only route, and it will not accept one.",
  ].join("\n"));

  if (existsSync(paths.privateBriefFile)) {
    parts.push(readFileSync(paths.privateBriefFile, "utf8"));
  }

  return parts.join("\n\n---\n\n");
}
