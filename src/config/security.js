import dotenv from "dotenv";

dotenv.config();

export const securityConfig = {
  cors: {
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  },
  session: {
    secret: process.env.SESSION_SECRET || "default-secret-change-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "strict",
      maxAge: 1000 * 60 * 60 * 24,
    },
  },
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: "Too many attempts, please try again later",
  },
  fileUpload: {
    limits: { fileSize: 50 * 1024 * 1024 },
    abortOnLimit: true,
    allowedMimes: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
    ],
  },
};
