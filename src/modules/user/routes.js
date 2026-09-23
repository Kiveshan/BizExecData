import { Router } from "express";
import { checkAuthenticated, requireApiAuth } from "../../middleware/auth.js";
import {
  getDashboard,
  getCompanyData,
  getProfitData,
  getRevenueData,
  getCostOfSalesData,
  getExpensesData,
} from "./controller.js";
import { createModuleLogger } from "../../utils/logger.js";

const userRouteLogger = createModuleLogger("user-routes");

const router = Router();

router.get("/dashboard", checkAuthenticated, getDashboard);

router.get("/company", checkAuthenticated, (req, res) => {
  userRouteLogger.debug("Serving company page");
  res.render("company");
});

router.get("/revenue", checkAuthenticated, (req, res) => {
  userRouteLogger.debug("Serving revenue page");
  res.render("revenue");
});

router.get("/expenses", checkAuthenticated, (req, res) => {
  userRouteLogger.debug("Serving expenses page");
  res.render("expenses");
});

router.get("/api/company", requireApiAuth, getCompanyData);
router.get("/api/profit", requireApiAuth, getProfitData);
router.get("/api/revenue", requireApiAuth, getRevenueData);
router.get("/api/costofsales", requireApiAuth, getCostOfSalesData);
router.get("/api/expenses", requireApiAuth, getExpensesData);

export default router;
