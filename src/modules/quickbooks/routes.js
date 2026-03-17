import { Router } from "express";
import path from "path";
import { fileURLToPath } from "url";
import jsonpath from "jsonpath";
import OAuthClient from "intuit-oauth";
import { oauthClient, oauth2_token_json, authurl, setOAuthToken } from "./client.js";
import { connectDb, closeDb } from "../../config/database.js";
import {
  fetchProfitAndLoss,
  findFinancialData,
  upsertRevenue,
  upsertCOGS,
  upsertExpenses,
  processQuickBooksData,
  extractionStatus,
} from "./extractor.js";
import { formatDate } from "../../utils/file.js";
import logger, { createModuleLogger } from "../../utils/logger.js";

const qbRouteLogger = createModuleLogger("quickbooks-routes");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

router.get("/auth", (req, res) => {
  qbRouteLogger.debug("Initiating QuickBooks OAuth flow");
  const authUri = oauthClient.authorizeUri({
    scope: [OAuthClient.scopes.Accounting],
    state: "testState",
  });
  qbRouteLogger.debug({ authUri }, "QuickBooks auth URI generated");
  res.redirect(authUri);
});

router.get(authurl, async (req, res) => {
  const date = new Date();
  const db = await connectDb();
  try {
    await oauthClient.createToken(req.url).then((authResponse) => {
      setOAuthToken(JSON.stringify(authResponse.json, null, 2));
    });
    const companyID = oauthClient.getToken().realmId;

    const authResponse = await oauthClient.makeApiCall({
      url: `https://sandbox-quickbooks.api.intuit.com/v3/company/${companyID}/query?query=select * from CompanyInfo&minorversion=75`,
    });

    const companyInfo = authResponse.json.QueryResponse.CompanyInfo[0];
    const companyName = companyInfo.CompanyName || companyInfo.LegalName;
    const email = companyInfo.Email?.Address || "";
    const phone = companyInfo.PrimaryPhone?.FreeFormNumber || "";
    const address = `${companyInfo.CompanyAddr?.Line1}, ${companyInfo.CompanyAddr?.City}, ${companyInfo.CompanyAddr?.CountrySubDivisionCode}, ${companyInfo.CompanyAddr?.PostalCode}`;
    const industryType =
      companyInfo.NameValue.find((nv) => nv.Name === "QBOIndustryType")?.Value ||
      "";

    qbRouteLogger.info({ companyID, companyName, email }, "QuickBooks OAuth callback - company info extracted");

    const existingUser = await db.query(
      "SELECT * FROM user_table WHERE company_id = $1",
      [companyID]
    );

    const exsistingLicense = await db.query(
      `SELECT * FROM license_management WHERE userid = $1 `,
      [companyID]
    );

    if (existingUser.rows.length === 0) {
      qbRouteLogger.info({ companyID }, "New QuickBooks user registration");
      const result = await db.query(
        `INSERT INTO user_table (firstname, surname, company_id, company_name, email, address, company_services, first_time_insertion, accounting_software)
         VALUES ('N/A', 'N/A', $1, $2, $3, $4, $5, $6, 'Quickbooks')
         RETURNING company_id`,
        [companyID, companyName, email, address, industryType, true]
      );

      const newUserId = result.rows[0].company_id;
      const currentDate = new Date();

      await db.query(
        `INSERT INTO license_management (owner_name, company_name, status, date_submitted, userid)
        VALUES ('N/A', $1, 'Pending', $2, $3)`,
        [companyName, currentDate, newUserId]
      );

      return res.redirect(
        `/index.html?message=Thank you for registering with BizTech, Please wait for our admin to approve your account`
      );
    }
    if (
      existingUser.rows[0].status === "pending" ||
      existingUser.rows[0].status === "rejected" ||
      exsistingLicense.rows[0].status === "Pending" ||
      exsistingLicense.rows[0].status === "Deactivated"
    ) {
      qbRouteLogger.warn({ userid: existingUser.rows[0].userid, status: existingUser.rows[0].status }, "QuickBooks user access denied");
      return res.redirect(
        `/index.html?message=Your account is ${existingUser.rows[0].status} and your License is ${exsistingLicense.rows[0].status}. Please contact our support team.`
      );
    }

    if (
      existingUser.rows[0].status === "approved" &&
      existingUser.rows[0].first_time_insertion === true &&
      exsistingLicense.rows[0].status === "Paid"
    ) {
      req.session.userid = existingUser.rows[0].userid;
      qbRouteLogger.info({ userid: existingUser.rows[0].userid }, "QuickBooks user redirected to loading");
      res.redirect(`/quickbooks-loading`);
    } else {
      req.session.userid = existingUser.rows[0].userid;
      qbRouteLogger.info({ userid: existingUser.rows[0].userid }, "QuickBooks user redirected to company");
      res.redirect("/company");
    }
  } catch (err) {
    qbRouteLogger.error({ err }, "Error during QuickBooks OAuth callback");
    res.status(500).send("Error occurred while fetching company data.");
  } finally {
    await closeDb(db);
  }
});

