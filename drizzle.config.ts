import { defineConfig } from "drizzle-kit";
import "dotenv/config";

export default defineConfig({
  out: "./db/migrations",
  schema: "./db/schema/index.ts",
  dialect: "mysql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "mysql://root@127.0.0.1:3306/pocket_legal_assistant",
  },
});
