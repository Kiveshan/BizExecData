import { connectDb, closeDb } from "../../config/database.js";
import xlsx from "xlsx";
import { formatDate, formatExcelDate } from "../../utils/file.js";

export async function checkDateExistsInDb(formattedDate, req) {
  const userid = req.session.userid;
  let db = await connectDb();
  try {
    const checkQuery = {
      text: `SELECT 1 FROM excel_companydata WHERE userid = $1 AND date::TEXT LIKE $2 LIMIT 1`,
      values: [userid, `${formattedDate}%`],
    };
    const result = await db.query(checkQuery);
    return result.rowCount > 0;
  } catch (err) {
    console.error("Error checking date in the database:", err.message);
    throw err;
  } finally {
    await closeDb(db);
  }
}

export function extractDateFromExcel(buffer) {
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const dateCell = sheet["F3"];

  if (!dateCell) {
    throw new Error("No date found in cell F3.");
  }

  const rawDate = dateCell.v;
  return formatExcelDate(rawDate);
}

export async function processExcelFile(buffer, req, res) {
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const dateCell = sheet["F3"];
  let rawDate = dateCell ? dateCell.v : null;

  if (rawDate) {
    let formattedDate = formatExcelDate(rawDate);
    let jsonData = xlsx.utils.sheet_to_json(sheet, { header: 1 });
    jsonData = jsonData
      .filter((row) =>
        row.some(
          (cell) =>
            cell !== undefined && cell !== null && cell.toString().trim() !== ""
        )
      )
      .map((row) =>
        row.map((cell) =>
          cell !== undefined && cell !== null ? cell.toString().trim() : ""
        )
      )
      .filter((row) => row.length > 2);

    await processFinancialData(jsonData, req, formattedDate);
  }
}

export async function processTxtFile(content, req) {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

  const parsedData = lines.map((line) => line.split(/\s{2,}/));
  await processFinancialData(parsedData, req);
}

async function processFinancialData(data, req, formattedDate) {
  const userid = req.session.userid;
  let db = await connectDb();
  try {
    const categoryMap = {
      REVENUE: ["Gross sales"],
      "COST OF GOODS SOLD": [
        "Beginning inventory",
        "Add: Purchases",
        "Freight-in",
        "Direct labor",
        "Indirect expenses",
        "Less: ending inventory",
      ],
      "OTHER INCOME": ["Gain on sale of assets", "Interest income"],
      EXPENSES: [
        "Advertising",
        "Amortization",
        "Bad debts",
        "Bank charges",
        "Charitable contributions",
        "Commissions",
        "Contract labor",
        "Depreciation",
        "Dues and subscriptions",
        "Employee benefit programs",
        "Insurance",
        "Interest",
        "Legal and professional fees",
        "Licenses and fees",
        "Miscellaneous",
        "Office expenses",
        "Payroll taxes",
        "Postage",
        "Rent",
        "Repairs and maintenance",
        "Supplies",
        "Telephone",
        "Travel",
        "Utilities",
        "Vehicle expenses",
        "Wages",
      ],
      TOTAL: [
        "Total Other Income",
        "Total expenses",
        "Cost of goods sold",
        "Net income",
        "Gross profit",
        "Net sales",
      ],
    };

    for (let row of data) {
      if (!row || row.length < 2) continue;

      const subcategory = row.find((cell) => typeof cell === "string")?.trim();
      const amount = parseFloat(
        row.find((cell) => !isNaN(cell) && cell !== null && cell !== undefined)
      );

      if (!subcategory || isNaN(amount)) continue;

      let category = "";
      for (let cat in categoryMap) {
        if (
          categoryMap[cat].some((subcat) =>
            new RegExp(subcat, "i").test(subcategory)
          )
        ) {
          category = cat;
          break;
        }
      }

      if (category) {
        const insertQuery = {
          text: `INSERT INTO excel_companydata (userid, category, subcategory, amount, date)
                        VALUES ($1, $2, $3, $4, $5)`,
          values: [userid, category, subcategory, amount, formattedDate],
        };
        await db.query(insertQuery);
      }
    }
  } catch (err) {
    console.error("Error inserting data into the database:", err.message);
  } finally {
    await closeDb(db);
  }
}

