/** Shared helpers + the dependency object built once and handed to every tool module. */
export interface ToolContext {
  timezone: string;
  /** Broadcast to the renderer so the graph view refreshes live as a case grows. */
  notifyGraphChanged: (caseName: string) => void;
  /** Live autonomy flag — command modules and shell are withheld in safe mode. */
  isAutonomous: () => boolean;
}

export const text = (t: string, isError = false) => ({
  content: [{ type: "text" as const, text: t }],
  ...(isError ? { isError: true } : {}),
});
