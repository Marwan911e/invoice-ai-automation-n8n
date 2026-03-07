#!/usr/bin/env node
/**
 * Generates workflow.json from the files in src/ and prompts/.
 *
 * The workflow is edited here (not by hand in the JSON) so that the prompt, the
 * JSON schema and the validation rules live in normal, diffable, testable files.
 * Run `npm run build` after changing any of them, then re-import workflow.json in n8n.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const MODEL = 'claude-opus-5-5';
const INBOX = '/files/inbox';
const OUTPUT = '/files/output';

const systemPrompt = read('prompts/system-prompt.md').trim();
const schema = JSON.parse(read('prompts/invoice-schema.json'));
const validateSource = read('src/validate.js')
  .replace(/if \(typeof module !== 'undefined'\) \{[\s\S]*?\n\}\n?$/, '')
  .trim();

// ---------------------------------------------------------------------------
// Code node bodies
// ---------------------------------------------------------------------------

const txtToText = `// Decode the uploaded .txt file into a string
const buffer = await this.helpers.getBinaryDataBuffer($itemIndex, 'data');
const meta = $input.item.binary.data;
return {
  json: {
    fileName: meta.fileName,
    source: 'folder',
    text: buffer.toString('utf8'),
  },
};`;

const pdfToText = `// Extract From File (PDF) puts the text in $json.text; take the file name from the read step
const meta = $('Read inbox files').item.binary.data;
const text = ($json.text || '').trim();
return {
  json: {
    fileName: meta.fileName,
    source: 'folder',
    // Scanned PDFs have no text layer. Keep them in the flow so they land in "needs review".
    text: text || '[no text layer found: scanned PDF, needs OCR]',
  },
};`;

const validateNode = `${validateSource}

// ---------------------------------------------------------------------------
// n8n glue: parse the Claude response, validate, and shape one output row
// ---------------------------------------------------------------------------
const input = $('Prepare Claude request').item.json;
const response = $json;

let data = null;
let apiProblem = null;

if (response.error) {
  apiProblem = 'API error: ' + (response.error.message || JSON.stringify(response.error));
} else if (response.stop_reason === 'refusal') {
  apiProblem = 'model declined the request';
} else if (response.stop_reason === 'max_tokens') {
  apiProblem = 'model output was cut off (max_tokens)';
} else {
  const textBlock = (response.content || []).find((block) => block.type === 'text');
  try {
    data = JSON.parse(textBlock.text);
  } catch (e) {
    apiProblem = 'model response was not valid JSON';
  }
}

const result = validateInvoice(data);
if (apiProblem) result.reasons.unshift(apiProblem);

const d = data || {};
return {
  json: {
    file_name: input.fileName,
    supplier_name: d.supplier_name ?? '',
    supplier_vat_id: d.supplier_vat_id ?? '',
    invoice_number: d.invoice_number ?? '',
    invoice_date: d.invoice_date ?? '',
    currency: d.currency ?? '',
    net_amount: d.net_amount ?? '',
    vat_rate: d.vat_rate ?? '',
    vat_amount: d.vat_amount ?? '',
    total_amount: d.total_amount ?? '',
    confidence: d.confidence ?? '',
    status: apiProblem ? 'needs_review' : result.status,
    review_reasons: result.reasons.join('; '),
    summary: result.summary,
    processed_at: new Date().toISOString(),
  },
};`;

// ---------------------------------------------------------------------------
// Claude request body. Built in a Code node (not inline in the HTTP node) so the
// invoice text is JSON-escaped properly and the schema's "}}" sequences never end
// up inside an n8n {{ expression }}.
// ---------------------------------------------------------------------------
const requestBody = {
  model: MODEL,
  max_tokens: 4000,
  output_config: {
    effort: 'low',
    format: { type: 'json_schema', schema },
  },
  // Server-side fallback: if a safety classifier declines, the API retries on a fallback model
  fallbacks: 'default',
  system: systemPrompt,
};

const prepareRequest = `// Normalise both entry points (folder / webhook) into { fileName, text, requestBody }
const body = $json.body || {};
const fileName = $json.fileName || body.fileName || 'webhook-' + $now.toFormat('yyyyLLdd-HHmmss');
const text = String($json.text || body.text || '').trim();

const requestBody = ${JSON.stringify(requestBody, null, 2)};

requestBody.messages = [
  {
    role: 'user',
    content: '<invoice file="' + fileName + '">\\n' + text + '\\n</invoice>',
  },
];

return { json: { fileName, source: $json.source || 'webhook', text, requestBody } };`;

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------
let idCounter = 0;
const id = () => {
  idCounter += 1;
  return `a1b2c3d4-0000-4000-8000-${String(idCounter).padStart(12, '0')}`;
};

const nodes = [
  {
    parameters: {},
    id: id(),
    name: 'Run on inbox folder',
    type: 'n8n-nodes-base.manualTrigger',
    typeVersion: 1,
    position: [0, 200],
  },
  {
    parameters: {
      fileSelector: `${INBOX}/*.{txt,pdf}`,
      options: {},
    },
    id: id(),
    name: 'Read inbox files',
    type: 'n8n-nodes-base.readWriteFile',
    typeVersion: 1,
    position: [220, 200],
  },
  {
    parameters: {
      conditions: {
        options: { caseSensitive: false, leftValue: '', typeValidation: 'loose' },
        conditions: [
          {
            id: id(),
            leftValue: '={{ $binary.data.fileExtension }}',
            rightValue: 'pdf',
            operator: { type: 'string', operation: 'equals' },
          },
        ],
        combinator: 'and',
      },
      options: {},
    },
    id: id(),
    name: 'Is PDF?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2,
    position: [440, 200],
  },
  {
    parameters: {
      operation: 'pdf',
      binaryPropertyName: 'data',
      options: {},
    },
    id: id(),
    name: 'Extract PDF text',
    type: 'n8n-nodes-base.extractFromFile',
    typeVersion: 1,
    position: [660, 100],
  },
  {
    parameters: { mode: 'runOnceForEachItem', jsCode: pdfToText },
    id: id(),
    name: 'PDF to text',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [880, 100],
  },
  {
    parameters: { mode: 'runOnceForEachItem', jsCode: txtToText },
    id: id(),
    name: 'TXT to text',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [660, 300],
  },
  {
    parameters: { mode: 'runOnceForEachItem', jsCode: prepareRequest },
    id: id(),
    name: 'Prepare Claude request',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1100, 400],
  },
  {
    parameters: {
      method: 'POST',
      url: 'https://api.anthropic.com/v1/messages',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'anthropic-version', value: '2026-10-21' },
          { name: 'anthropic-beta', value: 'server-side-fallback-2026-07-01' },
        ],
      },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.requestBody) }}',
      options: {
        batching: { batch: { batchSize: 1, batchInterval: 500 } },
        timeout: 120000,
      },
    },
    id: id(),
    name: 'Claude: extract fields',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [1320, 400],
    credentials: {
      httpHeaderAuth: { id: 'REPLACE_ME', name: 'Anthropic API key' },
    },
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 3000,
    onError: 'continueRegularOutput',
    notes: 'Header Auth credential: name = x-api-key, value = your Anthropic API key.',
  },
  {
    parameters: { mode: 'runOnceForEachItem', jsCode: validateNode },
    id: id(),
    name: 'Validate extraction',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1540, 400],
  },
  {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [
          {
            id: id(),
            leftValue: '={{ $json.status }}',
            rightValue: 'ok',
            operator: { type: 'string', operation: 'equals' },
          },
        ],
        combinator: 'and',
      },
      options: {},
    },
    id: id(),
    name: 'Valid?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2,
    position: [1760, 400],
  },
  {
    parameters: {
      operation: 'csv',
      binaryPropertyName: 'data',
      options: { fileName: 'invoices-ok.csv' },
    },
    id: id(),
    name: 'OK rows to CSV',
    type: 'n8n-nodes-base.convertToFile',
    typeVersion: 1.1,
    position: [1980, 300],
  },
  {
    parameters: {
      operation: 'write',
      fileName: `={{ "${OUTPUT}/invoices-ok-" + $now.toFormat("yyyyLLdd-HHmmss") + ".csv" }}`,
      dataPropertyName: 'data',
      options: {},
    },
    id: id(),
    name: 'Save invoices-ok.csv',
    type: 'n8n-nodes-base.readWriteFile',
    typeVersion: 1,
    position: [2200, 300],
  },
  {
    parameters: {
      operation: 'csv',
      binaryPropertyName: 'data',
      options: { fileName: 'needs-review.csv' },
    },
    id: id(),
    name: 'Review rows to CSV',
    type: 'n8n-nodes-base.convertToFile',
    typeVersion: 1.1,
    position: [1980, 520],
  },
  {
    parameters: {
      operation: 'write',
      fileName: `={{ "${OUTPUT}/needs-review-" + $now.toFormat("yyyyLLdd-HHmmss") + ".csv" }}`,
      dataPropertyName: 'data',
      options: {},
    },
    id: id(),
    name: 'Save needs-review.csv',
    type: 'n8n-nodes-base.readWriteFile',
    typeVersion: 1,
    position: [2200, 520],
  },
  {
    parameters: {
      content:
        '## Invoice to data\n' +
        '1. Invoices come from the inbox folder (manual run) or the webhook (e-mail forwarder).\n' +
        '2. Claude returns strict JSON (JSON schema enforced by the API).\n' +
        '3. **Validate extraction** checks required fields, dates, total = net + VAT and the VAT rate.\n' +
        '4. Clean rows go to `invoices-ok-*.csv`, anything doubtful to `needs-review-*.csv` for a human.\n\n' +
        'Generated from `scripts/build-workflow.js`. Edit the source files, not this JSON.',
      height: 260,
      width: 520,
    },
    id: id(),
    name: 'About',
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position: [0, -160],
  },
];

const link = (node, index = 0) => ({ node, type: 'main', index });

const connections = {
  'Run on inbox folder': { main: [[link('Read inbox files')]] },
  'Read inbox files': { main: [[link('Is PDF?')]] },
  'Is PDF?': { main: [[link('Extract PDF text')], [link('TXT to text')]] },
  'Extract PDF text': { main: [[link('PDF to text')]] },
  'PDF to text': { main: [[link('Prepare Claude request')]] },
  'TXT to text': { main: [[link('Prepare Claude request')]] },
  'Prepare Claude request': { main: [[link('Claude: extract fields')]] },
  'Claude: extract fields': { main: [[link('Validate extraction')]] },
  'Validate extraction': { main: [[link('Valid?')]] },
  'Valid?': { main: [[link('OK rows to CSV')], [link('Review rows to CSV')]] },
  'OK rows to CSV': { main: [[link('Save invoices-ok.csv')]] },
  'Review rows to CSV': { main: [[link('Save needs-review.csv')]] },
};

const workflow = {
  name: 'Invoice AI automation (invoice -> JSON -> validated CSV)',
  nodes,
  connections,
  pinData: {},
  settings: { executionOrder: 'v1' },
  active: false,
  tags: [],
};

// Sanity check: every connection points at an existing node
const names = new Set(nodes.map((n) => n.name));
for (const [from, { main }] of Object.entries(connections)) {
  if (!names.has(from)) throw new Error(`unknown source node ${from}`);
  for (const branch of main) for (const c of branch) {
    if (!names.has(c.node)) throw new Error(`unknown target node ${c.node}`);
  }
}

fs.writeFileSync(path.join(root, 'workflow.json'), JSON.stringify(workflow, null, 2) + '\n');
console.log(`workflow.json written (${nodes.length} nodes)`);
