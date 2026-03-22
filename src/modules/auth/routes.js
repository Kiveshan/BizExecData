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



export default router;
