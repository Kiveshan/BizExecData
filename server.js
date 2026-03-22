import app, { __dirname, errorHandler, notFoundHandler } from "./src/app.js";
import { port } from "./src/config/env.js";
import express from "express";
import path from "path";
import logger, { createModuleLogger } from "./src/utils/logger.js";

const serverLogger = createModuleLogger("server");

// Import route modules
import authRoutes from "./src/modules/auth/routes.js";
import userRoutes from "./src/modules/user/routes.js";
import adminRoutes from "./src/modules/admin/routes.js";
import quickbooksRoutes from "./src/modules/quickbooks/routes.js";
import xeroRoutes from "./src/modules/xero/routes.js";
import excelRoutes from "./src/modules/excel/routes.js";
import sageRoutes from "./src/modules/sage/routes.js";

serverLogger.info("Starting server initialization");

serverLogger.debug("Mounting auth routes");
app.use("/", authRoutes);

serverLogger.debug("Mounting user routes");
app.use("/", userRoutes);

serverLogger.debug("Mounting admin routes");
app.use("/", adminRoutes);

serverLogger.debug("Mounting quickbooks routes");
app.use("/", quickbooksRoutes);

serverLogger.debug("Mounting xero routes");
app.use("/", xeroRoutes);

serverLogger.debug("Mounting excel routes");
app.use("/", excelRoutes);

serverLogger.debug("Mounting sage routes");
app.use("/", sageRoutes);

serverLogger.info("All routes mounted successfully");

app.get("/", (req, res) => {
  serverLogger.debug({ path: "/" }, "Serving home page");
  res.render("index");
});

app.get(["/index", "/index.html"], (req, res) => {
  serverLogger.debug({ path: req.path }, "Redirecting legacy index route");
  const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
  res.redirect(301, `/${query}`);
});

app.get("/company.html", (req, res) => {
  serverLogger.debug({ path: req.path }, "Redirecting legacy company route");
  const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
  res.redirect(301, `/company${query}`);
});

app.get("/revenue.html", (req, res) => {
  serverLogger.debug({ path: req.path }, "Redirecting legacy revenue route");
  const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
  res.redirect(301, `/revenue${query}`);
});

app.get("/expenses.html", (req, res) => {
  serverLogger.debug({ path: req.path }, "Redirecting legacy expenses route");
  const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
  res.redirect(301, `/expenses${query}`);
});

app.get("/xerocompany.html", (req, res) => {
  serverLogger.debug({ path: req.path }, "Redirecting legacy xerocompany route");
  const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
  res.redirect(301, `/xerocompany${query}`);
});

app.get("/xerorevenue.html", (req, res) => {
  serverLogger.debug({ path: req.path }, "Redirecting legacy xerorevenue route");
  const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
  res.redirect(301, `/xerorevenue${query}`);
});

app.get("/xeroexpenses.html", (req, res) => {
  serverLogger.debug({ path: req.path }, "Redirecting legacy xeroexpenses route");
  const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
  res.redirect(301, `/xeroexpenses${query}`);
});

// Static file serving (assets). Mounted after routes so dynamic routes take precedence.
app.use(express.static("public"));

app.get(["/excompany.html"], (req, res) => {
  serverLogger.debug({ path: req.path }, "Redirecting legacy excompany route");
  const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
  res.redirect(301, `/excompany${query}`);
});

app.get(["/excost.html"], (req, res) => {
  serverLogger.debug({ path: req.path }, "Redirecting legacy excost route");
  const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
  res.redirect(301, `/excost${query}`);
});

app.get(["/exincome.html", "/exincomes.html"], (req, res) => {
  serverLogger.debug({ path: req.path }, "Redirecting legacy exincome route");
  const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
  res.redirect(301, `/exincome${query}`);
});

app.get(["/exexpenses.html"], (req, res) => {
  serverLogger.debug({ path: req.path }, "Redirecting legacy exexpenses route");
  const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
  res.redirect(301, `/exexpenses${query}`);
});

// Error handling middleware - must be last, after all routes
app.use(notFoundHandler);
app.use(errorHandler);

// Start the server
app.listen(port, () => {
  serverLogger.info({ port, env: process.env.NODE_ENV || "production" }, "Server started successfully");
});
