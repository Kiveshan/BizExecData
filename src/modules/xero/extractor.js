import { getPrismaClient } from "../../config/prismaClient.js";
import { xero } from "./client.js";
import jsonpath from "jsonpath";
import logger, { createModuleLogger } from "../../utils/logger.js";

const moduleLogger = createModuleLogger("xero");

export const extractionStatus = {
  xero: {},
};

export function extractXeroSummaryData(response) {
  let totalIncome =
    jsonpath.query(
      response,
      '$.reports[*].rows[*].rows[?(@.rowType=="SummaryRow" && @.cells[0].value=="Total Income")].cells[*].value'
    )[1] || 0;
  let totalExpenses =
    jsonpath.query(
      response,
      '$.reports[*].rows[*].rows[?(@.rowType=="SummaryRow" && @.cells[0].value=="Total Operating Expenses")].cells[*].value'
    )[1] || 0;
  let grossProfit =
    jsonpath.query(
      response,
      '$.reports[*].rows[?(@.title=="")].rows[?(@.rowType=="Row" && @.cells[0].value=="Gross Profit")].cells[*].value'
    )[1] || 0;
  let netProfit =
    jsonpath.query(
      response,
      '$.reports[*].rows[?(@.title=="")].rows[?(@.rowType=="Row" && @.cells[0].value=="Net Profit")].cells[*].value'
    )[1] || 0;
  let totalCost =
    jsonpath.query(
      response,
      '$.reports[*].rows[*].rows[?(@.rowType=="SummaryRow" && @.cells[0].value=="Total Cost of Sales")].cells[*].value'
    )[1] || 0;

  return { totalIncome, totalExpenses, grossProfit, netProfit, totalCost };
}

export function extractXeroExpenses(response, date) {
  const accountNames = jsonpath.query(
    response,
    '$.reports[0].rows[?(@.title == "Less Operating Expenses")].rows[?(@.rowType == "Row")].cells[0].value'
  );
  const amounts = jsonpath.query(
    response,
    '$.reports[0].rows[?(@.title == "Less Operating Expenses")].rows[?(@.rowType == "Row")].cells[1].value'
  );

  const expenses = accountNames.map((name, index) => ({
    accountName: name,
    amount: amounts[index],
    date,
  }));

  return expenses;
}

export function extractXeroIncome(response) {
  const accountNames = jsonpath.query(
    response,
    '$.reports[0].rows[?(@.title == "Income")].rows[?(@.rowType == "Row")].cells[0].value'
  );

  const amounts = jsonpath.query(
    response,
    '$.reports[0].rows[?(@.title == "Income")].rows[?(@.rowType == "Row")].cells[1].value'
  );

  const income = accountNames.map((name, index) => ({
    accountName: name,
    amount: amounts[index],
  }));

  return income;
}

export function extractXeroCostOfSales(response) {
  const accountNames = jsonpath.query(
    response,
    '$.reports[0].rows[?(@.title == "Less Cost of Sales")].rows[?(@.rowType == "Row")].cells[0].value'
  );

  const amounts = jsonpath.query(
    response,
    '$.reports[0].rows[?(@.title == "Less Cost of Sales")].rows[?(@.rowType == "Row")].cells[1].value'
  );

  const costofsales = accountNames.map((name, index) => ({
    accountName: name,
    amount: amounts[index],
  }));

  return costofsales;
}

function toDbDate(value) {
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date");
  }
  return parsed;
}

