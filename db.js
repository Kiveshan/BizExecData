import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

export async function connectDb() {
  const {
    RDS_USERNAME,
    RDS_HOSTNAME,
    RDS_DB_NAME,
    RDS_PASSWORD,
    RDS_PORT,
    DB_SSL,
  } = process.env;

  if (!RDS_USERNAME || !RDS_HOSTNAME || !RDS_DB_NAME || !RDS_PASSWORD) {
    throw new Error(
      "Database environment variables RDS_USERNAME, RDS_HOSTNAME, RDS_DB_NAME, and RDS_PASSWORD must be set"
    );
  }

  const db = new pg.Client({
    user: RDS_USERNAME,
    host: RDS_HOSTNAME,
    database: RDS_DB_NAME,
    password: RDS_PASSWORD,
    port: RDS_PORT ? Number(RDS_PORT) : 5432,
    ssl: DB_SSL ? { rejectUnauthorized: false } : false,
  });
  await db.connect();
  return db;
}

export async function closeDb(db) {
  await db.end();
}