router.get("/update", async (req, res) => {
  const userid = req.session.userid;
  const companyID = oauthClient.getToken().realmId;
  const currentDate = new Date();
  const oneYearAgo = currentDate.getFullYear() - 1;
  const startDate = `${oneYearAgo}-${currentDate.getMonth() + 1}-01`;
  let date = new Date(startDate);

  const db = await connectDb();
  qbRouteLogger.info({ userid, companyID, startDate }, "QuickBooks update process started");

  while (date <= currentDate) {
    const startOfMonth = formatDate(date);
    const endOfMonthDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const endOfMonth = formatDate(endOfMonthDate);

    let obj = {};

    function logSpecificSummaryValue(rows, index) {
      if (!rows) return;
      rows.forEach((row) => {
        if (row.Summary) {
          const specificValue = row.Summary.ColData[index]?.value || 0;
          obj[row.Summary.ColData[0].value] = specificValue;
        }
        if (row.Rows && row.Rows.Row) {
          logSpecificSummaryValue(row.Rows.Row, index);
        }
      });
    }

    try {
      const authResponse = await oauthClient.makeApiCall({
        url: `https://sandbox-quickbooks.api.intuit.com/v3/company/${companyID}/reports/ProfitAndLossDetail?start_date=${startOfMonth}&end_date=${endOfMonth}`,
      });
      const reportData = authResponse.json;

      if (!reportData.Rows || !reportData.Rows.Row) {
        date.setMonth(date.getMonth() + 1);
        continue;
      }

      const specificIndex = 6;
      logSpecificSummaryValue(reportData.Rows.Row, specificIndex);

      const Expense =
        (parseFloat(obj["Total for Expenses"]) || 0) +
        (parseFloat(obj["Total for Other Expense"]) || 0);
      const Income =
        (parseFloat(obj["Total for Income"]) || 0) +
        (parseFloat(obj["Total for Other Income"]) || 0);
      const grossProfit = parseFloat(obj["Gross Profit"]) || 0;
      const netIncome = parseFloat(obj["Net Income"]) || 0;
      const costOfGoodsSold =
        parseFloat(obj["Total for Cost of Goods Sold"]) || 0;

      const duplicateCheckQuery = `
        SELECT * FROM company_calcs 
        WHERE userid = $1 AND date = $2
      `;
      const duplicateCheckResult = await db.query(duplicateCheckQuery, [
        userid,
        endOfMonth,
      ]);

      if (duplicateCheckResult.rowCount > 0) {
        const updateQuery = `
          UPDATE company_calcs 
          SET grossprofit = $1, opexpenses = $2, netprofit = $3, sumofsales = $4, sumofcost = $5
          WHERE userid = $6 AND date = $7
        `;
        const updateValues = [
          grossProfit.toFixed(2),
          Expense.toFixed(2),
          netIncome.toFixed(2),
          Income.toFixed(2),
          costOfGoodsSold.toFixed(2),
          userid,
          endOfMonth,
        ];
        await db.query(updateQuery, updateValues);
      } else {
        const insertQuery = `
          INSERT INTO company_calcs (
            userid, grossprofit, opexpenses, netprofit, sumofsales, sumofcost, date
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `;
        const insertValues = [
          userid,
          grossProfit.toFixed(2),
          Expense.toFixed(2),
          netIncome.toFixed(2),
          Income.toFixed(2),
          costOfGoodsSold.toFixed(2),
          endOfMonth,
        ];
        await db.query(insertQuery, insertValues);
      }
    } catch (e) {
      qbRouteLogger.error({ error: e, startOfMonth }, "Error processing QuickBooks data for month");
    }

    date.setMonth(date.getMonth() + 1);
  }

  await closeDb(db);
  qbRouteLogger.info({ userid }, "QuickBooks update process completed");
  res.redirect("/fetch-income");
});

