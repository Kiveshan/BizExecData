import { readFileSync } from "fs";
import pg from "pg";
import { resolveDatabaseUrl } from "./databaseUrl.js";
import prismaPkg from "../generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { createModuleLogger } from "../utils/logger.js";

const { PrismaClient } = prismaPkg;
const { Pool } = pg;

let prisma;
let pool;

const prismaClientLogger = createModuleLogger("prisma-client");

/**
 * The single pg pool shared by Prisma and the session store, so the app
 * holds one set of database connections rather than two.
 */
export function getPgPool() {
  if (pool) return pool;

  const connectionString = resolveDatabaseUrl();
  if (!connectionString) {
    throw new Error("DATABASE_URL (or DB_HOST/DB_NAME/DB_USER/DB_PASSWORD) is required to initialize PrismaClient");
  }

  const ssl = resolveSsl();

  try {
    const redacted = new URL(connectionString);
    prismaClientLogger.info(
      {
        host: redacted.hostname,
        port: redacted.port,
        database: redacted.pathname?.replace("/", ""),
        user: redacted.username,
        ssl: Boolean(ssl),
      },
      "Initializing PrismaClient"
    );
  } catch {
    prismaClientLogger.warn({ ssl: Boolean(ssl) }, "Initializing PrismaClient (unable to parse DATABASE_URL)");
  }

  pool = new Pool({ connectionString, ssl });
  return pool;
}

/**
 * With DB_SSL_CA_PATH set (the container image ships the RDS CA bundle) the
 * server certificate is verified. The unverified fallback remains only for
 * environments that have not been given the bundle yet.
 */
function resolveSsl() {
  const caPath = process.env.DB_SSL_CA_PATH;
  if (caPath) {
    return { ca: readFileSync(caPath, "utf8"), rejectUnauthorized: true };
  }

  const isProduction = process.env.NODE_ENV === "production";
  const dbSslEnabled = String(process.env.DB_SSL || "").toLowerCase() === "true";
  if (!isProduction && !dbSslEnabled) return undefined;

  prismaClientLogger.warn("DB_SSL_CA_PATH not set - database TLS certificate is NOT verified");
  return { rejectUnauthorized: false };
}

/** Closes Prisma and the shared pool; used during graceful shutdown. */
export async function closeDatabase() {
  if (prisma) await prisma.$disconnect();
  if (pool) await pool.end();
  prisma = undefined;
  pool = undefined;
}

export function getPrismaClient() {
  if (prisma) return prisma;

  const adapter = new PrismaPg(getPgPool());
  prisma = new PrismaClient({ adapter });
  return prisma;
}
