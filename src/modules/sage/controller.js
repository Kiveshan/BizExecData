import fetch from "node-fetch";
import { getPrismaClient } from "../../config/prismaClient.js";
import {decrypt } from "../../utils/crypto.js";
import jsonpath from "jsonpath";
import { formatDate } from "../../utils/file.js";
import { createModuleLogger } from "../../utils/logger.js";

const moduleLogger = createModuleLogger("sage");

const baseApiUrl = "https://resellers.accounting.sageone.co.za/api/2.0.0";
const apiKey = "{CD7C40B3-D20E-4311-BA13-EE1ED804E023}";

export const extractionStatus = {
  sage: {},
};

export async function validateSageCredentials(username, password) {
  try {
    const url = `${baseApiUrl}/Login/Validate?apikey=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        Username: username,
        Password: password,
      }),
    });

    if (!response.ok) {
      return { isValid: false, error: "Invalid Sage credentials" };
    }

    const data = await response.json();
    try {
      await makeApiCall("Company/Get", username, password);
      return { isValid: true, data };
    } catch {
      return {
        isValid: false,
        error: "Your Sage account doesn't have proper API access permissions.",
      };
    }
  } catch (error) {
    moduleLogger.error({ error }, "Error validating Sage credentials");
    return { isValid: false, error: error.message };
  }
}

const getAuthHeader = (username, password) => {
  return "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
};

export async function makeApiCall(endpoint, username, password, queryParams = {}) {
  const queryString = Object.entries({
    apikey: apiKey,
    ...queryParams,
  })
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");

  const url = `${baseApiUrl}/${endpoint}?${queryString}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: getAuthHeader(username, password),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP error! Status: ${response.status}`);
  }

  return await response.json();
}

export async function makeProfitApiCall(
  endpoint,
  method = "GET",
  body = null,
  queryParams = {},
  username,
  password
) {
  const queryString = Object.entries({
    apikey: apiKey,
    ...queryParams,
  })
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");

  const url = `${baseApiUrl}/${endpoint}?${queryString}`;

  const response = await fetch(url, {
    method: method,
    headers: {
      Authorization: getAuthHeader(username, password),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : null,
  });

  if (!response.ok) {
    throw new Error(`HTTP error! Status: ${response.status}`);
  }

  return await response.json();
}

export async function getCompanyData(username, password) {
  try {
    const companiesData = await makeApiCall("Company/Get", username, password);

    if (!companiesData.Results || companiesData.Results.length === 0) {
      return { isValid: true, noCompanies: true };
    }

    const selectedCompany = companiesData.Results[0];
    const companyId = selectedCompany.ID;

    return {
      isValid: true,
      companyId,
      companyName: selectedCompany.Name,
      companyData: selectedCompany,
    };
  } catch (error) {
    moduleLogger.error({ error }, "Error in getCompanyData");
    return { isValid: false, error: error.message };
  }
}

export function generateMonthlyDateRanges(isInitialExtraction = true, startMonth = 0) {
  const dateRanges = [];
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth();
  const yearsBack = isInitialExtraction ? 3 : 1;
  const startYear = currentYear - yearsBack;
  moduleLogger.info({ isInitialExtraction, startYear, currentYear, currentMonth: currentMonth + 1 }, "Generating date ranges");

  for (let year = startYear; year <= currentYear; year++) {
    const firstMonth = year === startYear ? startMonth : 0;
    const lastMonth = year === currentYear ? currentMonth : 11;

    for (let month = firstMonth; month <= lastMonth; month++) {
      const startDate = new Date(year, month, 1);
      const endDate = new Date(year, month + 1, 0);

      dateRanges.push({
        startDate: formatDate(startDate),
        endDate: formatDate(endDate),
        monthName: startDate.toLocaleString("default", { month: "long" }),
        year: year,
      });
    }
  }

  return dateRanges;
}

export async function getProfitAndLossForSpecificMonth(
  companyId,
  fromDate,
  toDate,
  username,
  password
) {
  try {
    const requestBody = {
      FromDate: fromDate,
      ToDate: toDate,
      UsePurchases: false,
      DisplayReportingGroupDetail: true,
      Comparative: false,
      BudgetId: null,
      ShowVariance: false,
    };

    const profitLossData = await makeProfitApiCall(
      "ProfitAndLoss/Get",
      "POST",
      requestBody,
      { companyId: companyId },
      username,
      password
    );

    return {
      fromDate,
      toDate,
      data: profitLossData,
    };
  } catch (error) {
    moduleLogger.error({ error }, "Error getting profit and loss data");
    throw error;
  }
}

export async function processMonthlyData(
  userid,
  dateRanges,
  companyid,
  email,
  encryptedPassword
) {
  const prisma = getPrismaClient();
  try {
    extractionStatus.sage[userid] = false;
    const password = decrypt(encryptedPassword);

    for (let i = 0; i < dateRanges.length; i++) {
      const range = dateRanges[i];

      try {
        const profitAndLossData = await getProfitAndLossForSpecificMonth(
          companyid,
          range.startDate,
          range.endDate,
          email,
          password
        );

        const recordDate = new Date(range.endDate);
        await getSageRevenue(profitAndLossData, userid, recordDate);
        await insertSageExpenses(profitAndLossData, userid, recordDate);
        await insertSageCostOfSales(profitAndLossData, userid, recordDate);
        await insertSageTotals(profitAndLossData, userid, recordDate);
      } catch (error) {
        moduleLogger.error({ month: range.monthName, error }, "Failed to process month");
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    await prisma.user_table.update({
      where: { userid },
      data: { first_time_insertion: false },
    });

    extractionStatus.sage[userid] = true;
    setTimeout(() => {
      delete extractionStatus.sage[userid];
    }, 60 * 60 * 1000);
  } catch (error) {
    moduleLogger.error({ error }, "Error in processMonthlyData");
    extractionStatus.sage[userid] = true;
  }
}

async function getSageRevenue(profitandlossdata, userid, customDate = null) {
  const prisma = getPrismaClient();
  try {
    const date = customDate || new Date();
    const revenue = jsonpath.query(
      profitandlossdata.data,
      '$[?(@.Description=="Sales")].Children[*]'
    );
    const salesExtracted = revenue.map((item) => ({
      name: item.Description,
      amount: item.Total[0],
    }));

    for (const revenue of salesExtracted) {
      const existingRecord = await prisma.sage_revenue.findFirst({
        where: { userid, category: revenue.name, date },
        select: { revenueid: true, revenue: true },
      });

      if (existingRecord) {
        if (Number(existingRecord.revenue) !== Number(revenue.amount)) {
          await prisma.sage_revenue.update({
            where: { revenueid: existingRecord.revenueid },
            data: { revenue: Number(revenue.amount) },
          });
        }
      } else {
        await prisma.sage_revenue.create({
          data: {
            userid,
            category: revenue.name,
            revenue: Number(revenue.amount),
            date,
          },
        });
      }
    }
    return salesExtracted;
  } catch (err) {
    moduleLogger.error({ err }, "Error in getSageRevenue");
    throw err;
  }
}

async function insertSageExpenses(profitandlossdata, userid, customDate = null) {
  const prisma = getPrismaClient();
  try {
    const formattedDate = customDate || new Date();
    const expenses = jsonpath.query(
      profitandlossdata.data,
      '$[?(@.Description=="Expenses")].Children[*]'
    );
    const expensesExtracted = expenses.map((item) => ({
      name: item.Description,
      amount: item.Total[0],
    }));

    for (const expense of expensesExtracted) {
      const existingRecord = await prisma.sage_expenses.findFirst({
        where: { userid, category: expense.name, date: formattedDate },
        select: { expenseid: true, amount: true },
      });

      if (existingRecord) {
        if (Number(existingRecord.amount) !== Number(expense.amount)) {
          await prisma.sage_expenses.update({
            where: { expenseid: existingRecord.expenseid },
            data: { amount: Number(expense.amount) },
          });
        }
      } else {
        await prisma.sage_expenses.create({
          data: {
            userid,
            category: expense.name,
            amount: Number(expense.amount),
            date: formattedDate,
          },
        });
      }
    }
    return expensesExtracted;
  } catch (err) {
    moduleLogger.error({ err }, "Error in insertSageExpenses");
    throw err;
  }
}

async function insertSageCostOfSales(profitandlossdata, userid, customDate = null) {
  const prisma = getPrismaClient();
  try {
    const formattedDate = customDate || new Date();
    const costOfSales = jsonpath.query(
      profitandlossdata.data,
      '$[?(@.Description=="Cost of Sales")].Children[*]'
    );
    const costOfSalesExtracted = costOfSales.map((item) => ({
      name: item.Description,
      amount: item.Total ? item.Total[0] : 0,
    }));

    for (const item of costOfSalesExtracted) {
      const existingRecord = await prisma.sage_costofsales.findFirst({
        where: { userid, category: item.name, date: formattedDate },
        select: { costofsalesid: true, costofsales: true },
      });

      if (existingRecord) {
        if (Number(existingRecord.costofsales) !== Number(item.amount)) {
          await prisma.sage_costofsales.update({
            where: { costofsalesid: existingRecord.costofsalesid },
            data: { costofsales: Number(item.amount) },
          });
        }
      } else {
        await prisma.sage_costofsales.create({
          data: {
            userid,
            category: item.name,
            costofsales: Number(item.amount),
            date: formattedDate,
          },
        });
      }
    }
    return costOfSalesExtracted;
  } catch (err) {
    moduleLogger.error({ err }, "Error in insertSageCostOfSales");
    throw err;
  }
}

async function insertSageTotals(profitandlossdata, userid, customDate = null) {
  const prisma = getPrismaClient();
  try {
    const formattedDate = customDate || new Date();
    const totals = jsonpath.query(
      profitandlossdata.data,
      "$[?(@.ReportingLevelType==10)]"
    );

    const grossProfit =
      totals.find((item) => item.Description === "Gross Profit")?.Total?.[0] || 0;
    const netProfit =
      totals.find((item) => item.Description === "Net Profit Or Loss After Tax")
        ?.Total?.[0] || 0;
    const totalSales =
      totals.find((item) => item.Description === "Total for Sales")
        ?.Total?.[0] || 0;
    const totalCostOfSales =
      totals.find((item) => item.Description === "Total for Cost of Sales")
        ?.Total?.[0] || 0;
    const totalExpenses =
      totals.find((item) => item.Description === "Total for Expenses")
        ?.Total?.[0] || 0;

    const existingRecord = await prisma.sage_company_calcs.findFirst({
      where: { userid, date: formattedDate },
      select: { sage_calc_id: true },
    });

    const data = {
      grossprofit: Number(grossProfit),
      opexpenses: Number(totalExpenses),
      netprofit: Number(netProfit),
      sumofsales: Number(totalSales),
      sumofcost: Number(totalCostOfSales),
    };

    if (existingRecord) {
      await prisma.sage_company_calcs.update({
        where: { sage_calc_id: existingRecord.sage_calc_id },
        data,
      });
    } else {
      await prisma.sage_company_calcs.create({
        data: {
          userid,
          date: formattedDate,
          ...data,
        },
      });
    }

    return {
      grossProfit,
      totalExpenses,
      netProfit,
      totalSales,
      totalCostOfSales,
      date: formattedDate,
    };
  } catch (err) {
    moduleLogger.error({ err }, "Error in insertSageTotals");
    throw err;
  }
}

export async function getSageCompanyData(req, res) {
  const prisma = getPrismaClient();
  const userid = req.session.user.userid;

  try {
    const data = await prisma.sage_company_calcs.findMany({
      where: { userid },
      select: { date: true, sumofsales: true, sumofcost: true, grossprofit: true },
      orderBy: { date: "asc" },
    });
    const lastEntryDate = await prisma.sage_company_calcs.findFirst({
      where: { userid },
      select: { date: true },
      orderBy: { date: "desc" },
    });
    res.json({ data, lastEntryDate: lastEntryDate?.date });
  } catch (err) {
    moduleLogger.error({ err }, "Server Error in getSageCompanyData");
    res.status(500).send("Server Error");
  }
}

export async function getSageProfitData(req, res) {
  const prisma = getPrismaClient();
  const userid = req.session.user.userid;
  try {
    const data = await prisma.sage_company_calcs.findMany({
      where: { userid },
      select: { date: true, grossprofit: true, opexpenses: true, netprofit: true },
      orderBy: { date: "asc" },
    });
    res.json(data);
  } catch (err) {
    moduleLogger.error({ err }, "Server Error in getSageProfitData");
    res.status(500).send("Server Error");
  }
}

export async function getSageExpensesData(req, res) {
  const prisma = getPrismaClient();
  const userid = req.session.user.userid;
  try {
    const data = await prisma.sage_expenses.findMany({
      where: { userid },
      select: { date: true, amount: true, category: true },
      orderBy: { category: "asc" },
    });
    const lastEntryDate = await prisma.sage_company_calcs.findFirst({
      where: { userid },
      select: { date: true },
      orderBy: { date: "desc" },
    });
    res.json({ data, lastEntryDate: lastEntryDate?.date });
  } catch (err) {
    moduleLogger.error({ err }, "Server Error in getSageExpensesData");
    res.status(500).send("Server Error");
  }
}

export async function getSageRevenueData(req, res) {
  const prisma = getPrismaClient();
  const userid = req.session.user.userid;
  try {
    const data = await prisma.sage_revenue.findMany({
      where: { userid },
      select: { date: true, category: true, revenue: true },
      orderBy: { date: "asc" },
    });
    res.json(data);
  } catch (err) {
    moduleLogger.error({ err }, "Server Error in getSageRevenueData");
    res.status(500).send("Server Error");
  }
}

export async function getSageCostOfSalesData(req, res) {
  const prisma = getPrismaClient();
  const userid = req.session.user.userid;
  try {
    const data = await prisma.sage_costofsales.findMany({
      where: { userid },
      select: { date: true, costofsales: true, category: true },
      orderBy: { date: "asc" },
    });
    res.json(data);
  } catch (err) {
    moduleLogger.error({ err }, "Server Error in getSageCostOfSalesData");
    res.status(500).send("Server Error");
  }
}
