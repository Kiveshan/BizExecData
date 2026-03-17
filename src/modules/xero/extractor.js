import { connectDb, closeDb } from "../../config/database.js";
import { xero } from "./client.js";
import jsonpath from "jsonpath";

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

export async function insertXeroSummaryData(db, summaryData, userid, startDate) {
  const insertQuery = `
    INSERT INTO xero_company_calcs (
      userid, grossprofit, opexpenses, netprofit, sumofsales, sumofcost, date
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7
    )
  `;
  await db.query(insertQuery, [
    userid,
    summaryData.grossProfit,
    summaryData.totalExpenses,
    summaryData.netProfit,
    summaryData.totalIncome,
    summaryData.totalCost,
    startDate,
  ]);
}

export async function insertExpenses(db, userid, expenses) {
  const insertQuery = `
    INSERT INTO xero_expenses (userid, category, amount, date)
    VALUES ($1, $2, $3, $4)
  `;

  for (const expense of expenses) {
    const { accountName, amount, date } = expense;
    await db.query(insertQuery, [userid, accountName, amount, date]);
  }
}

export async function insertIncome(db, userid, income, date) {
  const insertQuery = `
    INSERT INTO xero_revenue (
      userid, category, revenue, date
    ) VALUES (
      $1, $2, $3, $4
    )
  `;

  for (const entry of income) {
    await db.query(insertQuery, [
      userid,
      entry.accountName,
      entry.amount,
      date,
    ]);
  }
}

export async function insertCostofSales(db, userid, costofsales, date) {
  const insertQuery = `
    INSERT INTO xero_costofsales (
      userid, category, costofsales, date
    ) VALUES (
      $1, $2, $3, $4
    )
  `;

  for (const entry of costofsales) {
    await db.query(insertQuery, [
      userid,
      entry.accountName,
      entry.amount,
      date,
    ]);
  }
}

export async function processXeroData(userid) {
  let db;
  try {
    db = await connectDb();
    
    const userResult = await db.query(
      "SELECT first_time_insertion FROM user_table WHERE userid = $1",
      [userid]
    );
    
    const isInitialExtraction = userResult.rows.length > 0 ? userResult.rows[0].first_time_insertion : true;
    console.log(`[Xero] Starting ${isInitialExtraction ? 'initial' : 'update'} extraction for userid: ${userid}`);

    if (!xero.tenants || xero.tenants.length === 0) {
      throw new Error("No tenants available. Please connect to Xero first.");
    }

    const tenantId = xero.tenants[0].tenantId;
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    const startYear = isInitialExtraction ? currentYear - 3 : currentYear - 1;
    console.log(`[Xero] Date range: ${startYear}-01-01 to ${currentYear}-${currentMonth}-${new Date(currentYear, currentMonth, 0).getDate()}`);

    for (let year = startYear; year <= currentYear; year++) {
      const endMonth = year === currentYear ? currentMonth : 12;
      for (let month = 1; month <= endMonth; month++) {
        const formattedStartDate = `${year}-${month
          .toString()
          .padStart(2, "0")}-01`;
        const formattedEndDate = new Date(year, month, 0)
          .toISOString()
          .split("T")[0];

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
            console.log(`Skipping ${year}-${month} as all values are 0.`);
            continue;
          }

          const existingData = await db.query(
            "SELECT * FROM xero_company_calcs WHERE userid = $1 AND date = $2",
            [userid, formattedEndDate]
          );

          if (existingData.rowCount === 0) {
            await insertXeroSummaryData(
              db,
              summaryData,
              userid,
              formattedEndDate
            );
          } else {
            const existingRecord = existingData.rows[0];
            if (
              existingRecord.sumofsales !== summaryData.totalIncome ||
              existingRecord.opexpenses !== summaryData.totalExpenses ||
              existingRecord.grossprofit !== summaryData.grossProfit ||
              existingRecord.netprofit !== summaryData.netProfit ||
              existingRecord.sumofcost !== summaryData.totalCost
            ) {
              await db.query(
                "UPDATE xero_company_calcs SET sumofsales = $1, opexpenses = $2, grossprofit = $3, netprofit = $4, sumofcost = $5 WHERE userid = $6 AND date = $7",
                [
                  summaryData.totalIncome,
                  summaryData.totalExpenses,
                  summaryData.grossProfit,
                  summaryData.netProfit,
                  summaryData.totalCost,
                  userid,
                  formattedEndDate,
                ]
              );
            }
          }

          const expenses = extractXeroExpenses(response.body, formattedEndDate);
          for (const expense of expenses) {
            const existingExpense = await db.query(
              "SELECT * FROM xero_expenses WHERE userid = $1 AND date = $2 AND category = $3",
              [userid, expense.date, expense.accountName]
            );
            if (existingExpense.rowCount === 0) {
              await db.query(
                "INSERT INTO xero_expenses (userid, date, category, amount) VALUES ($1, $2, $3, $4)",
                [userid, expense.date, expense.accountName, expense.amount]
              );
            } else if (existingExpense.rows[0].amount !== expense.amount) {
              await db.query(
                "UPDATE xero_expenses SET amount = $1 WHERE userid = $2 AND date = $3 AND category = $4",
                [expense.amount, userid, expense.date, expense.accountName]
              );
            }
          }

          const income = extractXeroIncome(response.body);
          for (const entry of income) {
            const existingIncome = await db.query(
              "SELECT * FROM xero_revenue WHERE userid = $1 AND date = $2 AND category = $3",
              [userid, formattedEndDate, entry.accountName]
            );
            if (existingIncome.rowCount === 0) {
              await insertIncome(db, userid, income, formattedEndDate);
            } else if (existingIncome.rows[0].revenue !== entry.amount) {
              await db.query(
                "UPDATE xero_revenue SET revenue = $1 WHERE userid = $2 AND date = $3 AND category = $4",
                [entry.amount, userid, formattedEndDate, entry.accountName]
              );
            }
          }

          const costofsales = extractXeroCostOfSales(response.body);
          if (costofsales && costofsales.length > 0) {
            for (const entry of costofsales) {
              const existingCostOfSales = await db.query(
                "SELECT * FROM xero_costofsales WHERE userid = $1 AND date = $2 AND category = $3",
                [userid, formattedEndDate, entry.accountName]
              );
              if (existingCostOfSales.rowCount === 0) {
                await insertCostofSales(
                  db,
                  userid,
                  costofsales,
                  formattedEndDate
                );
              } else if (
                existingCostOfSales.rows[0].costofsales !== entry.amount
              ) {
                await db.query(
                  "UPDATE xero_costofsales SET costofsales = $1 WHERE userid = $2 AND date = $3 AND category = $4",
                  [entry.amount, userid, formattedEndDate, entry.accountName]
                );
              }
            }
          }
        }
      }
    }

    await db.query(
      "UPDATE user_table SET first_time_insertion = false WHERE userid = $1",
      [userid]
    );

    extractionStatus.xero[userid] = true;

    setTimeout(() => {
      delete extractionStatus.xero[userid];
    }, 60 * 60 * 1000);
  } catch (err) {
    console.error("Error in processXeroData:", err);
    extractionStatus.xero[userid] = true;
  } finally {
    if (db) await closeDb(db);
  }
}
