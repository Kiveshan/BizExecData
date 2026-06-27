import dotenv from "dotenv";

dotenv.config();

export const port = process.env.PORT || 3000;

// AES-256 requires a 32-byte key. Must be provided via the environment —
// there is intentionally no hardcoded fallback so a real key never lives in source.
export const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
export const IV_LENGTH = 16;
