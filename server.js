import app, { __dirname, errorHandler, notFoundHandler } from "./src/app.js";
import { port } from "./src/config/env.js";
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

app.get("/index", (req, res) => {
  serverLogger.debug({ path: "/index" }, "Serving static file");
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.get("/revenue", (req, res) => {
  serverLogger.debug({ path: "/revenue" }, "Serving static file");
  res.sendFile(path.join(__dirname, "..", "public", "revenue.html"));
});

app.get("/incomes", (req, res) => {
  serverLogger.debug({ path: "/incomes" }, "Serving static file");
  res.sendFile(path.join(__dirname, "..", "public", "incomes.html"));
});

app.get("/expenses", (req, res) => {
  serverLogger.debug({ path: "/expenses" }, "Serving static file");
  res.sendFile(path.join(__dirname, "..", "public", "expenses.html"));
});

app.get("/exexpenses.html", (req, res) => {
  serverLogger.debug({ path: "/exexpenses.html" }, "Serving static file");
  res.sendFile(path.join(__dirname, "..", "public", "exexpenses.html"));
});

app.get("/excompany.html", (req, res) => {
  serverLogger.debug({ path: "/excompany.html" }, "Serving static file");
  res.sendFile(path.join(__dirname, "..", "public", "excompany.html"));
});

app.get("/excost.html", (req, res) => {
  serverLogger.debug({ path: "/excost.html" }, "Serving static file");
  res.sendFile(path.join(__dirname, "..", "public", "excost.html"));
});

app.get("/exincomes.html", (req, res) => {
  serverLogger.debug({ path: "/exincomes.html" }, "Serving static file");
  res.sendFile(path.join(__dirname, "..", "public", "exincome.html"));
});

// Error handling middleware - must be last, after all routes
app.use(notFoundHandler);
app.use(errorHandler);

// Start the server
app.listen(port, () => {
  serverLogger.info({ port, env: process.env.NODE_ENV || "production" }, "Server started successfully");
});
