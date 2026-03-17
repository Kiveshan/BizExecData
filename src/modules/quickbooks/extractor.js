import { connectDb, closeDb } from "../../config/database.js";
import { oauthClient } from "./client.js";
import { formatDate } from "../../utils/file.js";
import jsonpath from "jsonpath";
import logger, { createModuleLogger } from "../../utils/logger.js";

const moduleLogger = createModuleLogger("quickbooks");

export const extractionStatus = {
  quickbooks: {},
};

export async function fetchProfitAndLoss(companyID, startOfMonth, endOfMonth) {
  const authResponse = await oauthClient.makeApiCall({
    url: `https://sandbox-quickbooks.api.intuit.com/v3/company/${companyID}/reports/ProfitAndLoss?start_date=${startOfMonth}&end_date=${endOfMonth}`,
  });
  return authResponse.json;
}

export async function upsertRevenue(category, amount, userid, date) {
  const db = await connectDb();
  try {
    const result = await db.query(
      "SELECT revenue FROM revenue WHERE category = $1 AND userid = $2 AND date = $3",
      [category, userid, date]
    );

    if (result.rows.length > 0) {
      const existingAmount = parseFloat(result.rows[0].revenue);
      if (existingAmount !== parseFloat(amount)) {
        await db.query(
          "UPDATE revenue SET revenue = $1 WHERE category = $2 AND userid = $3 AND date = $4",
          [amount, category, userid, date]
        );
      }
    } else {
      await db.query(
        "INSERT INTO revenue (category, revenue, userid, date) VALUES ($1, $2, $3, $4)",
        [category, amount, userid, date]
      );
    }
  } catch (err) {
    moduleLogger.error({ err }, "Error upserting revenue data");
  } finally {
    await closeDb(db);
  }
}

export async function upsertCOGS(category, amount, userid, date) {
  const db = await connectDb();
  try {
    const result = await db.query(
      "SELECT costofsales FROM costofsales WHERE category = $1 AND userid = $2 AND date = $3",
      [category, userid, date]
    );

    if (result.rows.length > 0) {
      const existingAmount = parseFloat(result.rows[0].costofsales);
      if (existingAmount !== parseFloat(amount)) {
        await db.query(
          "UPDATE costofsales SET costofsales = $1 WHERE category = $2 AND userid = $3 AND date = $4",
          [amount, category, userid, date]
        );
      }
    } else {
      await db.query(
        "INSERT INTO costofsales (category, costofsales, userid, date) VALUES ($1, $2, $3, $4)",
        [category, amount, userid, date]
      );
    }
  } catch (err) {
    moduleLogger.error({ err }, "Error upserting revenue data");
  } finally {
    await closeDb(db);
  }
}

export async function upsertExpenses(category, amount, userid, date) {
  const db = await connectDb();
  try {
    const result = await db.query(
      "SELECT expenses FROM expenses WHERE category = $1 AND userid = $2 AND date = $3",
      [category, userid, date]
    );

    if (result.rows.length > 0) {
      const existingAmount = parseFloat(result.rows[0].expenses);
      if (existingAmount !== parseFloat(amount)) {
        await db.query(
          "UPDATE expenses SET expenses = $1 WHERE category = $2 AND userid = $3 AND date = $4",
          [amount, category, userid, date]
        );
      }
    } else {
      await db.query(
        "INSERT INTO expenses (category, expenses, userid, date) VALUES ($1, $2, $3, $4)",
        [category, amount, userid, date]
      );
    }
  } catch (err) {
    moduleLogger.error({ err }, "Error upserting revenue data");
  } finally {
    await closeDb(db);
  }
}

export async function findFinancialData(obj, userid, date, upsertFunction) {
  if (Array.isArray(obj)) {
    for (const item of obj) {
      await findFinancialData(item, userid, date, upsertFunction);
    }
  } else if (obj && typeof obj === "object") {
    if (obj.ColData && obj.ColData.length >= 2) {
      const category = obj.ColData[0]?.value;
      const amount = obj.ColData[1]?.value;

      if (category && amount) {
        await upsertFunction(category, amount, userid, date);
      }
    }

    if (obj.Rows && obj.Rows.Row) {
      await findFinancialData(obj.Rows.Row, userid, date, upsertFunction);
    }

    if (obj.Header && obj.Header.ColData && obj.Header.ColData.length >= 2) {
      const headerCategory = obj.Header.ColData[0]?.value;
      const headerAmount = obj.Header.ColData[1]?.value;

      if (headerCategory && headerAmount) {
        await upsertFunction(headerCategory, headerAmount, userid, date);
      }
    }
  }
}

