import { Router } from "express";
import path from "path";
import { fileURLToPath } from "url";
import jsonpath from "jsonpath";
import { xero } from "./client.js";
import { getPrismaClient } from "../../config/prismaClient.js";
import {
  processXeroData,
  extractionStatus,
} from "./extractor.js";
import { createModuleLogger } from "../../utils/logger.js";

const xeroRouteLogger = createModuleLogger("xero-routes");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

router.get("/xero-connect", async (req, res) => {
  try {
    xeroRouteLogger.debug("Initiating Xero OAuth flow");
    delete req.session.tokenSet;
    const consentUrl = await xero.buildConsentUrl();
    xeroRouteLogger.debug({ consentUrl }, "Xero consent URL generated");
    res.redirect(consentUrl);
  } catch (err) {
    xeroRouteLogger.error({ err }, "Error during Xero connect");
    res.send("Sorry, something went wrong");
  }
});

router.get("/auth/xero/callback", async (req, res) => {
  const prisma = getPrismaClient();
  xeroRouteLogger.info("Xero OAuth callback received");
  try {
    const tokenSet = await xero.apiCallback(req.url);
    await xero.updateTenants();
    xeroRouteLogger.debug("Xero tokens and tenants updated");

    const decodedIdToken = tokenSet.id_token;
    const decodedAccessToken = tokenSet.access_token;

    req.session.decodedIdToken = decodedIdToken;
    req.session.decodedAccessToken = decodedAccessToken;
    req.session.tokenSet = tokenSet;
    req.session.allTenants = xero.tenants;
    req.session.activeTenant = xero.tenants[0];

    const tenantInfo = req.session.activeTenant;

    const companyName = jsonpath.query(tenantInfo, "$.tenantName")[0] || "";
    const companyId =
      jsonpath.query(tenantInfo, "$.orgData.organisationID")[0] || "";
    const address =
      jsonpath.query(tenantInfo, "$.orgData.addresses[0].addressLine1")[0] ||
      "";
    const industryType =
      jsonpath.query(tenantInfo, "$.orgData.organisationType")[0] || "";
    const phoneAreaCode =
      jsonpath.query(tenantInfo, "$.orgData.phones[0].phoneAreaCode")[0] || "";
    const phoneNumber =
      jsonpath.query(tenantInfo, "$.orgData.phones[0].phoneNumber")[0] || "";
    const telephone = `${phoneAreaCode} ${phoneNumber}`.trim();

    xeroRouteLogger.info({ companyId, companyName }, "Xero company info extracted");

    const existingUser = await prisma.user_table.findFirst({
      where: { xero_company_id: companyId || null },
    });

    const exsistingLicense = await prisma.license_management.findFirst({
      where: { userid: String(companyId) },
    });

    if (!existingUser) {
      xeroRouteLogger.info({ companyId }, "New Xero user registration");
      const currentDate = new Date();

      await prisma.user_table.create({
        data: {
          firstname: "N/A",
          surname: "N/A",
          xero_company_id: companyId || null,
          company_name: companyName,
          telephone,
          address,
          company_services: industryType,
          first_time_insertion: true,
          accounting_software: "Xero",
        },
      });

      await prisma.license_management.create({
        data: {
          owner_name: "N/A",
          company_name: companyName,
          status: "Pending",
          date_submitted: currentDate,
          userid: String(companyId),
        },
      });

      return res.redirect(
        `/index.html?message=Thank you for registering with BizTech. Please wait for our admin to approve your account.`
      );
    }

    const user = existingUser;
    const license = exsistingLicense;
    xeroRouteLogger.info({ userid: user.userid, status: user.status, licenseStatus: license?.status }, "Existing Xero user login");

    if (
      user.status === "pending" ||
      user.status === "rejected" ||
      license?.status === "Pending" ||
      license?.status === "Deactivated"
    ) {
      xeroRouteLogger.warn({ userid: user.userid, userStatus: user.status, licenseStatus: license?.status }, "Xero user access denied");
      return res.redirect(
        `/index.html?message=Your account is ${user.status} and your license is ${license?.status}. Please contact our support team.`
      );
    }

    const isInitialExtraction = user.first_time_insertion;
    if (isInitialExtraction === true && license?.status === "Paid") {
      req.session.userid = user.userid;
      xeroRouteLogger.info({ userid: user.userid }, "Xero user with first_time_insertion=true redirected to profit page for data extraction");
      req.session.save((err) => {
        if (err) {
          xeroRouteLogger.error({ err, userid: user.userid }, "Failed to save session before redirect");
          return res.status(500).send("Session error");
        }
        res.redirect("/profit");
      });
      return;
    }

    if (isInitialExtraction === false && license?.status === "Paid") {
      req.session.userid = user.userid;
      xeroRouteLogger.info({ userid: user.userid }, "Xero user redirected to profit page");
      req.session.save((err) => {
        if (err) {
          xeroRouteLogger.error({ err, userid: user.userid }, "Failed to save session before redirect");
          return res.status(500).send("Session error");
        }
        res.redirect("/profit");
      });
      return;
    }

    req.session.userid = user.userid;
    req.session.save((err) => {
      if (err) {
        xeroRouteLogger.error({ err, userid: user.userid }, "Failed to save session before redirect");
        return res.status(500).send("Session error");
      }
      res.redirect("/xerocompany");
    });
  } catch (err) {
    xeroRouteLogger.error({ err }, "Error during Xero callback");
    res.send("Sorry, something went wrong");
  }
});

