import fetch from "node-fetch";
import { connectDb, closeDb } from "../../config/database.js";
import { hash, compare } from "bcrypt";
import { encrypt, decrypt } from "../../utils/crypto.js";
import jsonpath from "jsonpath";
import { formatDate } from "../../utils/file.js";

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
    } catch (apiError) {
      return {
        isValid: false,
        error: "Your Sage account doesn't have proper API access permissions.",
      };
    }
  } catch (error) {
    console.error("Error validating Sage credentials:", error);
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
    console.error("Error in getCompanyData:", error);
    return { isValid: false, error: error.message };
  }
}

export function generateMonthlyDateRanges(startYear = 2024, startMonth = 0) {
  const dateRanges = [];
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth();

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
    console.error(`Error getting profit and loss data:`, error);
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
        console.error(`Failed to process ${range.monthName}:`, error);
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const db = await connectDb();
    try {
      await db.query(
        "UPDATE user_table SET first_time_insertion = true WHERE userid = $1",
        [userid]
      );
    } finally {
      await closeDb(db);
    }

    extractionStatus.sage[userid] = true;
    setTimeout(() => {
      delete extractionStatus.sage[userid];
    }, 60 * 60 * 1000);
  } catch (error) {
    console.error(`Error in processMonthlyData:`, error);
    extractionStatus.sage[userid] = true;
  }
}

async function getSageRevenue(profitandlossdata, userid, customDate = null) {
  let db = await connectDb();
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
      const existingRecord = await db.query(
        `SELECT * FROM sage_revenue WHERE userid = $1 AND category = $2 AND date = $3`,
        [userid, revenue.name, date]
      );

      if (existingRecord.rows.length > 0) {
        await db.query(
          `UPDATE sage_revenue SET revenue = $1 WHERE userid = $2 AND category = $3 AND date = $4`,
          [revenue.amount, userid, revenue.name, date]
        );
      } else {
        await db.query(
          `INSERT INTO sage_revenue (userid, category, revenue, date) VALUES ($1, $2, $3, $4)`,
          [userid, revenue.name, revenue.amount, date]
        );
      }
    }
    return salesExtracted;
  } catch (err) {
    console.error(`Error in getSageRevenue:`, err);
    throw err;
  } finally {
    await closeDb(db);
  }
}

async function insertSageExpenses(profitandlossdata, userid, customDate = null) {
  let db = await connectDb();
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
      const existingRecord = await db.query(
        `SELECT * FROM sage_expenses WHERE userid = $1 AND category = $2 AND date = $3`,
        [userid, expense.name, formattedDate]
      );

      if (existingRecord.rows.length > 0) {
        await db.query(
          `UPDATE sage_expenses SET amount = $1 WHERE userid = $2 AND category = $3 AND date = $4`,
          [expense.amount, userid, expense.name, formattedDate]
        );
      } else {
        await db.query(
          `INSERT INTO sage_expenses (userid, category, amount, date) VALUES ($1, $2, $3, $4)`,
          [userid, expense.name, expense.amount, formattedDate]
        );
      }
    }
    return expensesExtracted;
  } catch (err) {
    console.error(`Error in insertSageExpenses:`, err);
    throw err;
  } finally {
    await closeDb(db);
  }
}

async function insertSageCostOfSales(profitandlossdata, userid, customDate = null) {
  let db = await connectDb();
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
      const existingRecord = await db.query(
        `SELECT * FROM sage_costofsales WHERE userid = $1 AND category = $2 AND date = $3`,
        [userid, item.name, formattedDate]
      );

      if (existingRecord.rows.length > 0) {
        await db.query(
          `UPDATE sage_costofsales SET amount = $1 WHERE userid = $2 AND category = $3 AND date = $4`,
          [item.amount, userid, item.name, formattedDate]
        );
      } else {
        await db.query(
          `INSERT INTO sage_costofsales (userid, category, amount, date) VALUES ($1, $2, $3, $4)`,
          [userid, item.name, item.amount, formattedDate]
        );
      }
    }
    return costOfSalesExtracted;
  } catch (err) {
    console.error(`Error in insertSageCostOfSales:`, err);
    throw err;
  } finally {
    await closeDb(db);
  }
}

async function insertSageTotals(profitandlossdata, userid, customDate = null) {
  let db = await connectDb();
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

    const existingRecord = await db.query(
      `SELECT * FROM sage_company_calcs WHERE userid = $1 AND date = $2`,
      [userid, formattedDate]
    );

    if (existingRecord.rows.length > 0) {
      await db.query(
        `UPDATE sage_company_calcs SET grossprofit = $1, opexpenses = $2, netprofit = $3, sumofsales = $4, sumofcost = $5 WHERE userid = $6 AND date = $7`,
        [
          grossProfit,
          totalExpenses,
          netProfit,
          totalSales,
          totalCostOfSales,
          userid,
          formattedDate,
        ]
      );
    } else {
      await db.query(
        `INSERT INTO sage_company_calcs (userid, grossprofit, opexpenses, netprofit, sumofsales, sumofcost, date) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          userid,
          grossProfit,
          totalExpenses,
          netProfit,
          totalSales,
          totalCostOfSales,
          formattedDate,
        ]
      );
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
    console.error(`Error in insertSageTotals:`, err);
    throw err;
  } finally {
    await closeDb(db);
  }
}

export async function getSageCompanyData(req, res) {
  const db = await connectDb();
  const userid = req.session.user.userid;

  try {
    const result = await db.query(
      "SELECT date, sumofsales, sumofcost, grossprofit FROM sage_company_calcs WHERE userid = $1 ORDER BY date",
      [userid]
    );
    const lastEntryDate = await db.query(
      `SELECT date FROM sage_company_calcs WHERE userid = $1 GROUP BY date ORDER BY date DESC LIMIT 1`,
      [userid]
    );
    res.json({ data: result.rows, lastEntryDate: lastEntryDate.rows[0].date });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  } finally {
    await closeDb(db);
  }
}

export async function getSageProfitData(req, res) {
  const db = await connectDb();
  const userid = req.session.user.userid;
  try {
    const result = await db.query(
      "SELECT date, grossprofit, opexpenses, netprofit FROM sage_company_calcs WHERE userid = $1 ORDER BY date",
      [userid]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  } finally {
    await closeDb(db);
  }
}

export async function getSageExpensesData(req, res) {
  const db = await connectDb();
  const userid = req.session.user.userid;
  try {
    const result = await db.query(
      "SELECT date, amount, category FROM sage_expenses WHERE userid = $1 ORDER BY category",
      [userid]
    );
    const lastEntryDate = await db.query(
      `SELECT date FROM sage_company_calcs WHERE userid = $1 GROUP BY date ORDER BY date DESC LIMIT 1`,
      [userid]
    );
    res.json({ data: result.rows, lastEntryDate: lastEntryDate.rows[0].date });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  } finally {
    await closeDb(db);
  }
}

export async function getSageRevenueData(req, res) {
  const db = await connectDb();
  const userid = req.session.user.userid;
  try {
    const result = await db.query(
      "SELECT date, category, revenue FROM sage_revenue WHERE userid = $1 ORDER BY date",
      [userid]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  } finally {
    await closeDb(db);
  }
}

export async function getSageCostOfSalesData(req, res) {
  const db = await connectDb();
  const userid = req.session.user.userid;
  try {
    const result = await db.query(
      "SELECT date, costofsales FROM sage_costofsales WHERE userid = $1 ORDER BY date",
      [userid]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  } finally {
    await closeDb(db);
  }
}
