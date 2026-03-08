const test = require('node:test');
const assert = require('node:assert/strict');
const { validateInvoice } = require('../src/validate');
const fixtures = require('./fixtures/extractions.json');

const TODAY = '2026-03-08';
const good = fixtures['invoice-001-nordwind-buerobedarf.txt'];

test('the four correct sample invoices pass', () => {
  for (const file of [
    'invoice-001-nordwind-buerobedarf.txt',
    'invoice-002-cloudhafen-hosting.txt',
    'invoice-003-gruenwerk-catering.txt',
    'invoice-005-alpenblick-logistik.txt',
  ]) {
    const result = validateInvoice(fixtures[file], { today: TODAY });
    assert.equal(result.status, 'ok', `${file}: ${result.reasons.join('; ')}`);
  }
});

test('invoice 004 (wrong total) goes to review', () => {
  const result = validateInvoice(fixtures['invoice-004-elektro-brandt.txt'], { today: TODAY });
  assert.equal(result.status, 'needs_review');
  assert.match(result.reasons[0], /total 1656\.04 does not equal .* = 1566\.04/);
  assert.match(result.summary, /REVIEW/);
});

test('rounding differences up to 2 cents are accepted', () => {
  const result = validateInvoice({ ...good, total_amount: 813.85 }, { today: TODAY });
  assert.equal(result.status, 'ok');
});

test('missing required fields are reported', () => {
  const result = validateInvoice({ ...good, invoice_number: null, supplier_name: '' }, { today: TODAY });
  assert.equal(result.status, 'needs_review');
  assert.deepEqual(result.reasons, ['missing supplier_name', 'missing invoice_number']);
});

test('VAT amount must match the VAT rate', () => {
  const result = validateInvoice({ ...good, vat_rate: 7 }, { today: TODAY });
  assert.equal(result.status, 'needs_review');
  assert.match(result.reasons.join(' '), /does not match 7% of net/);
});

test('invalid and future dates are rejected', () => {
  assert.match(
    validateInvoice({ ...good, invoice_date: '04.02.2026' }, { today: TODAY }).reasons[0],
    /not a valid YYYY-MM-DD/
  );
  assert.match(
    validateInvoice({ ...good, invoice_date: '2026-02-30' }, { today: TODAY }).reasons[0],
    /not a valid YYYY-MM-DD/
  );
  assert.match(
    validateInvoice({ ...good, invoice_date: '2027-01-01' }, { today: TODAY }).reasons[0],
    /in the future/
  );
});

test('amounts that are strings or negative are rejected', () => {
  const result = validateInvoice({ ...good, net_amount: '683,90', vat_amount: -1 }, { today: TODAY });
  assert.equal(result.status, 'needs_review');
  assert.ok(result.reasons.includes('net_amount is not a number'));
  assert.ok(result.reasons.some((r) => r.startsWith('vat_amount is negative')));
});

test('low model confidence always goes to review', () => {
  const result = validateInvoice({ ...good, confidence: 'low', notes: 'scan is blurry' }, { today: TODAY });
  assert.equal(result.status, 'needs_review');
  assert.deepEqual(result.reasons, ['model reported low confidence: scan is blurry']);
});

test('unparseable model output goes to review', () => {
  const result = validateInvoice(null);
  assert.equal(result.status, 'needs_review');
});

test('summary is a single line', () => {
  const { summary } = validateInvoice(good, { today: TODAY });
  assert.equal(
    summary,
    'RE-2026-00418 | Nordwind Bürobedarf GmbH | 2026-02-04 | 813.84 EUR (net 683.90 + VAT 129.94) | OK'
  );
  assert.ok(!summary.includes('\n'));
});
