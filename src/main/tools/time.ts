import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { ToolContext } from "./context";
import { text } from "./context";

export function timeTools(ctx: ToolContext) {
  const currentTime = tool(
    "current_time",
    "Get the current date and time in the operator's timezone. Call this whenever the answer depends on the current date or time.",
    {},
    async () => {
      const now = new Date();
      return text(JSON.stringify({
        iso: now.toISOString(),
        local: now.toLocaleString("en-US", { timeZone: ctx.timezone }),
        timezone: ctx.timezone,
      }));
    },
  );
  return [currentTime];
}
