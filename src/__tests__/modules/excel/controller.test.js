import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import xlsx from 'xlsx';
import {
  parseIncomeStatementRows,
  extractDateFromExcel,
} from '../../../modules/excel/controller.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The committed upload template doubles as the fixture — it is the exact
 * workbook shape users are told to fill in, so the parser is tested against
 * the real layout rather than a hand-rolled approximation.
 */
const templatePath = path.join(__dirname, '../../../../uploads/IS1.xlsx');
const workbook = xlsx.read(readFileSync(templatePath), {
  type: 'buffer',
  cellDates: true,
});
const sheet = workbook.Sheets[workbook.SheetNames[0]];

const rows = parseIncomeStatementRows(sheet);
const bySubcategory = Object.fromEntries(
  rows.map((r) => [r.subcategory, r])
);
const inCategory = (category) =>
  rows.filter((r) => r.category === category).map((r) => r.subcategory);

describe('Excel income-statement normaliser', () => {
  describe('parseIncomeStatementRows', () => {
    it('assigns line items to the section header above them', () => {
      expect(inCategory('REVENUE')).toEqual([
        'Gross sales',
        'Less: sales returns and allowances',
      ]);
      expect(inCategory('OTHER INCOME')).toEqual([
        'Gain on sale of assets',
        'Interest income',
      ]);
      expect(inCategory('COST OF GOODS SOLD')).toEqual([
        'Beginning inventory',
        'Add: Purchases',
        'Freight-in',
        'Direct labor',
        'Indirect expenses',
        'Inventory available',
        'Less: ending inventory',
      ]);
    });

    it('reclassifies summary rows to TOTAL regardless of their section', () => {
      expect(inCategory('TOTAL')).toEqual([
        'Net sales',
        'Cost of goods sold',
        'Gross profit',
        'Total expenses',
        'Net operating income',
        'Total other income',
        'Net income',
      ]);
    });

    it('captures the COGS total, whose label collides with its section header', () => {
      // Regression: "Cost of goods sold" upper-cases to the COST OF GOODS SOLD
      // section header. Treating it as a header dropped the total, and the
      // company dashboard reads exactly this subcategory for cost of sales.
      expect(bySubcategory['Cost of goods sold']).toEqual({
        category: 'TOTAL',
        subcategory: 'Cost of goods sold',
        amount: 73000,
      });
    });

    it('normalises label casing and stray whitespace', () => {
      // Sheet cell reads "Gross profit " with a trailing space.
      expect(bySubcategory['Gross profit'].amount).toBe(517000);
      expect(rows.every((r) => r.subcategory === r.subcategory.trim())).toBe(true);
    });

    it('prefers the formula column (F) over the input column (E)', () => {
      // Net sales is computed in F; only the gross/returns inputs live in E.
      expect(bySubcategory['Net sales'].amount).toBe(590000);
      expect(bySubcategory['Gross sales'].amount).toBe(600000);
    });

    it('skips the title block above the first section header', () => {
      // Row 3 holds the company name in C and the report date in F.
      expect(rows.map((r) => r.subcategory)).not.toContain('Quinn Campbell');
      expect(rows.map((r) => r.subcategory)).not.toContain('Income Statement');
    });

    it('produces totals that reconcile against their line items', () => {
      const revenue = rows
        .filter((r) => r.category === 'REVENUE')
        .reduce((acc, r) => acc + r.amount, 0);
      // Gross sales less returns and allowances.
      expect(600000 - 10000).toBe(bySubcategory['Net sales'].amount);
      expect(revenue).toBe(610000);

      const expenses = rows
        .filter((r) => r.category === 'EXPENSES')
        .reduce((acc, r) => acc + r.amount, 0);
      expect(expenses).toBe(bySubcategory['Total expenses'].amount);

      const otherIncome = rows
        .filter((r) => r.category === 'OTHER INCOME')
        .reduce((acc, r) => acc + r.amount, 0);
      expect(otherIncome).toBe(bySubcategory['Total other income'].amount);

      expect(
        bySubcategory['Net sales'].amount - bySubcategory['Cost of goods sold'].amount
      ).toBe(bySubcategory['Gross profit'].amount);
    });

    it('returns nothing for an empty sheet', () => {
      expect(parseIncomeStatementRows({})).toEqual([]);
      expect(parseIncomeStatementRows(xlsx.utils.aoa_to_sheet([[]]))).toEqual([]);
    });

    it('treats a known label as a header only when the row carries no amount', () => {
      // Columns: C = label (index 2), E = input (4), F = formula (5).
      const synthetic = xlsx.utils.aoa_to_sheet([
        ['', '', 'COST OF GOODS SOLD', '', '', ''],
        ['', '', 'Beginning inventory', '', 500, ''],
        ['', '', 'Cost of goods sold', '', '', 1200],
      ]);

      expect(parseIncomeStatementRows(synthetic)).toEqual([
        {
          category: 'COST OF GOODS SOLD',
          subcategory: 'Beginning inventory',
          amount: 500,
        },
        { category: 'TOTAL', subcategory: 'Cost of goods sold', amount: 1200 },
      ]);
    });
  });

  describe('extractDateFromExcel', () => {
    it('returns F3 as-is when the cell is a real date', () => {
      // The template formats F3 as a date, so xlsx hands back a Date object.
      const date = extractDateFromExcel(readFileSync(templatePath));
      expect(date).toBeInstanceOf(Date);
      expect(date.getUTCFullYear()).toBe(2025);
      expect(date.getUTCMonth()).toBe(7); // August
    });

    it('converts an unformatted F3 serial number to a YYYY/MM/DD string', () => {
      const wb = xlsx.utils.book_new();
      const ws = xlsx.utils.aoa_to_sheet([
        [],
        [],
        ['', '', 'Quinn Campbell', '', '', 45882],
      ]);
      xlsx.utils.book_append_sheet(wb, ws, 'Income statement');
      const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

      const date = extractDateFromExcel(buffer);
      expect(typeof date).toBe('string');
      expect(date).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
      // Serial 45882 falls in August 2025; the exact day can shift by one with
      // the runner's timezone, so only the year and month are pinned here.
      expect(date.slice(0, 7)).toBe('2025/08');
    });

    it('throws when F3 is empty', () => {
      const empty = xlsx.write(
        (() => {
          const wb = xlsx.utils.book_new();
          xlsx.utils.book_append_sheet(
            wb,
            xlsx.utils.aoa_to_sheet([['x']]),
            'Income statement'
          );
          return wb;
        })(),
        { type: 'buffer', bookType: 'xlsx' }
      );

      expect(() => extractDateFromExcel(empty)).toThrow(/No date found in cell F3/);
    });
  });
});
