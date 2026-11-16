import "server-only";
import { createDb, type Db } from "@job-radar/core";

// Reuse one pool across HMR reloads in dev.
const globalForDb = globalThis as unknown as { __jrDb?: Db };

/** Lazily create the pool on first use. Importing this module must NOT connect —
 *  `next build` imports route modules to collect config, and the DB isn't
 *  available then (and shouldn't be needed). */
function getDb(): Db {
  const existing = globalForDb.__jrDb ?? createDb().db;
  if (process.env.NODE_ENV !== "production") globalForDb.__jrDb = existing;
  return existing;
}

// Proxy defers getDb() until the first property access (a real query at runtime).
export const db: Db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb() as object, prop, receiver);
  },
}) as Db;
