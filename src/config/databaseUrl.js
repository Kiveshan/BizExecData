/**
 * Resolves the Postgres connection string.
 *
 * Locally this is just DATABASE_URL. On ECS the credentials arrive as separate
 * DB_USER / DB_PASSWORD values injected from a Secrets Manager secret (plus
 * DB_HOST / DB_PORT / DB_NAME), which avoids storing a password inside a URL
 * and lets the password rotate without rebuilding the string by hand.
 *
 * Kept dependency-free because prisma.config.ts imports it too.
 */
export function resolveDatabaseUrl(env = process.env) {
  if (env.DATABASE_URL) return env.DATABASE_URL;

  const { DB_HOST, DB_PORT = "5432", DB_NAME, DB_USER, DB_PASSWORD } = env;
  if (!DB_HOST || !DB_NAME || !DB_USER || !DB_PASSWORD) return undefined;

  const user = encodeURIComponent(DB_USER);
  const password = encodeURIComponent(DB_PASSWORD);
  return `postgresql://${user}:${password}@${DB_HOST}:${DB_PORT}/${encodeURIComponent(DB_NAME)}`;
}
