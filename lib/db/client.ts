import "server-only";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "@/db/schema";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for database access.");
}

const pool = mysql.createPool(databaseUrl);

/** Server-side database entry point. UI code must never import this module. */
export const db = drizzle({ client: pool, schema });
