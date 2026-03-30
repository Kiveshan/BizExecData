import pg from "pg";
import prismaPkg from "../generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { createModuleLogger } from "../utils/logger.js";

const { PrismaClient } = prismaPkg;
const { Pool } = pg;

let prisma;

const prismaClientLogger = createModuleLogger("prisma-client");

export function getPrismaClient() {
  if (prisma) return prisma;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to initialize PrismaClient");
  }

  const isProduction = process.env.NODE_ENV === "production";
  const dbSslEnabled = String(process.env.DB_SSL || "").toLowerCase() === "true";
  const ssl = (isProduction || dbSslEnabled) ? { rejectUnauthorized: false } : undefined;

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

  const pool = new Pool({ connectionString, ssl });
  const adapter = new PrismaPg(pool);
  prisma = new PrismaClient({ adapter });
  return prisma;
}
