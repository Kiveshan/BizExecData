import dotenv from "dotenv";

dotenv.config();

export const port = process.env.PORT || 3000;

export const ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || "REDACTED";
export const IV_LENGTH = 16;