router.get("/xero-loading", async (req, res) => {
  if (!req.session.userid) {
    xeroRouteLogger.warn("Unauthorized access to xero-loading page");
    return res.redirect("/login");
  }
  xeroRouteLogger.debug({ userid: req.session.userid }, "Serving Xero loading page");
  res.render("profit-loss-loading", {
    source: "xero",
    title: "Extracting Xero Data",
    description: "We're extracting your profit and loss data from Xero.",
  });
});

router.post("/start-xero-extraction", async (req, res) => {
  try {
    if (!req.session.userid) {
      xeroRouteLogger.warn("Unauthorized Xero extraction attempt");
      return res.status(401).json({
        success: false,
        error: "Not authenticated",
      });
    }

    const userid = req.session.userid;
    xeroRouteLogger.info({ userid }, "Starting Xero data extraction");
    extractionStatus.xero[userid] = false;
    processXeroData(userid);

    res.json({
      success: true,
      message: "Data extraction started",
    });
  } catch (error) {
    xeroRouteLogger.error({ error }, "Error starting Xero extraction");
    res.status(500).json({
      success: false,
      error: "Failed to start Xero extraction: " + error.message,
    });
  }
});

router.get("/check-xero-extraction", (req, res) => {
  if (!req.session.userid) {
    xeroRouteLogger.warn("Unauthorized check-xero-extraction request");
    return res.status(401).json({
      complete: false,
      error: "Not authenticated",
    });
  }

  const userid = req.session.userid;
  const status = extractionStatus.xero[userid];
  xeroRouteLogger.debug({ userid, status }, "Xero extraction status checked");

  if (status === undefined) {
    return res.json({ complete: true, progress: 100 });
  }

  if (typeof status === 'object') {
    return res.json({ complete: status.complete, progress: status.progress, total: status.total });
  }

  res.json({ complete: status, progress: status ? 100 : 0 });
});

router.get("/profit", async (req, res) => {
  if (!req.session.userid) {
    xeroRouteLogger.warn("Unauthorized access to profit page");
    return res.redirect("/login");
  }
  const prisma = getPrismaClient();
  const user = await prisma.user_table.findUnique({
    where: { userid: req.session.userid },
    select: { first_time_insertion: true },
  });
  
  if (user?.first_time_insertion === true) {
    xeroRouteLogger.debug({ userid: req.session.userid }, "Redirecting to xero-loading from profit for first-time extraction");
    return res.redirect("/xero-loading");
  }
  
  xeroRouteLogger.debug({ userid: req.session.userid }, "Redirecting to xerocompany from profit");
  res.redirect("/xerocompany");
});

router.get("/update_xerodashboard", async (req, res) => {
  if (!req.session.userid) {
    xeroRouteLogger.warn("Unauthorized access to update_xerodashboard");
    return res.redirect("/login");
  }
  xeroRouteLogger.debug({ userid: req.session.userid }, "Redirecting to xero-loading from update_xerodashboard");
  res.redirect("/xero-loading");
});

router.get("/xerocompany", (req, res) => {
  xeroRouteLogger.debug("Serving xerocompany page");
  res.sendFile(path.join(__dirname, "..", "..", "..", "public", "xerocompany.html"));
});

