import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

export async function connectDb() {
  const isProduction = process.env.NODE_ENV === "production";
  
  const db = new pg.Client({
    user: process.env.RDS_USERNAME || "postgres",
    host: process.env.RDS_HOSTNAME || "localhost",
    database: process.env.RDS_DB_NAME || "BizExecData",
    password: process.env.RDS_PASSWORD || "123456",
    port: process.env.RDS_PORT || 5433,
    ssl: isProduction ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    max: 20,
  });
  await db.connect();
  return db;
}

export async function closeDb(db) {
  await db.end();
}
