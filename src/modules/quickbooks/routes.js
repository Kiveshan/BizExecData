import { Router } from "express";
import path from "path";
import { fileURLToPath } from "url";
import jsonpath from "jsonpath";
import OAuthClient from "intuit-oauth";
import { oauthClient, authurl, setOAuthToken } from "./client.js";
import { getPrismaClient } from "../../config/prismaClient.js";
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
import { createModuleLogger } from "../../utils/logger.js";

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
  const prisma = getPrismaClient();
  try {
    await oauthClient.createToken(req.url).then((authResponse) => {
      setOAuthToken(JSON.stringify(authResponse.json, null, 2));
    });
    const companyID = oauthClient.getToken().realmId;
    const companyIdBigInt = (() => {
      try {
        return BigInt(companyID);
      } catch {
        return null;
      }
    })();

    const authResponse = await oauthClient.makeApiCall({
      url: `https://sandbox-quickbooks.api.intuit.com/v3/company/${companyID}/query?query=select * from CompanyInfo&minorversion=75`,
    });

    const companyInfo = authResponse.json.QueryResponse.CompanyInfo[0];
    const companyName = companyInfo.CompanyName || companyInfo.LegalName;
    const email = companyInfo.Email?.Address || "";
    const address = `${companyInfo.CompanyAddr?.Line1}, ${companyInfo.CompanyAddr?.City}, ${companyInfo.CompanyAddr?.CountrySubDivisionCode}, ${companyInfo.CompanyAddr?.PostalCode}`;
    const industryType =
      companyInfo.NameValue.find((nv) => nv.Name === "QBOIndustryType")?.Value ||
      "";

    qbRouteLogger.info({ companyID, companyName, email }, "QuickBooks OAuth callback - company info extracted");

    const existingUser = companyIdBigInt
      ? await prisma.user_table.findFirst({
          where: { company_id: companyIdBigInt },
        })
      : null;

    const exsistingLicense = await prisma.license_management.findFirst({
      where: {
        userid: String(companyID),
      },
    });

    if (!existingUser) {
      qbRouteLogger.info({ companyID }, "New QuickBooks user registration");
      const currentDate = new Date();

      await prisma.user_table.create({
        data: {
          firstname: "N/A",
          surname: "N/A",
          company_id: companyIdBigInt,
          company_name: companyName,
          email,
          address,
          company_services: industryType,
          first_time_insertion: true,
          accounting_software: "Quickbooks",
        },
      });

      await prisma.license_management.create({
        data: {
          owner_name: "N/A",
          company_name: companyName,
          status: "Pending",
          date_submitted: currentDate,
          userid: String(companyID),
        },
      });

      return res.redirect(
        `/?message=Thank you for registering with BizTech, Please wait for our admin to approve your account`
      );
    }
    if (
      existingUser.status === "pending" ||
      existingUser.status === "rejected" ||
      exsistingLicense?.status === "Pending" ||
      exsistingLicense?.status === "Deactivated"
    ) {
      qbRouteLogger.warn({ userid: existingUser.userid, status: existingUser.status }, "QuickBooks user access denied");
      return res.redirect(
        `/?message=Your account is ${existingUser.status} and your License is ${exsistingLicense?.status}. Please contact our support team.`
      );
    }

    if (
      existingUser.status === "approved" &&
      existingUser.first_time_insertion === true &&
      exsistingLicense?.status === "Paid"
    ) {
      req.session.userid = existingUser.userid;
      qbRouteLogger.info({ userid: existingUser.userid }, "QuickBooks user redirected to loading");
      req.session.save((err) => {
        if (err) {
          qbRouteLogger.error({ err, userid: existingUser.userid }, "Failed to save session before redirect");
          return res.status(500).send("Session error");
        }
        res.redirect(`/quickbooks-loading`);
      });
    } else {
      req.session.userid = existingUser.userid;
      qbRouteLogger.info({ userid: existingUser.userid }, "QuickBooks user redirected to company");
      req.session.save((err) => {
        if (err) {
          qbRouteLogger.error({ err, userid: existingUser.userid }, "Failed to save session before redirect");
          return res.status(500).send("Session error");
        }
        res.redirect("/company");
      });
    }
  } catch (err) {
    qbRouteLogger.error({ err }, "Error during QuickBooks OAuth callback");
    res.status(500).send("Error occurred while fetching company data.");
  }
});

router.get("/update", async (req, res) => {
  const userid = req.session.userid;
  const companyID = oauthClient.getToken().realmId;
  const currentDate = new Date();
  const oneYearAgo = currentDate.getFullYear() - 1;
  const startDate = `${oneYearAgo}-${currentDate.getMonth() + 1}-01`;
  let date = new Date(startDate);

  const prisma = getPrismaClient();
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

      const dbDate = endOfMonthDate;
      const existing = await prisma.company_calcs.findFirst({
        where: {
          userid,
          date: dbDate,
        },
        select: {
          calcid: true,
        },
      });

      const data = {
        grossprofit: Number(grossProfit.toFixed(2)),
        opexpenses: Number(Expense.toFixed(2)),
        netprofit: Number(netIncome.toFixed(2)),
        sumofsales: Number(Income.toFixed(2)),
        sumofcost: Number(costOfGoodsSold.toFixed(2)),
      };

      if (existing) {
        await prisma.company_calcs.update({
          where: { calcid: existing.calcid },
          data,
        });
      } else {
        await prisma.company_calcs.create({
          data: {
            userid,
            date: dbDate,
            ...data,
          },
        });
      }
    } catch (e) {
      qbRouteLogger.error({ error: e, startOfMonth }, "Error processing QuickBooks data for month");
    }

    date.setMonth(date.getMonth() + 1);
  }

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
  const prisma = getPrismaClient();

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

  await prisma.user_table.update({
    where: { userid },
    data: { first_time_insertion: false },
  });
  qbRouteLogger.info({ userid }, "QuickBooks initial extraction completed, first_time_insertion set to false");
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
    return res.json({ complete: true, progress: 100 });
  }

  if (typeof status === 'object') {
    return res.json({ complete: status.complete, progress: status.progress, total: status.total });
  }

  res.json({ complete: status, progress: status ? 100 : 0 });
});



export default router;
