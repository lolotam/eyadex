// Nest injection tokens of the billing module's use cases.
export const PRICE_CHANGES = Symbol("billing.PriceChanges");
export const INVOICE_DRAFTS = Symbol("billing.InvoiceDrafts");
export const INVOICE_ISSUES = Symbol("billing.InvoiceIssues");
export const INVOICE_READS = Symbol("billing.InvoiceReads");
export const INVOICE_CHANGES = Symbol("billing.InvoiceChanges");
export const FINANCE_SETTINGS = Symbol("billing.ClinicFinanceSettings");
export const INVOICE_SENDS = Symbol("billing.InvoiceSends");
