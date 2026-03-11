import { Router } from "express";
import { checkAuthenticated, checkNotAuthenticated } from "../../middleware/auth.js";
import { login, logout, register, registerSimple } from "./controller.js";

const router = Router();

router.get("/login", checkNotAuthenticated, (req, res) => {
  res.render("login.ejs");
});

router.post("/login", checkNotAuthenticated, login);

router.delete("/logout", logout);

router.get("/register", checkNotAuthenticated, (req, res) => {
  res.render("register.ejs");
});

router.post("/register", register);

router.get("/register1", checkNotAuthenticated, (req, res) => {
  res.render("register1.ejs");
});

router.post("/register1", registerSimple);

router.get("/forgot-password", checkNotAuthenticated, (req, res) => {
  res.render("forgot-password.ejs");
});

export default router;
