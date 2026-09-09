import type { AtsProvider, SourceAdapter } from "../types.js";
import { greenhouseAdapter } from "./greenhouse.js";
import { leverAdapter } from "./lever.js";
import { ashbyAdapter } from "./ashby.js";
import { recruiteeAdapter } from "./recruitee.js";
import { workableAdapter } from "./workable.js";
import { smartrecruitersAdapter } from "./smartrecruiters.js";
import { workdayAdapter } from "./workday.js";
import { oracleAdapter } from "./oracle.js";

export const adapters: Record<string, SourceAdapter> = {
  greenhouse: greenhouseAdapter,
  lever: leverAdapter,
  ashby: ashbyAdapter,
  recruitee: recruiteeAdapter,
  workable: workableAdapter,
  smartrecruiters: smartrecruitersAdapter,
  workday: workdayAdapter,
  oracle: oracleAdapter,
};

export function getAdapter(provider: AtsProvider | string): SourceAdapter | undefined {
  return adapters[provider];
}

export {
  greenhouseAdapter,
  leverAdapter,
  ashbyAdapter,
  recruiteeAdapter,
  workableAdapter,
  smartrecruitersAdapter,
  workdayAdapter,
  oracleAdapter,
};
