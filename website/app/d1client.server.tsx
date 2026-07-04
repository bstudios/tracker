import { drizzle } from "drizzle-orm/d1";

export const db = (database: D1Database) =>
  drizzle(database, {
    logger: import.meta.env.PROD ? false : true,
  });
