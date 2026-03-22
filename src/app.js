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
import logger, { createModuleLogger } from "./utils/logger.js";

const appLogger = createModuleLogger("app");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();
appLogger.info("Environment loaded", { nodeEnv: process.env.NODE_ENV });

const app = express();

// Trust proxy - required for express-rate-limit behind load balancer/reverse proxy
app.set('trust proxy', 1);

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info({
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      userAgent: req.get('user-agent'),
      ip: req.ip
    }, "Request completed");
  });
  next();
});


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
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      scriptSrcAttr: ["'unsafe-hashes'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://cdn.jsdelivr.net"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
}));
appLogger.debug("Helmet security middleware enabled");

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Too many login attempts, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
  // Skip validation for X-Forwarded-For when behind proxy
  validate: { xForwardedForHeader: false },
});
appLogger.debug("Rate limiting configured for auth endpoints");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set("view engine", "ejs");
appLogger.debug("View engine configured (ejs)");

app.use(bodyParser.urlencoded({ extended: true }));
app.use(flash());
app.use(createSessionMiddleware());
appLogger.debug("Session middleware configured");

app.use(passport.initialize());
app.use(passport.session());
appLogger.debug("Passport initialized");

app.use(methodOverride("_method"));
app.use(fileUpload({
  limits: { fileSize: 50 * 1024 * 1024 },
  abortOnLimit: true,
}));
appLogger.debug("File upload middleware configured");

// Export rate limiter for use in routes
app.authLimiter = authLimiter;

initializePassport(passport);
appLogger.info("Application initialization complete");

export default app;
export { __dirname, errorHandler, notFoundHandler };
