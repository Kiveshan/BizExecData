import { Router } from "express";
import path from "path";
import { fileURLToPath } from "url";
import jsonpath from "jsonpath";
import { xero } from "./client.js";
import { connectDb, closeDb } from "../../config/database.js";
import {
  extractXeroSummaryData,
  extractXeroExpenses,
  extractXeroIncome,
  extractXeroCostOfSales,
  insertXeroSummaryData,
  insertExpenses,
  insertIncome,
  insertCostofSales,
  processXeroData,
  extractionStatus,
} from "./extractor.js";
import logger, { createModuleLogger } from "../../utils/logger.js";

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
  const db = await connectDb();
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

    const existingUser = await db.query(
      "SELECT * FROM user_table WHERE xero_company_id = $1",
      [companyId]
    );

    const exsistingLicense = await db.query(
      `SELECT * FROM license_management WHERE userid = $1`,
      [companyId]
    );

    if (existingUser.rows.length === 0) {
      xeroRouteLogger.info({ companyId }, "New Xero user registration");
      const result = await db.query(
        `INSERT INTO user_table (firstname, surname, xero_company_id, company_name, telephone, address, company_services, first_time_insertion, accounting_software)
         VALUES ('N/A', 'N/A', $1, $2, $3, $4, $5, $6, 'Xero') RETURNING xero_company_id`,
        [companyId, companyName, telephone, address, industryType, true]
      );

      const newUserId = result.rows[0].xero_company_id;
      const currentDate = new Date();
      await db.query(
        `INSERT INTO license_management(owner_name,company_name, status,date_submitted, userid)
        VALUES ('N/A',$1,'Pending',$2,$3)`,
        [companyName, currentDate, newUserId]
      );

      return res.redirect(
        `/index.html?message=Thank you for registering with BizTech. Please wait for our admin to approve your account.`
      );
    }

    const user = existingUser.rows[0];
    const license = exsistingLicense.rows[0];
    xeroRouteLogger.info({ userid: user.userid, status: user.status, licenseStatus: license.status }, "Existing Xero user login");

    if (
      user.status === "pending" ||
      user.status === "rejected" ||
      license.status === "Pending" ||
      license.status === "Deactivated"
    ) {
      xeroRouteLogger.warn({ userid: user.userid, userStatus: user.status, licenseStatus: license.status }, "Xero user access denied");
      return res.redirect(
        `/index.html?message=Your account is ${user.status} and your license is ${license.status}. Please contact our support team.`
      );
    }

    const isInitialExtraction = user.first_time_insertion;
    if (isInitialExtraction === false && license.status === "Paid") {
      req.session.userid = user.userid;
      xeroRouteLogger.info({ userid: user.userid }, "Xero user redirected to profit page");
      return res.redirect("/profit");
    }

    req.session.userid = user.userid;
    return res.redirect("/xerocompany");
  } catch (err) {
    xeroRouteLogger.error({ err }, "Error during Xero callback");
    res.send("Sorry, something went wrong");
  } finally {
    await closeDb(db);
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
    return res.json({ complete: true });
  }

  res.json({ complete: status });
});

router.get("/profit", async (req, res) => {
  if (!req.session.userid) {
    xeroRouteLogger.warn("Unauthorized access to profit page");
    return res.redirect("/login");
  }
  xeroRouteLogger.debug({ userid: req.session.userid }, "Redirecting to xero-loading from profit");
  res.redirect("/xero-loading");
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

router.get("/api/xerocompany", async (req, res) => {
  const db = await connectDb();
  const userid = req.session.userid;
  xeroRouteLogger.debug({ userid }, "Fetching Xero company data");

  try {
    const result = await db.query(
      "SELECT date, sumofsales, sumofcost, grossprofit FROM xero_company_calcs WHERE userid = $1 ORDER BY date",
      [userid]
    );
    const lastEntryDate = await db.query(
      `SELECT date FROM xero_company_calcs WHERE userid = $1 GROUP BY date ORDER BY date DESC LIMIT 1`,
      [userid]
    );
    xeroRouteLogger.debug({ userid, rowCount: result.rows.length }, "Xero company data fetched");
    res.json({ data: result.rows, lastEntryDate: lastEntryDate.rows[0].date });
  } catch (err) {
    xeroRouteLogger.error({ err, userid }, "Error fetching Xero company data");
    res.status(500).send("Server Error");
  } finally {
    await closeDb(db);
  }
});

router.get("/api/xeroprofit", async (req, res) => {
  const db = await connectDb();
  const userid = req.session.userid;
  xeroRouteLogger.debug({ userid }, "Fetching Xero profit data");
  try {
    const result = await db.query(
      "SELECT date, grossprofit, opexpenses, netprofit FROM xero_company_calcs WHERE userid = $1 ORDER BY date",
      [userid]
    );
    xeroRouteLogger.debug({ userid, rowCount: result.rows.length }, "Xero profit data fetched");
    res.json(result.rows);
  } catch (err) {
    xeroRouteLogger.error({ err, userid }, "Error fetching Xero profit data");
    res.status(500).send("Server Error");
  } finally {
    await closeDb(db);
  }
});

router.get("/api/xeroexpenses", async (req, res) => {
  const db = await connectDb();
  const userid = req.session.userid;
  xeroRouteLogger.debug({ userid }, "Fetching Xero expenses data");
  try {
    const result = await db.query(
      "SELECT date, amount, category FROM xero_expenses WHERE userid = $1 ORDER BY category",
      [userid]
    );
    const lastEntryDate = await db.query(
      `SELECT date FROM xero_company_calcs WHERE userid = $1 GROUP BY date ORDER BY date DESC LIMIT 1`,
      [userid]
    );
    xeroRouteLogger.debug({ userid, rowCount: result.rows.length }, "Xero expenses data fetched");
    res.json({ data: result.rows, lastEntryDate: lastEntryDate.rows[0].date });
  } catch (err) {
    xeroRouteLogger.error({ err, userid }, "Error fetching Xero expenses data");
    res.status(500).send("Server Error");
  } finally {
    await closeDb(db);
  }
});

router.get("/api/xerorevenue", async (req, res) => {
  const db = await connectDb();
  const userid = req.session.userid;
  xeroRouteLogger.debug({ userid }, "Fetching Xero revenue data");
  try {
    const result = await db.query(
      "SELECT date,category , revenue FROM xero_revenue WHERE userid = $1 ORDER BY date",
      [userid]
    );
    xeroRouteLogger.debug({ userid, rowCount: result.rows.length }, "Xero revenue data fetched");
    res.json(result.rows);
  } catch (err) {
    xeroRouteLogger.error({ err, userid }, "Error fetching Xero revenue data");
    res.status(500).send("Server Error");
  } finally {
    await closeDb(db);
  }
});

router.get("/api/xerocostofsales", async (req, res) => {
  const db = await connectDb();
  const userid = req.session.userid;
  xeroRouteLogger.debug({ userid }, "Fetching Xero cost of sales data");
  try {
    const result = await db.query(
      "SELECT date, costofsales FROM xero_costofsales WHERE userid = $1 ORDER BY date",
      [userid]
    );
    xeroRouteLogger.debug({ userid, rowCount: result.rows.length }, "Xero cost of sales data fetched");
    res.json(result.rows);
  } catch (err) {
    xeroRouteLogger.error({ err, userid }, "Error fetching Xero cost of sales data");
    res.status(500).send("Server Error");
  } finally {
    await closeDb(db);
  }
});

export default router;
