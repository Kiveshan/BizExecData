import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import jsonpath from 'jsonpath';
import { findFinancialData } from '../../../modules/quickbooks/extractor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(
  __dirname,
  '../../fixtures/quickbooks-profit-and-loss.json'
);

/** Recorded shape of a QuickBooks Online `reports/ProfitAndLoss` response. */
const report = JSON.parse(readFileSync(fixturePath, 'utf8'));

const USERID = 42;
const DATE = '2026-03-31';

/** Stands in for upsertRevenue/upsertCOGS/upsertExpenses. */
function collector() {
  const calls = [];
  const fn = async (category, amount, userid, date) => {
    calls.push({ category, amount, userid, date });
  };
  fn.calls = calls;
  return fn;
}

/** Mirrors how the extractor selects a section before walking it. */
function sectionsForGroup(group) {
  return jsonpath.query(report, `$.Rows.Row[?(@.group == "${group}")]`);
}

describe('QuickBooks P&L normaliser', () => {
  describe('findFinancialData', () => {
    it('collects the income line items', async () => {
      const upsert = collector();
      await findFinancialData(sectionsForGroup('Income'), USERID, DATE, upsert);

      expect(upsert.calls).toEqual([
        { category: 'Design income', amount: '2250.00', userid: USERID, date: DATE },
        { category: 'Landscaping Services', amount: '1477.50', userid: USERID, date: DATE },
        { category: 'Sales of Product Income', amount: '912.75', userid: USERID, date: DATE },
      ]);
    });

    it('collects the COGS line items', async () => {
      const upsert = collector();
      await findFinancialData(sectionsForGroup('COGS'), USERID, DATE, upsert);

      expect(upsert.calls.map((c) => [c.category, c.amount])).toEqual([
        ['Cost of Goods Sold', '405.00'],
        ['Supplies & Materials - COGS', '310.50'],
      ]);
    });

    it('collects the other-income line items', async () => {
      const upsert = collector();
      await findFinancialData(sectionsForGroup('OtherIncome'), USERID, DATE, upsert);

      expect(upsert.calls.map((c) => [c.category, c.amount])).toEqual([
        ['Interest Earned', '42.10'],
      ]);
    });

    it('descends into nested expense sub-sections', async () => {
      const upsert = collector();
      await findFinancialData(sectionsForGroup('Expenses'), USERID, DATE, upsert);

      // "Job Materials" only appears inside the nested "Job Expenses" section.
      expect(upsert.calls.map((c) => [c.category, c.amount])).toEqual([
        ['Advertising', '74.86'],
        ['Automobile', '113.96'],
        ['Job Materials', '112.50'],
      ]);
    });

    it('skips section headers, whose amount cell is empty', async () => {
      const upsert = collector();
      await findFinancialData(sectionsForGroup('Income'), USERID, DATE, upsert);

      expect(upsert.calls.map((c) => c.category)).not.toContain('Income');
    });

    it('ignores Summary rows so totals are not double counted as line items', async () => {
      const upsert = collector();
      await findFinancialData(sectionsForGroup('Income'), USERID, DATE, upsert);

      expect(upsert.calls.map((c) => c.category)).not.toContain('Total Income');

      // Line items therefore still reconcile against the section summary.
      const sum = upsert.calls.reduce((acc, c) => acc + Number(c.amount), 0);
      const summary = report.Rows.Row.find((r) => r.group === 'Income').Summary;
      expect(sum).toBeCloseTo(Number(summary.ColData[1].value), 2);
    });

    it('is a no-op for an empty selection', async () => {
      const upsert = collector();
      await findFinancialData([], USERID, DATE, upsert);
      expect(upsert.calls).toEqual([]);
    });

    it('tolerates null and primitive nodes', async () => {
      const upsert = collector();
      await findFinancialData([null, 'x', 7, undefined], USERID, DATE, upsert);
      expect(upsert.calls).toEqual([]);
    });
  });
});
