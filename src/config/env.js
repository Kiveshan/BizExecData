import dotenv from "dotenv";

dotenv.config();

export const port = process.env.PORT || 3000;

// AES-256 requires a 32-byte key. Must be provided via the environment —
// there is intentionally no hardcoded fallback so a real key never lives in source.
export const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
export const IV_LENGTH = 16;

const MIN_SESSION_SECRET_LENGTH = 32;

// Values shipped in .env.example / old defaults. Deploying with one of these
// means anyone who has read the repo can forge session cookies.
const PLACEHOLDER_SECRETS = new Set([
  "replace-with-a-long-random-string",
  "default-secret-change-in-production",
  "your-secret-key",
  "0123456789abcdef0123456789abcdef",
]);

/**
 * Throws if any secret the app cannot safely run without is missing or weak.
 * Called once at startup so a bad deploy fails immediately instead of
 * serving traffic with forgeable sessions or a broken cipher.
 */
export function validateEnv(env = process.env) {
  if (env.NODE_ENV === "test") return;

  const problems = [];

  if (!env.DATABASE_URL) {
    problems.push("DATABASE_URL is not set");
  }

  const sessionSecret = env.SESSION_SECRET;
  if (!sessionSecret) {
    problems.push("SESSION_SECRET is not set");
  } else if (PLACEHOLDER_SECRETS.has(sessionSecret)) {
    problems.push("SESSION_SECRET is still the example placeholder");
  } else if (sessionSecret.length < MIN_SESSION_SECRET_LENGTH) {
    problems.push(`SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters`);
  }

  const encryptionKey = env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    problems.push("ENCRYPTION_KEY is not set");
  } else if (PLACEHOLDER_SECRETS.has(encryptionKey)) {
    problems.push("ENCRYPTION_KEY is still the example placeholder");
  } else if (Buffer.byteLength(encryptionKey) !== 32) {
    problems.push(
      `ENCRYPTION_KEY must be exactly 32 bytes (got ${Buffer.byteLength(encryptionKey)})`
    );
  }

  if (problems.length > 0) {
    throw new Error(`Invalid environment configuration:\n  - ${problems.join("\n  - ")}`);
  }
}
