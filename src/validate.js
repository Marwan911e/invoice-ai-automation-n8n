/**
 * Invoice validation rules.
 *
 * This file is the single source of truth for the "Validate extraction" Code
 * node in workflow.json. scripts/build-workflow.js inlines it into the node, and
 * test/validate.test.js runs the same function with plain Node.
 *
 * Keep it dependency-free and plain JavaScript; it has to run inside the n8n
 * Code node sandbox.
 */

const TOLERANCE = 0.02; // allow 2 cents of rounding difference

const REQUIRED_FIELDS = [
  'supplier_name',
  'invoice_number',
  'invoice_date',
  'currency',
  'net_amount',
  'vat_amount',
  'total_amount',
];

const KNOWN_VAT_RATES = [0, 5, 7, 10, 13, 16, 19, 20, 21, 22, 25];

function round2(n) {
  return Math.round(n * 100) / 100;
}

function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function formatAmount(n) {
  return typeof n === 'number' ? n.toFixed(2) : '?';
}

/**
 * @param {object|null} data  Parsed JSON returned by the model (or null if it could not be parsed)
 * @param {object} [opts]
 * @param {string} [opts.today]  ISO date used for the "date in the future" check (defaults to now)
 * @returns {{status: 'ok'|'needs_review', reasons: string[], summary: string}}
 */
function validateInvoice(data, opts) {
  const today = (opts && opts.today) || new Date().toISOString().slice(0, 10);
  const reasons = [];

  if (!data || typeof data !== 'object') {
    return {
      status: 'needs_review',
      reasons: ['model response could not be parsed as JSON'],
      summary: 'Unreadable invoice: needs manual entry',
    };
  }

  // 1. Required fields present
  for (const field of REQUIRED_FIELDS) {
    const v = data[field];
    if (v === null || v === undefined || v === '') reasons.push(`missing ${field}`);
  }

  // 2. Field formats
  if (data.invoice_date && !isIsoDate(data.invoice_date)) {
    reasons.push(`invoice_date "${data.invoice_date}" is not a valid YYYY-MM-DD date`);
  } else if (data.invoice_date && data.invoice_date > today) {
    reasons.push(`invoice_date ${data.invoice_date} is in the future`);
  }

  if (data.currency && !/^[A-Z]{3}$/.test(data.currency)) {
    reasons.push(`currency "${data.currency}" is not an ISO 4217 code`);
  }

  for (const field of ['net_amount', 'vat_amount', 'total_amount']) {
    const v = data[field];
    if (v !== null && v !== undefined && (typeof v !== 'number' || !Number.isFinite(v))) {
      reasons.push(`${field} is not a number`);
    } else if (typeof v === 'number' && v < 0) {
      reasons.push(`${field} is negative (credit note?)`);
    }
  }

  const net = data.net_amount;
  const vat = data.vat_amount;
  const total = data.total_amount;
  const haveAmounts = [net, vat, total].every((v) => typeof v === 'number' && Number.isFinite(v));

  // 3. Arithmetic: total = net + VAT
  if (haveAmounts) {
    const expected = round2(net + vat);
    if (Math.abs(expected - total) > TOLERANCE) {
      reasons.push(
        `total ${formatAmount(total)} does not equal net ${formatAmount(net)} + VAT ${formatAmount(vat)} = ${formatAmount(expected)}`
      );
    }
  }

  // 4. VAT rate consistent with the amounts
  if (typeof data.vat_rate === 'number' && typeof net === 'number' && typeof vat === 'number') {
    if (!KNOWN_VAT_RATES.includes(data.vat_rate)) {
      reasons.push(`unusual VAT rate ${data.vat_rate}%`);
    }
    const expectedVat = round2((net * data.vat_rate) / 100);
    // VAT is often rounded per line item, so allow a little more slack here
    if (Math.abs(expectedVat - vat) > Math.max(TOLERANCE, net * 0.0005)) {
      reasons.push(
        `VAT ${formatAmount(vat)} does not match ${data.vat_rate}% of net ${formatAmount(net)} (= ${formatAmount(expectedVat)})`
      );
    }
  }

  // 5. The model's own doubt counts too
  if (data.confidence === 'low') {
    reasons.push('model reported low confidence' + (data.notes ? `: ${data.notes}` : ''));
  }

  const status = reasons.length === 0 ? 'ok' : 'needs_review';
  const summary = [
    data.invoice_number || 'no number',
    data.supplier_name || 'unknown supplier',
    data.invoice_date || 'no date',
    `${formatAmount(total)} ${data.currency || ''}`.trim() + ` (net ${formatAmount(net)} + VAT ${formatAmount(vat)})`,
    status === 'ok' ? 'OK' : `REVIEW: ${reasons[0]}`,
  ].join(' | ');

  return { status, reasons, summary };
}

if (typeof module !== 'undefined') {
  module.exports = { validateInvoice, isIsoDate, TOLERANCE };
}
