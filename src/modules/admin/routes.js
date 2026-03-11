import { Router } from "express";
import { checkAuthenticated } from "../../middleware/auth.js";
import { isAdmin } from "../../middleware/admin.js";
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

const router = Router();

router.get("/adminmenu", checkAuthenticated, (req, res) => {
  res.render("adminmenu.ejs");
});

router.get(
  "/adminDashboard",
  checkAuthenticated,
  isAdmin,
  getAdminDashboard
);

router.get(
  "/admin/previewUser/:userprofileid",
  checkAuthenticated,
  previewUser
);

router.post(
  "/companyregdetails/approveUser/:id",
  checkAuthenticated,
  approveUser
);

router.post(
  "/companyregdetails/rejectUser/:id",
  checkAuthenticated,
  rejectUser
);

router.get("/approved-users", getApprovedUsers);

router.get("/licensemgt", checkAuthenticated, getLicenseManagement);
router.get("/renew/:userid", renewLicense);
router.get("/deactivate/:userid", deactivateLicense);

router.get("/companyregapplications", getCompanyRegApplications);

router.get("/companyregdetails/:id", checkAuthenticated, getCompanyRegDetails);

export default router;
