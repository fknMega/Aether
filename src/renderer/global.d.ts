import type { AetherApi } from "../shared/ipc";
declare global {
  interface Window { aether: AetherApi; }
}
export {};
