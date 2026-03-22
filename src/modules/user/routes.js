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
import { createModuleLogger } from "../../utils/logger.js";

const userRouteLogger = createModuleLogger("user-routes");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

router.get("/dashboard", checkAuthenticated, getDashboard);

router.get("/company", (req, res) => {
  userRouteLogger.debug("Serving company page");
  res.sendFile(path.join(__dirname, "..", "..", "..", "public", "company.html"));
});

router.get("/api/company", getCompanyData);
router.get("/api/profit", getProfitData);
router.get("/api/revenue", getRevenueData);
router.get("/api/costofsales", getCostOfSalesData);
router.get("/api/expenses", getExpensesData);

export default router;