router.get("/fetch-income", async (req, res) => {
  const companyID = oauthClient.getToken().realmId;
  const userid = req.session.userid;
  const startDate = "2024-01-01";
  const currentDate = new Date();
  let date = new Date(startDate);

  qbRouteLogger.info({ userid, companyID }, "Fetching income data from QuickBooks");

  while (date <= currentDate) {
    const startOfMonth = formatDate(date);
    const endOfMonthDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const endOfMonth = formatDate(endOfMonthDate);

    try {
      const data = await fetchProfitAndLoss(companyID, startOfMonth, endOfMonth);
      const incomeRows = jsonpath.query(
        data,
        '$.Rows.Row[?(@.group == "Income")]'
      );
      await findFinancialData(incomeRows, userid, endOfMonth, upsertRevenue);
    } catch (err) {
      qbRouteLogger.error({ err, startOfMonth }, "Error extracting income data from QuickBooks");
      res.status(500).send("Error occurred while extracting and storing data.");
      return;
    }

    date.setMonth(date.getMonth() + 1);
  }

  qbRouteLogger.info({ userid }, "Income data fetch completed");
  res.redirect("/fetch-cost");
});

router.get("/fetch-cost", async (req, res) => {
  const companyID = oauthClient.getToken().realmId;
  const userid = req.session.userid;
  const startDate = "2024-01-01";
  const currentDate = new Date();
  let date = new Date(startDate);

  qbRouteLogger.info({ userid, companyID }, "Fetching cost data from QuickBooks");

  while (date <= currentDate) {
    const startOfMonth = formatDate(date);
    const endOfMonthDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const endOfMonth = formatDate(endOfMonthDate);

    try {
      const data = await fetchProfitAndLoss(companyID, startOfMonth, endOfMonth);
      const incomeRows = jsonpath.query(
        data,
        '$.Rows.Row[?(@.group == "COGS")]'
      );
      await findFinancialData(incomeRows, userid, endOfMonth, upsertCOGS);
    } catch (err) {
      qbRouteLogger.error({ err, startOfMonth }, "Error extracting cost data from QuickBooks");
      res.status(500).send("Error occurred while extracting and storing data.");
      return;
    }

    date.setMonth(date.getMonth() + 1);
  }

  qbRouteLogger.info({ userid }, "Cost data fetch completed");
  res.redirect("/fetch-expenses");
});

router.get("/fetch-expenses", async (req, res) => {
  const companyID = oauthClient.getToken().realmId;
  const userid = req.session.userid;
  const startDate = "2024-01-01";
  const currentDate = new Date();
  let date = new Date(startDate);

  qbRouteLogger.info({ userid, companyID }, "Fetching expenses data from QuickBooks");

  while (date <= currentDate) {
    const startOfMonth = formatDate(date);
    const endOfMonthDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const endOfMonth = formatDate(endOfMonthDate);

    try {
      const data = await fetchProfitAndLoss(companyID, startOfMonth, endOfMonth);
      const incomeRows = jsonpath.query(
        data,
        '$.Rows.Row[?(@.group == "Expenses")]'
      );
      await findFinancialData(incomeRows, userid, endOfMonth, upsertExpenses);
    } catch (err) {
      qbRouteLogger.error({ err, startOfMonth }, "Error extracting expenses data from QuickBooks");
      res.status(500).send("Error occurred while extracting and storing data.");
      return;
    }

    date.setMonth(date.getMonth() + 1);
  }

  qbRouteLogger.info({ userid }, "Expenses data fetch completed");
  res.redirect("/fetch-otherexpenses");
});

router.get("/fetch-otherexpenses", async (req, res) => {
  const companyID = oauthClient.getToken().realmId;
  const userid = req.session.userid;
  const startDate = "2024-01-01";
  const currentDate = new Date();
  let date = new Date(startDate);

  qbRouteLogger.info({ userid, companyID }, "Fetching other expenses data from QuickBooks");

  while (date <= currentDate) {
    const startOfMonth = formatDate(date);
    const endOfMonthDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const endOfMonth = formatDate(endOfMonthDate);

    try {
      const data = await fetchProfitAndLoss(companyID, startOfMonth, endOfMonth);
      const incomeRows = jsonpath.query(
        data,
        '$.Rows.Row[?(@.group == "OtherExpenses")]'
      );
      await findFinancialData(incomeRows, userid, endOfMonth, upsertExpenses);
    } catch (err) {
      qbRouteLogger.error({ err, startOfMonth }, "Error extracting other expenses data from QuickBooks");
      res.status(500).send("Error occurred while extracting and storing data.");
      return;
    }

    date.setMonth(date.getMonth() + 1);
  }

  qbRouteLogger.info({ userid }, "Other expenses data fetch completed");
  res.redirect("/fetch-otherincome");
});

