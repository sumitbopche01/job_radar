import "server-only";
import { createDb, type Db } from "@job-radar/core";

// Reuse one pool across HMR reloads in dev.
const globalForDb = globalThis as unknown as { __jrDb?: Db };

export const db: Db = globalForDb.__jrDb ?? createDb().db;
if (process.env.NODE_ENV !== "production") globalForDb.__jrDb = db;