export async function processXeroData(userid) {
  const prisma = getPrismaClient();
  try {
    const user = await prisma.user_table.findUnique({
      where: { userid },
      select: { first_time_insertion: true },
    });

    const isInitialExtraction = user?.first_time_insertion ?? true;
    moduleLogger.info({ userid, isInitialExtraction }, "Starting Xero extraction");

    if (!xero.tenants || xero.tenants.length === 0) {
      throw new Error("No tenants available. Please connect to Xero first.");
    }

    const tenantId = xero.tenants[0].tenantId;
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    const startYear = isInitialExtraction ? currentYear - 3 : currentYear - 1;
    moduleLogger.info({ startYear, currentYear, currentMonth }, "Date range calculated");

    for (let year = startYear; year <= currentYear; year++) {
      const endMonth = year === currentYear ? currentMonth : 12;
      for (let month = 1; month <= endMonth; month++) {
        const formattedStartDate = `${year}-${month
          .toString()
          .padStart(2, "0")}-01`;
        const formattedEndDate = new Date(year, month, 0)
          .toISOString()
          .split("T")[0];
        const endDate = toDbDate(formattedEndDate);

        const response = await xero.accountingApi.getReportProfitAndLoss(
          tenantId,
          formattedStartDate,
          formattedEndDate,
          null,
          null,
          false,
          ["Income", "Expense", "DirectCosts"]
        );

        if (response.body.reports && response.body.reports.length > 0) {
          const summaryData = extractXeroSummaryData(response.body);

          if (summaryData.grossProfit == 0.0 && summaryData.netProfit == 0.0) {
            moduleLogger.info({ year, month }, "Skipping month as all values are 0");
            continue;
          }

          const existingData = await prisma.xero_company_calcs.findFirst({
            where: { userid, date: endDate },
            select: {
              xero_calc_id: true,
              sumofsales: true,
              opexpenses: true,
              grossprofit: true,
              netprofit: true,
              sumofcost: true,
            },
          });

          const calcData = {
            sumofsales: Number(summaryData.totalIncome),
            opexpenses: Number(summaryData.totalExpenses),
            grossprofit: Number(summaryData.grossProfit),
            netprofit: Number(summaryData.netProfit),
            sumofcost: Number(summaryData.totalCost),
          };

          if (!existingData) {
            await prisma.xero_company_calcs.create({
              data: {
                userid,
                date: endDate,
                ...calcData,
              },
            });
          } else if (
            Number(existingData.sumofsales) !== calcData.sumofsales ||
            Number(existingData.opexpenses) !== calcData.opexpenses ||
            Number(existingData.grossprofit) !== calcData.grossprofit ||
            Number(existingData.netprofit) !== calcData.netprofit ||
            Number(existingData.sumofcost) !== calcData.sumofcost
          ) {
            await prisma.xero_company_calcs.update({
              where: { xero_calc_id: existingData.xero_calc_id },
              data: calcData,
            });
          }

          const expenses = extractXeroExpenses(response.body, endDate);
          for (const expense of expenses) {
            const existingExpense = await prisma.xero_expenses.findFirst({
              where: { userid, date: endDate, category: expense.accountName },
              select: { expenseid: true, amount: true },
            });

            if (!existingExpense) {
              await prisma.xero_expenses.create({
                data: {
                  userid,
                  date: endDate,
                  category: expense.accountName,
                  amount: Number(expense.amount),
                },
              });
            } else if (Number(existingExpense.amount) !== Number(expense.amount)) {
              await prisma.xero_expenses.update({
                where: { expenseid: existingExpense.expenseid },
                data: { amount: Number(expense.amount) },
              });
            }
          }

          const income = extractXeroIncome(response.body);
          for (const entry of income) {
            const existingIncome = await prisma.xero_revenue.findFirst({
              where: { userid, date: endDate, category: entry.accountName },
              select: { revenueid: true, revenue: true },
            });

            if (!existingIncome) {
              await prisma.xero_revenue.create({
                data: {
                  userid,
                  date: endDate,
                  category: entry.accountName,
                  revenue: Number(entry.amount),
                },
              });
            } else if (Number(existingIncome.revenue) !== Number(entry.amount)) {
              await prisma.xero_revenue.update({
                where: { revenueid: existingIncome.revenueid },
                data: { revenue: Number(entry.amount) },
              });
            }
          }

          const costofsales = extractXeroCostOfSales(response.body);
          if (costofsales && costofsales.length > 0) {
            for (const entry of costofsales) {
              const existingCostOfSales = await prisma.xero_costofsales.findFirst({
                where: { userid, date: endDate, category: entry.accountName },
                select: { costofsalesid: true, costofsales: true },
              });

              if (!existingCostOfSales) {
                await prisma.xero_costofsales.create({
                  data: {
                    userid,
                    date: endDate,
                    category: entry.accountName,
                    costofsales: Number(entry.amount),
                  },
                });
              } else if (Number(existingCostOfSales.costofsales) !== Number(entry.amount)) {
                await prisma.xero_costofsales.update({
                  where: { costofsalesid: existingCostOfSales.costofsalesid },
                  data: { costofsales: Number(entry.amount) },
                });
              }
            }
          }
        }
      }
    }

    await prisma.user_table.update({
      where: { userid },
      data: { first_time_insertion: false },
    });

    extractionStatus.xero[userid] = true;

    setTimeout(() => {
      delete extractionStatus.xero[userid];
    }, 60 * 60 * 1000);
  } catch (err) {
    moduleLogger.error({ err }, "Error in processXeroData");
    extractionStatus.xero[userid] = true;
  }
}