router.get("/fetch-otherincome", async (req, res) => {
  const companyID = oauthClient.getToken().realmId;
  const userid = req.session.userid;
  const startDate = "2024-01-01";
  const currentDate = new Date();
  let date = new Date(startDate);
  const db = await connectDb();

  qbRouteLogger.info({ userid, companyID }, "Fetching other income data from QuickBooks");

  while (date <= currentDate) {
    const startOfMonth = formatDate(date);
    const endOfMonthDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const endOfMonth = formatDate(endOfMonthDate);

    try {
      const data = await fetchProfitAndLoss(companyID, startOfMonth, endOfMonth);
      const incomeRows = jsonpath.query(
        data,
        '$.Rows.Row[?(@.group == "OtherIncome")]'
      );
      await findFinancialData(incomeRows, userid, endOfMonth, upsertRevenue);
    } catch (err) {
      qbRouteLogger.error({ err, startOfMonth }, "Error extracting other income data from QuickBooks");
      res.status(500).send("Error occurred while extracting and storing data.");
      return;
    }

    date.setMonth(date.getMonth() + 1);
  }
  await db.query(
    "UPDATE user_table SET first_time_insertion = false WHERE userid = $1",
    [userid]
  );
  qbRouteLogger.info({ userid }, "QuickBooks initial extraction completed, first_time_insertion set to false");
  await closeDb(db);
  res.redirect("/company");
});

router.get("/quickbooks-loading", (req, res) => {
  if (!req.session.userid) {
    qbRouteLogger.warn("Unauthorized access to quickbooks-loading page");
    return res.redirect("/login");
  }
  qbRouteLogger.debug({ userid: req.session.userid }, "Serving QuickBooks loading page");
  res.render("profit-loss-loading", {
    source: "quickbooks",
    title: "Extracting QuickBooks Data",
    description: "We're extracting your profit and loss data from QuickBooks.",
  });
});

router.post("/start-quickbooks-extraction", async (req, res) => {
  try {
    if (!req.session.userid) {
      qbRouteLogger.warn("Unauthorized QuickBooks extraction attempt");
      return res.status(401).json({
        success: false,
        error: "Not authenticated",
      });
    }

    const userid = req.session.userid;
    qbRouteLogger.info({ userid }, "Starting QuickBooks data extraction");
    extractionStatus.quickbooks[userid] = false;
    processQuickBooksData(userid);

    res.json({
      success: true,
      message: "Data extraction started",
    });
  } catch (error) {
    qbRouteLogger.error({ error }, "Error starting QuickBooks extraction");
    res.status(500).json({
      success: false,
      error: "Failed to start QuickBooks extraction: " + error.message,
    });
  }
});

router.get("/check-quickbooks-extraction", (req, res) => {
  if (!req.session.userid) {
    qbRouteLogger.warn("Unauthorized check-quickbooks-extraction request");
    return res.status(401).json({
      complete: false,
      error: "Not authenticated",
    });
  }

  const userid = req.session.userid;
  const status = extractionStatus.quickbooks[userid];
  qbRouteLogger.debug({ userid, status }, "QuickBooks extraction status checked");

  if (status === undefined) {
    return res.json({ complete: true });
  }

  res.json({ complete: status });
});

router.get("/quickbooks", (req, res) => {
  try {
    if (!oauth2_token_json) {
      qbRouteLogger.debug("No OAuth token found, redirecting to auth");
      return res.redirect("/auth");
    }

    const token = oauth2_token_json;

    if (oauthClient.isAccessTokenValid()) {
      qbRouteLogger.debug("Access token valid, serving quickbooks page");
      return res.sendFile(path.join(__dirname, "..", "..", "..", "public", "quickbooks.html"));
    }

    qbRouteLogger.debug("Access token expired, refreshing token");
    oauthClient
      .refreshUsingToken(token.refresh_token)
      .then((authResponse) => {
        setOAuthToken(authResponse.getJson());
        qbRouteLogger.debug("Token refreshed successfully");
        res.sendFile(path.join(__dirname, "..", "..", "..", "public", "quickbooks.html"));
      })
      .catch((err) => {
        qbRouteLogger.error({ err }, "Error refreshing token");
        res.redirect("/auth");
      });
  } catch (error) {
    qbRouteLogger.error({ error }, "Error in quickbooks route");
    res.status(500).send("Update failed");
  }
});

export default router;
