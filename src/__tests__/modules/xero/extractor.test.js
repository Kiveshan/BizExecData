import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  extractXeroSummaryData,
  extractXeroExpenses,
  extractXeroIncome,
  extractXeroCostOfSales,
} from '../../../modules/xero/extractor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, '../../fixtures/xero-profit-and-loss.json');

/**
 * Recorded shape of `accountingApi.getReportProfitAndLoss(...).body` — a
 * standard-layout P&L with Income, Less Cost of Sales, Less Operating Expenses
 * and the two untitled sections Xero uses for Gross Profit and Net Profit.
 */
const report = JSON.parse(readFileSync(fixturePath, 'utf8'));

describe('Xero P&L normaliser', () => {
  describe('extractXeroSummaryData', () => {
    it('pulls the five headline totals off the summary rows', () => {
      expect(extractXeroSummaryData(report)).toEqual({
        totalIncome: '169650.50',
        totalCost: '55480.25',
        grossProfit: '114170.25',
        totalExpenses: '81900.00',
        netProfit: '32270.25',
      });
    });

    it('reconciles: income - cost - expenses equals net profit', () => {
      const s = extractXeroSummaryData(report);
      const net =
        Number(s.totalIncome) - Number(s.totalCost) - Number(s.totalExpenses);
      expect(net).toBeCloseTo(Number(s.netProfit), 2);
    });

    it('falls back to 0 for every total when the report has no rows', () => {
      expect(extractXeroSummaryData({ reports: [{ rows: [] }] })).toEqual({
        totalIncome: 0,
        totalExpenses: 0,
        grossProfit: 0,
        netProfit: 0,
        totalCost: 0,
      });
    });
  });

  describe('extractXeroIncome', () => {
    it('returns the income line items, excluding the summary row', () => {
      expect(extractXeroIncome(report)).toEqual([
        { accountName: 'Sales', amount: '128450.00' },
        { accountName: 'Consulting Income', amount: '41200.50' },
      ]);
    });

    it('line items sum to the reported total income', () => {
      const sum = extractXeroIncome(report).reduce(
        (acc, r) => acc + Number(r.amount),
        0
      );
      expect(sum).toBeCloseTo(Number(extractXeroSummaryData(report).totalIncome), 2);
    });
  });

  describe('extractXeroExpenses', () => {
    it('returns operating expense line items stamped with the period date', () => {
      const date = new Date('2026-03-31T00:00:00.000Z');
      expect(extractXeroExpenses(report, date)).toEqual([
        { accountName: 'Advertising', amount: '2400.00', date },
        { accountName: 'Rent', amount: '18000.00', date },
        { accountName: 'Wages and Salaries', amount: '61500.00', date },
      ]);
    });

    it('line items sum to the reported total operating expenses', () => {
      const sum = extractXeroExpenses(report, new Date()).reduce(
        (acc, r) => acc + Number(r.amount),
        0
      );
      expect(sum).toBeCloseTo(
        Number(extractXeroSummaryData(report).totalExpenses),
        2
      );
    });
  });

  describe('extractXeroCostOfSales', () => {
    it('returns the cost of sales line items', () => {
      expect(extractXeroCostOfSales(report)).toEqual([
        { accountName: 'Purchases', amount: '52300.00' },
        { accountName: 'Freight & Courier', amount: '3180.25' },
      ]);
    });

    it('returns an empty list when the section is absent', () => {
      const noCostOfSales = {
        reports: [{ rows: report.reports[0].rows.filter((r) => r.title !== 'Less Cost of Sales') }],
      };
      expect(extractXeroCostOfSales(noCostOfSales)).toEqual([]);
    });
  });
});