router.get("/xerorevenue", (req, res) => {
  xeroRouteLogger.debug("Serving xerorevenue page");
  res.sendFile(path.join(__dirname, "..", "..", "..", "public", "xerorevenue.html"));
});

router.get("/xeroexpenses", (req, res) => {
  xeroRouteLogger.debug("Serving xeroexpenses page");
  res.sendFile(path.join(__dirname, "..", "..", "..", "public", "xeroexpenses.html"));
});

router.get("/api/xerocompany", async (req, res) => {
  const prisma = getPrismaClient();
  const userid = req.session.userid;
  xeroRouteLogger.debug({ userid }, "Fetching Xero company data");

  try {
    const data = await prisma.xero_company_calcs.findMany({
      where: { userid },
      select: { date: true, sumofsales: true, sumofcost: true, grossprofit: true },
      orderBy: { date: "asc" },
    });
    const lastEntryDate = await prisma.xero_company_calcs.findFirst({
      where: { userid },
      select: { date: true },
      orderBy: { date: "desc" },
    });
    xeroRouteLogger.debug({ userid, rowCount: data.length }, "Xero company data fetched");
    res.json({ data, lastEntryDate: lastEntryDate?.date });
  } catch (err) {
    xeroRouteLogger.error({ err, userid }, "Error fetching Xero company data");
    res.status(500).send("Server Error");
  }
});

router.get("/api/xeroprofit", async (req, res) => {
  const prisma = getPrismaClient();
  const userid = req.session.userid;
  xeroRouteLogger.debug({ userid }, "Fetching Xero profit data");
  try {
    const data = await prisma.xero_company_calcs.findMany({
      where: { userid },
      select: { date: true, grossprofit: true, opexpenses: true, netprofit: true },
      orderBy: { date: "asc" },
    });
    xeroRouteLogger.debug({ userid, rowCount: data.length }, "Xero profit data fetched");
    res.json(data);
  } catch (err) {
    xeroRouteLogger.error({ err, userid }, "Error fetching Xero profit data");
    res.status(500).send("Server Error");
  }
});

router.get("/api/xeroexpenses", async (req, res) => {
  const prisma = getPrismaClient();
  const userid = req.session.userid;
  xeroRouteLogger.debug({ userid }, "Fetching Xero expenses data");
  try {
    const data = await prisma.xero_expenses.findMany({
      where: { userid },
      select: { date: true, amount: true, category: true },
      orderBy: { category: "asc" },
    });
    const lastEntryDate = await prisma.xero_company_calcs.findFirst({
      where: { userid },
      select: { date: true },
      orderBy: { date: "desc" },
    });
    xeroRouteLogger.debug({ userid, rowCount: data.length }, "Xero expenses data fetched");
    res.json({ data, lastEntryDate: lastEntryDate?.date });
  } catch (err) {
    xeroRouteLogger.error({ err, userid }, "Error fetching Xero expenses data");
    res.status(500).send("Server Error");
  }
});

router.get("/api/xerorevenue", async (req, res) => {
  const prisma = getPrismaClient();
  const userid = req.session.userid;
  xeroRouteLogger.debug({ userid }, "Fetching Xero revenue data");
  try {
    const data = await prisma.xero_revenue.findMany({
      where: { userid },
      select: { date: true, category: true, revenue: true },
      orderBy: { date: "asc" },
    });
    xeroRouteLogger.debug({ userid, rowCount: data.length }, "Xero revenue data fetched");
    res.json(data);
  } catch (err) {
    xeroRouteLogger.error({ err, userid }, "Error fetching Xero revenue data");
    res.status(500).send("Server Error");
  }
});

router.get("/api/xerocostofsales", async (req, res) => {
  const prisma = getPrismaClient();
  const userid = req.session.userid;
  xeroRouteLogger.debug({ userid }, "Fetching Xero cost of sales data");
  try {
    const data = await prisma.xero_costofsales.findMany({
      where: { userid },
      select: { date: true, costofsales: true },
      orderBy: { date: "asc" },
    });
    xeroRouteLogger.debug({ userid, rowCount: data.length }, "Xero cost of sales data fetched");
    res.json(data);
  } catch (err) {
    xeroRouteLogger.error({ err, userid }, "Error fetching Xero cost of sales data");
    res.status(500).send("Server Error");
  }
});

export default router;
