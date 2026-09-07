import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof createDb>["db"];

export function createDb(url = process.env.DATABASE_URL) {
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env (default points at the docker Postgres on :5433).",
    );
  }
  const client = postgres(url, { max: 10 });
  const db = drizzle(client, { schema, casing: "snake_case" });
  return { db, client };
}
