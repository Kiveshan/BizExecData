import { Router } from "express";
import app from "../../app.js";
import { checkNotAuthenticated } from "../../middleware/auth.js";
import { login, logout, register, registerSimple } from "./controller.js";
import { createModuleLogger } from "../../utils/logger.js";

const authLogger = createModuleLogger("auth");

const router = Router();

router.get("/login", checkNotAuthenticated, (req, res) => {
  authLogger.debug("Serving login page");
  res.render("login.ejs");
});

router.post("/login", checkNotAuthenticated, app.authLimiter, login);

router.delete("/logout", logout);

router.get("/register", checkNotAuthenticated, (req, res) => {
  authLogger.debug("Serving register page");
  res.render("register.ejs");
});

router.post("/register", register);

router.get("/register1", checkNotAuthenticated, (req, res) => {
  authLogger.debug("Serving simple register page");
  res.render("register1.ejs");
});

router.post("/register1", registerSimple);

router.get("/forgot-password", checkNotAuthenticated, (req, res) => {
  authLogger.debug("Serving forgot password page");
  res.render("forgot-password.ejs");
});

export default router;