export async function processQuickBooksData(userid) {
  try {
    const db = await connectDb();
    
    const userResult = await db.query(
      "SELECT first_time_insertion FROM user_table WHERE userid = $1",
      [userid]
    );
    
    const isInitialExtraction = userResult.rows.length > 0 ? userResult.rows[0].first_time_insertion : true;
    moduleLogger.info({ userid, isInitialExtraction }, "Starting QuickBooks extraction");
    
    const currentDate = new Date();
    const yearsBack = isInitialExtraction ? 3 : 1;
    const startYear = currentDate.getFullYear() - yearsBack;
    const startDate = `${startYear}-${currentDate.getMonth() + 1}-01`;
    const date = new Date(startDate);
    const companyID = oauthClient.getToken().realmId;
    moduleLogger.info({ startDate, endDate: currentDate.toISOString().split('T')[0] }, "QuickBooks date range");

    try {
      while (date <= currentDate) {
        const startOfMonth = formatDate(date);
        const endOfMonthDate = new Date(
          date.getFullYear(),
          date.getMonth() + 1,
          0
        );
        const endOfMonth = formatDate(endOfMonthDate);

        const obj = {};

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
            (Number.parseFloat(obj["Total for Expenses"]) || 0) +
            (Number.parseFloat(obj["Total for Other Expense"]) || 0);
          const Income =
            (Number.parseFloat(obj["Total for Income"]) || 0) +
            (Number.parseFloat(obj["Total for Other Income"]) || 0);
          const grossProfit = Number.parseFloat(obj["Gross Profit"]) || 0;
          const netIncome = Number.parseFloat(obj["Net Income"]) || 0;
          const costOfGoodsSold =
            Number.parseFloat(obj["Total for Cost of Goods Sold"]) || 0;

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
          moduleLogger.error({ startOfMonth, error: e }, "Error processing data for month");
        }

        date.setMonth(date.getMonth() + 1);
      }

      await processAdditionalQuickBooksData(userid, companyID, isInitialExtraction);

      await db.query(
        "UPDATE user_table SET first_time_insertion = true WHERE userid = $1",
        [userid]
      );

      extractionStatus.quickbooks[userid] = true;

      setTimeout(() => {
        delete extractionStatus.quickbooks[userid];
      }, 60 * 60 * 1000);
    } catch (error) {
      moduleLogger.error({ error }, "Error in QuickBooks data processing");
      extractionStatus.quickbooks[userid] = true;
    } finally {
      await closeDb(db);
    }
  } catch (error) {
    moduleLogger.error({ error }, "Error in processQuickBooksData");
    extractionStatus.quickbooks[userid] = true;
  }
}

async function processAdditionalQuickBooksData(userid, companyID, isInitialExtraction) {
  try {
    await processIncomeData(userid, companyID, isInitialExtraction);
    await processCostData(userid, companyID, isInitialExtraction);
    await processExpensesData(userid, companyID, isInitialExtraction);
    await processOtherIncomeData(userid, companyID, isInitialExtraction);
  } catch (error) {
    moduleLogger.error({ error }, "Error processing additional QuickBooks data");
    throw error;
  }
}

async function processIncomeData(userid, companyID, isInitialExtraction = true) {
  moduleLogger.info({ isInitialExtraction }, "Processing income data");
  const currentDate = new Date();
  const yearsBack = isInitialExtraction ? 3 : 1;
  const startYear = currentDate.getFullYear() - yearsBack;
  const startDate = `${startYear}-01-01`;
  const date = new Date(startDate);

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
      moduleLogger.error({ err }, "Error extracting and saving income transactions");
    }

    date.setMonth(date.getMonth() + 1);
  }
}

async function processCostData(userid, companyID, isInitialExtraction = true) {
  moduleLogger.info({ isInitialExtraction }, "Processing cost data");
  const currentDate = new Date();
  const yearsBack = isInitialExtraction ? 3 : 1;
  const startYear = currentDate.getFullYear() - yearsBack;
  const startDate = `${startYear}-01-01`;
  const date = new Date(startDate);

  while (date <= currentDate) {
    const startOfMonth = formatDate(date);
    const endOfMonthDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const endOfMonth = formatDate(endOfMonthDate);

    try {
      const data = await fetchProfitAndLoss(companyID, startOfMonth, endOfMonth);
      const costRows = jsonpath.query(data, '$.Rows.Row[?(@.group == "COGS")]');
      await findFinancialData(costRows, userid, endOfMonth, upsertCOGS);
    } catch (err) {
      moduleLogger.error({ err }, "Error extracting and saving cost transactions");
    }

    date.setMonth(date.getMonth() + 1);
  }
}

async function processExpensesData(userid, companyID, isInitialExtraction = true) {
  moduleLogger.info({ isInitialExtraction }, "Processing expenses data");
  const currentDate = new Date();
  const yearsBack = isInitialExtraction ? 3 : 1;
  const startYear = currentDate.getFullYear() - yearsBack;
  const startDate = `${startYear}-01-01`;
  const date = new Date(startDate);

  while (date <= currentDate) {
    const startOfMonth = formatDate(date);
    const endOfMonthDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const endOfMonth = formatDate(endOfMonthDate);

    try {
      const data = await fetchProfitAndLoss(companyID, startOfMonth, endOfMonth);
      const expenseRows = jsonpath.query(
        data,
        '$.Rows.Row[?(@.group == "Expenses")]'
      );
      await findFinancialData(expenseRows, userid, endOfMonth, upsertExpenses);
    } catch (err) {
      moduleLogger.error({ err }, "Error extracting and saving expense transactions");
    }

    date.setMonth(date.getMonth() + 1);
  }
}

async function processOtherIncomeData(userid, companyID, isInitialExtraction = true) {
  moduleLogger.info({ isInitialExtraction }, "Processing other income data");
  const currentDate = new Date();
  const yearsBack = isInitialExtraction ? 3 : 1;
  const startYear = currentDate.getFullYear() - yearsBack;
  const startDate = `${startYear}-01-01`;
  const date = new Date(startDate);

  while (date <= currentDate) {
    const startOfMonth = formatDate(date);
    const endOfMonthDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const endOfMonth = formatDate(endOfMonthDate);

    try {
      const data = await fetchProfitAndLoss(companyID, startOfMonth, endOfMonth);
      const otherIncomeRows = jsonpath.query(
        data,
        '$.Rows.Row[?(@.group == "OtherIncome")]'
      );
      await findFinancialData(
        otherIncomeRows,
        userid,
        endOfMonth,
        upsertRevenue
      );
    } catch (err) {
      moduleLogger.error({ err }, "Error extracting and saving other income transactions");
    }

    date.setMonth(date.getMonth() + 1);
  }
}
