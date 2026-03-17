import { getPrismaClient } from "../../config/prismaClient.js";
import xlsx from "xlsx";
import { formatDate, formatExcelDate } from "../../utils/file.js";

function toMonthRange(formattedDate) {
  const normalized = String(formattedDate).trim().replaceAll("/", "-");
  const ym = normalized.length >= 7 ? normalized.slice(0, 7) : normalized;
  const [yearStr, monthStr] = ym.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);

  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    throw new Error("Invalid formattedDate");
  }

  const start = new Date(Date.UTC(year, month - 1, 1));
  const nextMonthStart = new Date(Date.UTC(year, month, 1));
  return { start, nextMonthStart };
}

function toDbDate(value) {
  if (value instanceof Date) return value;
  const str = String(value ?? "").trim();
  if (!str) throw new Error("Invalid date");

  if (/^\d{4}[-/]\d{2}$/.test(str)) {
    return toMonthRange(str).start;
  }

  const parsed = new Date(str);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date");
  }
  return parsed;
}

export async function checkDateExistsInDb(formattedDate, req) {
  const userid = req.session.userid;
  try {
    const prisma = getPrismaClient();
    const { start, nextMonthStart } = toMonthRange(formattedDate);
    const existing = await prisma.excel_companydata.findFirst({
      where: {
        userid,
        date: {
          gte: start,
          lt: nextMonthStart,
        },
      },
      select: { id: true },
    });
    return !!existing;
  } catch (err) {
    console.error("Error checking date in the database:", err.message);
    throw err;
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
  try {
    const prisma = getPrismaClient();
    const dbDate = toDbDate(formattedDate);
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
        await prisma.excel_companydata.create({
          data: {
            userid,
            category,
            subcategory,
            amount,
            date: dbDate,
          },
        });
      }
    }
  } catch (err) {
    console.error("Error inserting data into the database:", err.message);
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
  try {
    const prisma = getPrismaClient();
    const { start, nextMonthStart } = toMonthRange(formattedDate);
    const dbDate = toDbDate(fullDate);
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
        const existing = await prisma.excel_companydata.findFirst({
          where: {
            userid,
            category,
            subcategory,
            date: {
              gte: start,
              lt: nextMonthStart,
            },
          },
          select: { id: true },
        });

        if (existing) {
          await prisma.excel_companydata.update({
            where: { id: existing.id },
            data: {
              amount,
              date: dbDate,
            },
          });
        } else {
          await prisma.excel_companydata.create({
            data: {
              userid,
              category,
              subcategory,
              amount,
              date: dbDate,
            },
          });
        }
      }
    }
  } catch (err) {
    console.error("Error updating data in the database:", err.message);
  }
}

export async function getExcelCompanyData(req, res) {
  const prisma = getPrismaClient();
  const userid = req.session.userid;
  try {
    const result = await prisma.$queryRaw`
      SELECT DATE(date) AS date,
             SUM(CASE WHEN subcategory = 'Net sales' THEN amount ELSE 0 END) AS netsales,
             SUM(CASE WHEN subcategory = 'Cost of goods sold' THEN amount ELSE 0 END) AS costofsales,
             SUM(CASE WHEN subcategory = 'Gross profit' THEN amount ELSE 0 END) AS grossprofit
      FROM excel_companydata
      WHERE category = 'TOTAL' and userid = ${userid}
      GROUP BY DATE(date)
      ORDER BY DATE(date);
    `;
    const lastEntryDate = await prisma.excel_companydata.findFirst({
      where: { userid },
      select: { date: true },
      orderBy: { date: "desc" },
    });
    res.json({
      financialData: result,
      lastEntryDate: lastEntryDate?.date || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  }
}

export async function getExcelProfitData(req, res) {
  const prisma = getPrismaClient();
  const userid = req.session.userid;
  try {
    const result = await prisma.$queryRaw`
      SELECT DATE(date) AS date,
             SUM(CASE WHEN subcategory = 'Net income' THEN amount ELSE 0 END) AS netprofit,
             SUM(CASE WHEN subcategory = 'Gross profit' THEN amount ELSE 0 END) AS grossprofit,
             SUM(CASE WHEN subcategory = 'Total expenses' THEN amount ELSE 0 END) AS expenses,
             SUM(CASE WHEN subcategory = 'Total other income' THEN amount ELSE 0 END) AS otherincome
      FROM excel_companydata
      WHERE category = 'TOTAL' and userid = ${userid}
      GROUP BY DATE(date)
      ORDER BY DATE(date);
    `;
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  }
}

export async function getExcelExpensesData(req, res) {
  const prisma = getPrismaClient();
  const userid = req.session.userid;
  try {
    const result = await prisma.excel_companydata.findMany({
      where: { userid, category: "EXPENSES" },
      select: { date: true, amount: true, subcategory: true },
    });
    const lastEntryDate = await prisma.excel_companydata.findFirst({
      where: { userid },
      select: { date: true },
      orderBy: { date: "desc" },
    });
    res.json({
      expenseData: result,
      lastEntryDate: lastEntryDate?.date || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  }
}

export async function getExcelIncomeData(req, res) {
  const prisma = getPrismaClient();
  const userid = req.session.userid;
  try {
    const result = await prisma.excel_companydata.findMany({
      where: { userid, category: "OTHER INCOME" },
      select: { date: true, amount: true, subcategory: true },
    });
    const lastEntryDate = await prisma.excel_companydata.findFirst({
      where: { userid },
      select: { date: true },
      orderBy: { date: "desc" },
    });
    res.json({
      incomeData: result,
      lastEntryDate: lastEntryDate?.date || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  }
}

export async function getExcelCostOfSalesData(req, res) {
  const prisma = getPrismaClient();
  const userid = req.session.userid;
  try {
    const result = await prisma.excel_companydata.findMany({
      where: { userid, category: "COST OF GOODS SOLD" },
      select: { date: true, amount: true, subcategory: true },
    });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  }
}
