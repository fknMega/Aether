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

  if (existsSync(paths.privateBriefFile)) {
    parts.push(readFileSync(paths.privateBriefFile, "utf8"));
  }

  return parts.join("\n\n---\n\n");
}
