import { getPrismaClient } from "../../config/prismaClient.js";
import { oauthClient } from "./client.js";
import { formatDate } from "../../utils/file.js";
import jsonpath from "jsonpath";
import { createModuleLogger } from "../../utils/logger.js";

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
  const prisma = getPrismaClient();
  const dbDate = date instanceof Date ? date : new Date(date);
  try {
    const existing = await prisma.revenue.findFirst({
      where: {
        category,
        userid,
        date: dbDate,
      },
      select: {
        revenue_id: true,
        revenue: true,
      },
    });

    if (existing) {
      const existingAmount = existing.revenue === null || existing.revenue === undefined ? null : Number(existing.revenue);
      if (existingAmount !== Number(amount)) {
        await prisma.revenue.update({
          where: { revenue_id: existing.revenue_id },
          data: { revenue: Number(amount) },
        });
      }
    } else {
      await prisma.revenue.create({
        data: {
          category,
          revenue: Number(amount),
          userid,
          date: dbDate,
        },
      });
    }
  } catch (err) {
    moduleLogger.error({ err }, "Error upserting revenue data");
  }
}

export async function upsertCOGS(category, amount, userid, date) {
  const prisma = getPrismaClient();
  const dbDate = date instanceof Date ? date : new Date(date);
  try {
    const existing = await prisma.costofsales.findFirst({
      where: {
        category,
        userid,
        date: dbDate,
      },
      select: {
        costofsalesid: true,
        costofsales: true,
      },
    });

    if (existing) {
      const existingAmount = existing.costofsales === null || existing.costofsales === undefined ? null : Number(existing.costofsales);
      if (existingAmount !== Number(amount)) {
        await prisma.costofsales.update({
          where: { costofsalesid: existing.costofsalesid },
          data: { costofsales: Number(amount) },
        });
      }
    } else {
      await prisma.costofsales.create({
        data: {
          category,
          costofsales: Number(amount),
          userid,
          date: dbDate,
        },
      });
    }
  } catch (err) {
    moduleLogger.error({ err }, "Error upserting revenue data");
  }
}

export async function upsertExpenses(category, amount, userid, date) {
  const prisma = getPrismaClient();
  const dbDate = date instanceof Date ? date : new Date(date);
  try {
    const existing = await prisma.expenses.findFirst({
      where: {
        category,
        userid,
        date: dbDate,
      },
      select: {
        expenseid: true,
        expenses: true,
      },
    });

    if (existing) {
      const existingAmount = existing.expenses === null || existing.expenses === undefined ? null : Number(existing.expenses);
      if (existingAmount !== Number(amount)) {
        await prisma.expenses.update({
          where: { expenseid: existing.expenseid },
          data: { expenses: Number(amount) },
        });
      }
    } else {
      await prisma.expenses.create({
        data: {
          category,
          expenses: Number(amount),
          userid,
          date: dbDate,
        },
      });
    }
  } catch (err) {
    moduleLogger.error({ err }, "Error upserting revenue data");
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
  const prisma = getPrismaClient();
  try {
    const user = await prisma.user_table.findUnique({
      where: { userid },
      select: { first_time_insertion: true },
    });

    const isInitialExtraction = user?.first_time_insertion ?? true;
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

          const dbDate = endOfMonthDate;
          const existing = await prisma.company_calcs.findFirst({
            where: { userid, date: dbDate },
            select: { calcid: true },
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
              data: { userid, date: dbDate, ...data },
            });
          }
        } catch (e) {
          moduleLogger.error({ startOfMonth, error: e }, "Error processing data for month");
        }

        date.setMonth(date.getMonth() + 1);
      }

      await processAdditionalQuickBooksData(userid, companyID, isInitialExtraction);

      await prisma.user_table.update({
        where: { userid },
        data: { first_time_insertion: false },
      });

      extractionStatus.quickbooks[userid] = true;

      setTimeout(() => {
        delete extractionStatus.quickbooks[userid];
      }, 60 * 60 * 1000);
    } catch (error) {
      moduleLogger.error({ error }, "Error in QuickBooks data processing");
      extractionStatus.quickbooks[userid] = true;
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
