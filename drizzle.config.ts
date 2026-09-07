import { defineConfig } from "drizzle-kit";
import "dotenv/config";

export default defineConfig({
  dialect: "postgresql",
  schema: "./packages/core/src/db/schema.ts",
  out: "./packages/core/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://jobradar:jobradar@localhost:5433/jobradar",
  },
  casing: "snake_case",
});
