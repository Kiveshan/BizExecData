import { Router } from "express";
import { checkAuthenticated, checkAdmin } from "../../middleware/auth.js";
import {
  getAdminDashboard,
  previewUser,
  approveUser,
  rejectUser,
  getApprovedUsers,
  getLicenseManagement,
  renewLicense,
  deactivateLicense,
  getCompanyRegApplications,
  getCompanyRegDetails,
} from "./controller.js";
import logger, { createModuleLogger } from "../../utils/logger.js";

const adminRouteLogger = createModuleLogger("admin-routes");

const router = Router();

router.get("/adminmenu", checkAuthenticated, (req, res) => {
  adminRouteLogger.debug({ userid: req.session?.userid }, "Serving admin menu");
  res.render("adminmenu.ejs");
});

router.get(
  "/adminDashboard",
  checkAuthenticated,
  checkAdmin,
  getAdminDashboard
);

router.get(
  "/admin/previewUser/:userprofileid",
  checkAuthenticated,
  checkAdmin,
  previewUser
);

router.post(
  "/companyregdetails/approveUser/:id",
  checkAuthenticated,
  checkAdmin,
  approveUser
);

router.post(
  "/companyregdetails/rejectUser/:id",
  checkAuthenticated,
  checkAdmin,
  rejectUser
);

router.get("/approved-users", checkAuthenticated, checkAdmin, getApprovedUsers);

router.get("/licensemgt", checkAuthenticated, checkAdmin, getLicenseManagement);
router.get("/renew/:userid", checkAuthenticated, checkAdmin, renewLicense);
router.get("/deactivate/:userid", checkAuthenticated, checkAdmin, deactivateLicense);

router.get("/companyregapplications", checkAuthenticated, checkAdmin, getCompanyRegApplications);

router.get("/companyregdetails/:id", checkAuthenticated, checkAdmin, getCompanyRegDetails);

export default router;
