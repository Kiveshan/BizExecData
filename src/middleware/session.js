import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import dotenv from "dotenv";
import { getPgPool } from "../config/prismaClient.js";

dotenv.config();

const PgStore = connectPgSimple(session);

// Sessions live in Postgres (the "session" table, created by a Prisma
// migration) so they survive restarts/deploys and are shared across
// instances. Tests use the in-memory store so they need no database.
function createSessionStore() {
  if (process.env.NODE_ENV === "test") return undefined;

  return new PgStore({
    pool: getPgPool(),
    tableName: "session",
    createTableIfMissing: false,
  });
}

export function createSessionMiddleware() {
  const isProduction = process.env.NODE_ENV === "production";
  const secret =
    process.env.NODE_ENV === "test" ? "test-session-secret" : process.env.SESSION_SECRET;

  return session({
    store: createSessionStore(),
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: isProduction,
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24,
    },
  });
}