export async function processAmendedExcelFile(buffer, req, res) {
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const dateCell = sheet["F3"];
  let rawDate = dateCell ? dateCell.v : null;

  if (rawDate) {
    let formattedDate = formatExcelDate(rawDate);
    const [DBfileYear, DBfileMonth] = formattedDate.split("/");
    const formattedFileDate = `${DBfileYear}-${DBfileMonth}`;

    let jsonData = xlsx.utils.sheet_to_json(sheet, { header: 1 });
    jsonData = jsonData
      .filter((row) =>
        row.some(
          (cell) =>
            cell !== undefined && cell !== null && cell.toString().trim() !== ""
        )
      )
      .map((row) =>
        row.map((cell) =>
          cell !== undefined && cell !== null ? cell.toString().trim() : ""
        )
      )
      .filter((row) => row.length > 2);

    await amendFinancialData(jsonData, req, formattedFileDate, formattedDate);
  }
}

async function amendFinancialData(data, req, formattedDate, fullDate) {
  const userid = req.session.userid;
  let db = await connectDb();
  try {
    const categoryMap = {
      REVENUE: ["Gross sales"],
      "COST OF GOODS SOLD": [
        "Beginning inventory",
        "Add: Purchases",
        "Freight-in",
        "Direct labor",
        "Indirect expenses",
        "Less: ending inventory",
      ],
      "OTHER INCOME": ["Gain on sale of assets", "Interest income"],
      EXPENSES: [
        "Advertising",
        "Amortization",
        "Bad debts",
        "Bank charges",
        "Charitable contributions",
        "Commissions",
        "Contract labor",
        "Depreciation",
        "Dues and subscriptions",
        "Employee benefit programs",
        "Insurance",
        "Interest",
        "Legal and professional fees",
        "Licenses and fees",
        "Miscellaneous",
        "Office expenses",
        "Payroll taxes",
        "Postage",
        "Rent",
        "Repairs and maintenance",
        "Supplies",
        "Telephone",
        "Travel",
        "Utilities",
        "Vehicle expenses",
        "Wages",
      ],
      TOTAL: [
        "Total Other Income",
        "Total expenses",
        "Cost of goods sold",
        "Net income",
        "Gross profit",
        "Net sales",
      ],
    };

    for (let row of data) {
      if (!row || row.length < 2) continue;

      const subcategory = row.find((cell) => typeof cell === "string")?.trim();
      const amount = parseFloat(
        row.find((cell) => !isNaN(cell) && cell !== null && cell !== undefined)
      );

      if (!subcategory || isNaN(amount)) continue;

      let category = "";
      for (let cat in categoryMap) {
        if (
          categoryMap[cat].some((subcat) =>
            new RegExp(subcat, "i").test(subcategory)
          )
        ) {
          category = cat;
          break;
        }
      }

      if (category) {
        const existingQuery = {
          text: `SELECT * FROM excel_companydata WHERE userid = $1 AND category = $2 AND subcategory = $3 AND date::TEXT LIKE $4`,
          values: [userid, category, subcategory, `${formattedDate}%`],
        };

        const existingRecord = await db.query(existingQuery);

        if (existingRecord.rows.length > 0) {
          const updateQuery = {
            text: `UPDATE excel_companydata 
                              SET amount = $1, date = $5 
                              WHERE userid = $2 AND category = $3 AND subcategory = $4 AND date::TEXT LIKE $6`,
            values: [amount, userid, category, subcategory, fullDate, `${formattedDate}%`],
          };
          await db.query(updateQuery);
        } else {
          const insertQuery = {
            text: `INSERT INTO excel_companydata (userid, category, subcategory, amount, date)
                              VALUES ($1, $2, $3, $4, $5)`,
            values: [userid, category, subcategory, amount, fullDate],
          };
          await db.query(insertQuery);
        }
      }
    }
  } catch (err) {
    console.error("Error updating data in the database:", err.message);
  } finally {
    await closeDb(db);
  }
}

