import { getPrismaClient } from "../../config/prismaClient.js";
import xlsx from "xlsx";
import { formatExcelDate } from "../../utils/file.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Normalizes common subcategory names to match query expectations.
 * Keys are case-insensitive patterns, values are the normalized form.
 */
const SUBCATEGORY_NORMALIZATION = {
  // Company data totals
  'net sales': 'Net sales',
  'netsales': 'Net sales',
  'cost of goods sold': 'Cost of goods sold',
  'cogs': 'Cost of goods sold',
  'gross profit': 'Gross profit',
  'grossprofit': 'Gross profit',
  // Profit data totals  
  'net income': 'Net income',
  'netincome': 'Net income',
  'total expenses': 'Total expenses',
  'totalexpenses': 'Total expenses',
  'total other income': 'Total other income',
  'totalotherincome': 'Total other income',
  'other income': 'Total other income',
};

/**
 * The recognised category header strings (col C, no amount on the row).
 * Subcategories are inferred dynamically from the sheet — anything between
 * two recognised headers belongs to the first one.
 */
const CATEGORY_HEADERS = new Set([
  "REVENUE",
  "COST OF GOODS SOLD",
  "OTHER INCOME",
  "EXPENSES",
  "TOTAL",
]);

/**
 * Total row indicators - these rows should be assigned to TOTAL category
 * regardless of which section they appear in the Excel.
 */
const TOTAL_ROW_PATTERNS = [
  'net sales',
  'gross profit',
  'cost of goods sold',
  'total expenses',
  'total other income',
  'net income',
  'net operating income',
];

function shouldBeTotalCategory(subcategory) {
  const normalized = subcategory.toLowerCase().trim().replace(/\s+/g, ' ');
  return TOTAL_ROW_PATTERNS.includes(normalized);
}

function normalizeSubcategory(label) {
  const normalized = label.toLowerCase().trim().replace(/\s+/g, ' ');
  return SUBCATEGORY_NORMALIZATION[normalized] || label.trim();
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function toMonthRange(formattedDate) {
  const normalized = String(formattedDate).trim().replaceAll("/", "-");
  const ym = normalized.length >= 7 ? normalized.slice(0, 7) : normalized;
  const [yearStr, monthStr] = ym.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);

  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    throw new Error(`Invalid formattedDate: "${formattedDate}"`);
  }

  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    nextMonthStart: new Date(Date.UTC(year, month, 1)),
  };
}

