# Sample invoices

All five invoices are made up. The companies, addresses, VAT IDs, IBANs and
e-mail domains (`*.example`) are fictitious and only exist to test the workflow.

| File | Supplier | What it tests |
|------|----------|---------------|
| `invoice-001-nordwind-buerobedarf.txt` | Nordwind Bürobedarf GmbH | German layout, `1.234,56` number format, 19 % VAT |
| `invoice-002-cloudhafen-hosting.txt` | Cloudhafen Hosting UG | English invoice, US-style date ("February 28, 2026") |
| `invoice-003-gruenwerk-catering.txt` | Grünwerk Catering e.K. | Reduced 7 % VAT rate, date written in a sentence |
| `invoice-004-elektro-brandt.txt` | Elektro Brandt GmbH & Co. KG | **Deliberately wrong:** total is 1.656,04 € but net + VAT = 1.566,04 € (swapped digits) |
| `invoice-005-alpenblick-logistik.txt` | Alpenblick Logistik GmbH (AT) | EU reverse charge: 0 % VAT, total = net, Austrian UID |

Invoice 004 should always end up in the "needs review" list.
