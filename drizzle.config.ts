import { defineConfig } from "drizzle-kit";

const fithubDb = process.env.SST_RESOURCE_FithubDb
  ? (JSON.parse(process.env.SST_RESOURCE_FithubDb) as { databaseId: string })
  : null;

export default defineConfig({
  schema: "./packages/core/src/db/schema.ts",
  out: "./drizzle/migrations",
  dialect: "sqlite",
  driver: "d1-http",
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
    databaseId: fithubDb?.databaseId ?? process.env.CLOUDFLARE_DATABASE_ID!,
    token: process.env.CLOUDFLARE_API_TOKEN!,
  },
});
