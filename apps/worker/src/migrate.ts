import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import { createDb } from "@job-radar/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
// apps/worker/src -> repo root -> packages/core/migrations
const migrationsFolder = resolve(__dirname, "../../../packages/core/migrations");

export async function runMigrate(): Promise<void> {
  const { db, client } = createDb();
  try {
    // pgvector must exist before any halfvec column is created.
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
    await migrate(db, { migrationsFolder });
  } finally {
    await client.end({ timeout: 5 });
  }
}
