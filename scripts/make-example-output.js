#!/usr/bin/env node
/**
 * Regenerates output-example.csv and needs-review-example.csv by running the
 * validation step on the reference extractions in test/fixtures/extractions.json.
 * The columns match exactly what the n8n workflow writes.
 */
const fs = require('fs');
const path = require('path');
const { validateInvoice } = require('../src/validate');

const root = path.join(__dirname, '..');
const fixtures = require('../test/fixtures/extractions.json');
const PROCESSED_AT = '2026-03-08T15:42:10.000Z';

const COLUMNS = [
  'file_name', 'supplier_name', 'supplier_vat_id', 'invoice_number', 'invoice_date', 'currency',
  'net_amount', 'vat_rate', 'vat_amount', 'total_amount', 'confidence', 'status',
  'review_reasons', 'summary', 'processed_at',
];

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows) =>
  [COLUMNS.join(','), ...rows.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n';

const ok = [];
const review = [];
for (const [file, data] of Object.entries(fixtures)) {
  if (file.startsWith('_')) continue;
  const result = validateInvoice(data, { today: PROCESSED_AT.slice(0, 10) });
  const row = {
    file_name: file,
    ...data,
    status: result.status,
    review_reasons: result.reasons.join('; '),
    summary: result.summary,
    processed_at: PROCESSED_AT,
  };
  (result.status === 'ok' ? ok : review).push(row);
}

fs.writeFileSync(path.join(root, 'output-example.csv'), toCsv(ok));
fs.writeFileSync(path.join(root, 'needs-review-example.csv'), toCsv(review));
console.log(`output-example.csv: ${ok.length} rows, needs-review-example.csv: ${review.length} rows`);
