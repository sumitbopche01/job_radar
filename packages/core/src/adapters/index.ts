import type { AtsProvider, SourceAdapter } from "../types.js";
import { greenhouseAdapter } from "./greenhouse.js";
import { leverAdapter } from "./lever.js";
import { ashbyAdapter } from "./ashby.js";

export const adapters: Record<string, SourceAdapter> = {
  greenhouse: greenhouseAdapter,
  lever: leverAdapter,
  ashby: ashbyAdapter,
};

export function getAdapter(provider: AtsProvider | string): SourceAdapter | undefined {
  return adapters[provider];
}

export { greenhouseAdapter, leverAdapter, ashbyAdapter };
