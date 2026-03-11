import { Router } from "express";
import { checkAuthenticated } from "../../middleware/auth.js";
import {
  getDashboard,
  getCompanyData,
  getProfitData,
  getRevenueData,
  getCostOfSalesData,
  getExpensesData,
} from "./controller.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

router.get("/dashboard", checkAuthenticated, getDashboard);

router.get("/StudentDashboard", checkAuthenticated, (req, res) => {
  res.render("newstudentdash.ejs");
});

router.get("/company", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "..", "..", "public", "company.html"));
});

router.get("/api/company", getCompanyData);
router.get("/api/profit", getProfitData);
router.get("/api/revenue", getRevenueData);
router.get("/api/costofsales", getCostOfSalesData);
router.get("/api/expenses", getExpensesData);

export default router;
