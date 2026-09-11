import type { AccessLevel } from "../../shared/types";

/** Shared helpers + the dependency object built once and handed to every tool module. */
export interface ToolContext {
  timezone: string;
  /** Broadcast to the renderer so the graph view refreshes live as a case grows. */
  notifyGraphChanged: (caseName: string) => void;
  /** The access level in force RIGHT NOW. Read per call, not per turn: the
   *  operator can change it from the composer while Aether is mid-investigation,
   *  and the next gated call should see the new answer. */
  access: () => AccessLevel;
  /** Live capability flag — command modules and the shell are withheld only at
   *  access level "safe". At "ask" the approval prompt is the gate. */
  isAutonomous: () => boolean;
  /** Put a decision in front of the operator. Resolves true only on an explicit
   *  allow; no window, no answer, or a timeout all resolve false. */
  requestPermission: (req: {
    kind: "shell" | "write" | "network" | "install";
    title: string;
    detail: string;
    reason?: string;
  }) => Promise<boolean>;
}

export const text = (t: string, isError = false) => ({
  content: [{ type: "text" as const, text: t }],
  ...(isError ? { isError: true } : {}),
});
