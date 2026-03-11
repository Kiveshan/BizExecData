import app, { __dirname } from "./src/app.js";
import { port } from "./src/config/env.js";
import path from "path";

// Import route modules
import authRoutes from "./src/modules/auth/routes.js";
import userRoutes from "./src/modules/user/routes.js";
import adminRoutes from "./src/modules/admin/routes.js";
import quickbooksRoutes from "./src/modules/quickbooks/routes.js";
import xeroRoutes from "./src/modules/xero/routes.js";
import excelRoutes from "./src/modules/excel/routes.js";
import sageRoutes from "./src/modules/sage/routes.js";

// Mount routes
app.use("/", authRoutes);
app.use("/", userRoutes);
app.use("/", adminRoutes);
app.use("/", quickbooksRoutes);
app.use("/", xeroRoutes);
app.use("/", excelRoutes);
app.use("/", sageRoutes);

// Static file routes
app.get("/index", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.get("/revenue", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "revenue.html"));
});

app.get("/incomes", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "incomes.html"));
});

app.get("/expenses", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "expenses.html"));
});

app.get("/exexpenses.html", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "exexpenses.html"));
});

app.get("/excompany.html", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "excompany.html"));
});

app.get("/excost.html", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "excost.html"));
});

app.get("/exincomes.html", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "exincome.html"));
});

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
