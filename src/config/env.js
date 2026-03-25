import dotenv from "dotenv";

dotenv.config();

export const port = process.env.PORT || 3000;

export const ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || "a_very_secret_key_of_32_chars_for_aes256";
export const IV_LENGTH = 16;
