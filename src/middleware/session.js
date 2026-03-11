import session from "express-session";
import dotenv from "dotenv";

dotenv.config();

export function createSessionMiddleware() {
  return session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
  });
}
