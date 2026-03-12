import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import bodyParser from "body-parser";
import flash from "express-flash";
import passport from "passport";
import methodOverride from "method-override";
import fileUpload from "express-fileupload";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import initializePassport from "./config/passport.js";
import { createSessionMiddleware } from "./middleware/session.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { securityConfig } from "./config/security.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();

// CORS configuration
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:3000").split(",");
  
  if (allowedOrigins.includes(origin) || process.env.NODE_ENV !== "production") {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
  
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// Security middleware - helmet for headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
}));

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Too many login attempts, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set("view engine", "ejs");

app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(flash());
app.use(createSessionMiddleware());
app.use(passport.initialize());
app.use(passport.session());
app.use(methodOverride("_method"));
app.use(fileUpload({
  limits: { fileSize: 50 * 1024 * 1024 },
  abortOnLimit: true,
}));

// Export rate limiter for use in routes
app.authLimiter = authLimiter;

initializePassport(passport);

export default app;
export { __dirname, errorHandler, notFoundHandler };