function toDbDate(value) {
  // Already a Date (e.g. when xlsx returns a datetime object)
  if (value instanceof Date) return value;

  const str = String(value ?? "").trim();
  if (!str) throw new Error("Invalid date: empty value");

  // "YYYY-MM" or "YYYY/MM" — treat as first of that month
  if (/^\d{4}[-/]\d{2}$/.test(str)) {
    return toMonthRange(str).start;
  }

  // Excel serial numbers handled by formatExcelDate before reaching here
  const parsed = new Date(str);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid date: "${str}"`);
  return parsed;
}

// ─── Date existence check ─────────────────────────────────────────────────────

export async function checkDateExistsInDb(formattedDate, req) {
  const userid = req.session.userid;
  try {
    const prisma = getPrismaClient();
    const { start, nextMonthStart } = toMonthRange(formattedDate);
    const existing = await prisma.excel_companydata.findFirst({
      where: { userid, date: { gte: start, lt: nextMonthStart } },
      select: { id: true },
    });
    return !!existing;
  } catch (err) {
    console.error("Error checking date in the database:", err.message);
    throw err;
  }
}

// ─── Excel parsing helpers ────────────────────────────────────────────────────

/**
 * Extracts the report date from cell F3.
 * Handles both native Date objects (openpyxl-style) and Excel serial numbers.
 */
export function extractDateFromExcel(buffer) {
  const workbook = xlsx.read(buffer, { type: "buffer", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const dateCell = sheet["F3"];

  if (!dateCell) throw new Error("No date found in cell F3.");

  const raw = dateCell.v;
  if (raw instanceof Date) return raw;
  return formatExcelDate(raw);
}

/**
 * Reads the Income Statement sheet and returns structured rows:
 * [{ category, subcategory, amount }]
 *
 * Layout convention:
 *   Column C — label: either a known category header (no amount) or a subcategory
 *   Column E — manually entered input values
 *   Column F — formula-computed values (Net sales, COGS, totals, etc.)
 *
 * Category assignment is dynamic: we walk rows top-to-bottom and track the
 * most recently seen CATEGORY_HEADERS header. Every subsequent row that has
 * an amount is assigned to that category. No static subcategory list needed.
 *
 * Col F is preferred over col E so formula-computed totals are captured
 * correctly regardless of whether the file was saved with cached values.
 */
function parseIncomeStatementRows(sheet) {
  const rows = [];

  const ref = sheet["!ref"];
  if (!ref) return rows;

  const range = xlsx.utils.decode_range(ref);
  let currentCategory = null;

  for (let r = range.s.r; r <= range.e.r; r++) {
    const labelCell = sheet[xlsx.utils.encode_cell({ r, c: 2 })]; // col C
    if (!labelCell || typeof labelCell.v !== "string") continue;

    const label = labelCell.v.trim();
    if (!label) continue;

    // Check if this row is a category header (uppercase, no amount columns)
    if (CATEGORY_HEADERS.has(label.toUpperCase())) {
      currentCategory = label.toUpperCase();
      continue;
    }

    // No category seen yet — skip until we hit the first header
    if (!currentCategory) continue;

    const colECell = sheet[xlsx.utils.encode_cell({ r, c: 4 })]; // col E
    const colFCell = sheet[xlsx.utils.encode_cell({ r, c: 5 })]; // col F

    const colFValue = colFCell && typeof colFCell.v === "number" ? colFCell.v : null;
    const colEValue = colECell && typeof colECell.v === "number" ? colECell.v : null;

    const amount = colFValue ?? colEValue;
    if (amount === null) continue;

    const normalizedSubcategory = normalizeSubcategory(label);
    // Summary/total rows go to TOTAL category regardless of current section
    const finalCategory = shouldBeTotalCategory(normalizedSubcategory) ? "TOTAL" : currentCategory;
    rows.push({ category: finalCategory, subcategory: normalizedSubcategory, amount });
  }

  return rows;
}

// ─── Public file processors ───────────────────────────────────────────────────

export async function processExcelFile(buffer, req) {
  const workbook = xlsx.read(buffer, { type: "buffer", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  const dateCell = sheet["F3"];
  if (!dateCell) throw new Error("No date found in cell F3.");

  // Accept native Date or fall back to formatExcelDate for serial numbers
  const fileDate =
    dateCell.v instanceof Date ? dateCell.v : formatExcelDate(dateCell.v);

  const rows = parseIncomeStatementRows(sheet);
  await processFinancialData(rows, req, fileDate);
}

export async function processTxtFile(content, req) {
  // TXT files don't have category headers - we need to extract date from content
  // For now, use current date as fallback
  const fileDate = new Date();

  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  // TXT files: split on 2+ spaces, first string = subcategory, first number = amount
  // All TXT entries go to EXPENSES category (or could be configurable)
  const rows = lines.flatMap((line) => {
    const parts = line.split(/\s{2,}/);
    const subcategory = parts.find((p) => isNaN(Number(p)))?.trim();
    const amount = parseFloat(parts.find((p) => !isNaN(Number(p)) && p !== ""));
    if (!subcategory || isNaN(amount)) return [];
    return [{ category: "EXPENSES", subcategory, amount }];
  });

  await processFinancialData(rows, req, fileDate);
}

export async function processAmendedExcelFile(buffer, req) {
  const workbook = xlsx.read(buffer, { type: "buffer", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  const dateCell = sheet["F3"];
  if (!dateCell) throw new Error("No date found in cell F3.");

  const fileDate =
    dateCell.v instanceof Date ? dateCell.v : formatExcelDate(dateCell.v);

  const rows = parseIncomeStatementRows(sheet);
  await amendFinancialData(rows, req, fileDate);
}

// ─── Database writers ─────────────────────────────────────────────────────────

async function processFinancialData(rows, req, fileDate) {
  const userid = req.session.userid;
  const prisma = getPrismaClient();

  let dbDate;
  try {
    dbDate = toDbDate(fileDate);
  } catch (err) {
    throw new Error(`Cannot persist financial data: ${err.message}`);
  }

  const inserts = rows.map(({ category, subcategory, amount }) => ({
    userid,
    category,
    subcategory,
    amount,
    date: dbDate,
  }));

  if (inserts.length === 0) return;

  try {
    await prisma.excel_companydata.createMany({ data: inserts });
  } catch (err) {
    console.error("Error inserting financial data:", err.message);
    throw err;
  }
}

async function amendFinancialData(rows, req, fileDate) {
  const userid = req.session.userid;
  const prisma = getPrismaClient();

  let dbDate, start, nextMonthStart;
  try {
    dbDate = toDbDate(fileDate);
    const monthStr =
      fileDate instanceof Date
        ? `${fileDate.getUTCFullYear()}-${String(fileDate.getUTCMonth() + 1).padStart(2, "0")}`
        : fileDate;
    ({ start, nextMonthStart } = toMonthRange(monthStr));
  } catch (err) {
    throw new Error(`Cannot amend financial data: ${err.message}`);
  }

  // Track which subcategories are in the new Excel file
  const subcategoriesInExcel = new Set(rows.map(r => r.subcategory));

  const ops = rows.map(({ category, subcategory, amount }) =>
    prisma.excel_companydata
      .findFirst({
        where: {
          userid,
          category,
          subcategory,
          date: { gte: start, lt: nextMonthStart },
        },
        select: { id: true },
      })
      .then((existing) => {
        if (existing) {
          return prisma.excel_companydata.update({
            where: { id: existing.id },
            data: { amount, date: dbDate },
          });
        }
        return prisma.excel_companydata.create({
          data: { userid, category, subcategory, amount, date: dbDate },
        });
      })
  );

  try {
    await Promise.all(ops);

    // Delete records that exist in DB but not in the new Excel file
    await prisma.excel_companydata.deleteMany({
      where: {
        userid,
        date: { gte: start, lt: nextMonthStart },
        subcategory: { notIn: Array.from(subcategoriesInExcel) },
      },
    });
  } catch (err) {
    console.error("Error upserting or deleting financial data:", err.message);
    throw err;
  }
}

// ─── Query helpers ────────────────────────────────────────────────────────────

export async function getExcelCompanyData(req, res) {
  const prisma = getPrismaClient();
  const userid = req.session.userid;
  try {
    const records = await prisma.excel_companydata.findMany({
      where: { userid, category: 'TOTAL' },
      select: { date: true, subcategory: true, amount: true },
    });

    const groupedByDate = {};
    records.forEach(({ date, subcategory, amount }) => {
      const dateKey = new Date(date).toISOString().split('T')[0];
      if (!groupedByDate[dateKey]) {
        groupedByDate[dateKey] = { date: dateKey, netsales: 'R0.00', costofsales: 'R0.00', grossprofit: 'R0.00' };
      }
      const formattedAmount = `R${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      if (subcategory === 'Net sales') groupedByDate[dateKey].netsales = formattedAmount;
      else if (subcategory === 'Cost of goods sold') groupedByDate[dateKey].costofsales = formattedAmount;
      else if (subcategory === 'Gross profit') groupedByDate[dateKey].grossprofit = formattedAmount;
    });

    const result = Object.values(groupedByDate).sort((a, b) => new Date(a.date) - new Date(b.date));
    const lastEntryDate = await prisma.excel_companydata.findFirst({
      where: { userid },
      select: { date: true },
      orderBy: { date: "desc" },
    });
    res.json({ financialData: result, lastEntryDate: lastEntryDate?.date || null });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  }
}