export async function getExcelCompanyData(req, res) {
  const db = await connectDb();
  const userid = req.session.userid;
  try {
    const result = await db.query(
      `
      SELECT DATE(date) AS date,
             SUM(CASE WHEN subcategory = 'Net sales' THEN amount ELSE 0 END) AS netsales,
             SUM(CASE WHEN subcategory = 'Cost of goods sold' THEN amount ELSE 0 END) AS costofsales,
             SUM(CASE WHEN subcategory = 'Gross profit' THEN amount ELSE 0 END) AS grossprofit
      FROM excel_companydata 
      WHERE category = 'TOTAL' and userid = $1
      GROUP BY DATE(date)
      ORDER BY DATE(date);
    `,
      [userid]
    );
    const lastEntryDate = await db.query(
      `SELECT date FROM excel_companydata WHERE userid = $1 GROUP BY date ORDER BY date DESC LIMIT 1`,
      [userid]
    );
    res.json({
      financialData: result.rows,
      lastEntryDate: lastEntryDate.rows[0]?.date || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  } finally {
    await closeDb(db);
  }
}

export async function getExcelProfitData(req, res) {
  const db = await connectDb();
  const userid = req.session.userid;
  try {
    const result = await db.query(
      `
      SELECT DATE(date) AS date,
             SUM(CASE WHEN subcategory = 'Net income' THEN amount ELSE 0 END) AS netprofit,
             SUM(CASE WHEN subcategory = 'Gross profit' THEN amount ELSE 0 END) AS grossprofit,
             SUM(CASE WHEN subcategory = 'Total expenses' THEN amount ELSE 0 END) AS expenses,
             SUM(CASE WHEN subcategory = 'Total other income' THEN amount ELSE 0 END) AS otherincome
     FROM excel_companydata 
     WHERE category = 'TOTAL' and userid = $1
     GROUP BY DATE(date)
     ORDER BY DATE(date);
   `,
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

export async function getExcelExpensesData(req, res) {
  const db = await connectDb();
  const userid = req.session.userid;
  try {
    const result = await db.query(
      `SELECT date, amount, subcategory FROM excel_companydata WHERE category = 'EXPENSES' and userid = $1`,
      [userid]
    );
    const lastEntryDate = await db.query(
      `SELECT date FROM excel_companydata WHERE userid = $1 GROUP BY date ORDER BY date DESC LIMIT 1`,
      [userid]
    );
    res.json({
      expenseData: result.rows,
      lastEntryDate: lastEntryDate.rows[0]?.date || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  } finally {
    await closeDb(db);
  }
}

export async function getExcelIncomeData(req, res) {
  const db = await connectDb();
  const userid = req.session.userid;
  try {
    const result = await db.query(
      `SELECT date, amount, subcategory FROM excel_companydata WHERE category = 'OTHER INCOME' and userid = $1`,
      [userid]
    );
    const lastEntryDate = await db.query(
      `SELECT date FROM excel_companydata WHERE userid = $1 GROUP BY date ORDER BY date DESC LIMIT 1`,
      [userid]
    );
    res.json({
      incomeData: result.rows,
      lastEntryDate: lastEntryDate.rows[0]?.date || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  } finally {
    await closeDb(db);
  }
}

export async function getExcelCostOfSalesData(req, res) {
  const db = await connectDb();
  const userid = req.session.userid;
  try {
    const result = await db.query(
      `SELECT date, amount, subcategory FROM excel_companydata WHERE category = 'COST OF GOODS SOLD' and userid = $1`,
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
