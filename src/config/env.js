import dotenv from "dotenv";

dotenv.config();

export const port = process.env.PORT || 3000;

export const ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || "@^o.tykE0~p:jo>xc9H+E]?Ek]$?p";
export const IV_LENGTH = 16;