export async function getExcelProfitData(req, res) {
  const prisma = getPrismaClient();
  const userid = req.session.userid;
  try {
    const records = await prisma.excel_companydata.findMany({
      where: { userid, category: 'TOTAL' },
      select: { date: true, subcategory: true, amount: true },
    });

    const groupedByDate = {};
    records.forEach(({ date, subcategory, amount }) => {
      const dateKey = new Date(date).toISOString().split('T')[0];
      if (!groupedByDate[dateKey]) {
        groupedByDate[dateKey] = { date: dateKey, netprofit: 'R0.00', grossprofit: 'R0.00', expenses: 'R0.00', otherincome: 'R0.00' };
      }
      const formattedAmount = `R${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      if (subcategory === 'Net income') groupedByDate[dateKey].netprofit = formattedAmount;
      else if (subcategory === 'Gross profit') groupedByDate[dateKey].grossprofit = formattedAmount;
      else if (subcategory === 'Total expenses') groupedByDate[dateKey].expenses = formattedAmount;
      else if (subcategory === 'Total other income') groupedByDate[dateKey].otherincome = formattedAmount;
    });

    const result = Object.values(groupedByDate).sort((a, b) => new Date(a.date) - new Date(b.date));
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
    res.json({ expenseData: result, lastEntryDate: lastEntryDate?.date || null });
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
    res.json({ incomeData: result, lastEntryDate: lastEntryDate?.date || null });
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
