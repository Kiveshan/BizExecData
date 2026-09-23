/**
 * Idempotent database setup for one environment, run as a one-off ECS task
 * (the migrate task definition with its command overridden) using the RDS
 * master login:
 *
 *   node scripts/db-bootstrap.js
 *
 * - creates DB_NAME if it does not exist (staging)
 * - creates or updates the app role APP_DB_USER with APP_DB_PASSWORD, so
 *   re-running after rotating the secret brings the role back in sync
 * - lets only that role (and the master) connect to DB_NAME
 * - grants data access only (no DDL): migrations run as the master, and
 *   default privileges extend the grants to tables migrations create later
 */
import { readFileSync } from "fs";
import pg from "pg";

const required = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD", "APP_DB_USER", "APP_DB_PASSWORD"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`Missing environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

const {
  DB_HOST,
  DB_PORT = "5432",
  DB_NAME,
  DB_USER,
  DB_PASSWORD,
  APP_DB_USER,
  APP_DB_PASSWORD,
  DB_SSL_CA_PATH,
} = process.env;

const ssl = DB_SSL_CA_PATH
  ? { ca: readFileSync(DB_SSL_CA_PATH, "utf8"), rejectUnauthorized: true }
  : { rejectUnauthorized: false };

function connect(database) {
  return new pg.Client({
    host: DB_HOST,
    port: Number(DB_PORT),
    database,
    user: DB_USER,
    password: DB_PASSWORD,
    ssl,
  });
}

async function main() {
  // Server-level work happens from the maintenance database.
  const admin = connect("postgres");
  await admin.connect();

  const db = admin.escapeIdentifier(DB_NAME);
  const role = admin.escapeIdentifier(APP_DB_USER);
  const master = admin.escapeIdentifier(DB_USER);
  const password = admin.escapeLiteral(APP_DB_PASSWORD);

  try {
    const { rowCount: dbExists } = await admin.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [DB_NAME]
    );
    if (!dbExists) {
      await admin.query(`CREATE DATABASE ${db}`);
      console.log(`Created database ${DB_NAME}`);
    }

    const { rowCount: roleExists } = await admin.query(
      "SELECT 1 FROM pg_roles WHERE rolname = $1",
      [APP_DB_USER]
    );
    // DDL cannot take bind parameters, hence the escaped literals.
    await admin.query(
      roleExists
        ? `ALTER ROLE ${role} WITH LOGIN PASSWORD ${password}`
        : `CREATE ROLE ${role} WITH LOGIN PASSWORD ${password}`
    );
    console.log(`${roleExists ? "Updated" : "Created"} role ${APP_DB_USER}`);

    await admin.query(`REVOKE CONNECT ON DATABASE ${db} FROM PUBLIC`);
    await admin.query(`GRANT CONNECT ON DATABASE ${db} TO ${role}`);
  } finally {
    await admin.end();
  }

  const client = connect(DB_NAME);
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`
    );
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${master} IN SCHEMA public
         GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${master} IN SCHEMA public
         GRANT USAGE, SELECT ON SEQUENCES TO ${role}`
    );
    await client.query("COMMIT");
    console.log(`Granted data access on ${DB_NAME} to ${APP_DB_USER}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Database bootstrap failed:", err.message);
  process.exit(1);
});
