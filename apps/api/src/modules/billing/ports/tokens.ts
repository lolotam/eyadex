// Nest injection tokens of the billing module's use cases.
export const PRICE_CHANGES = Symbol("billing.PriceChanges");
export const INVOICE_DRAFTS = Symbol("billing.InvoiceDrafts");
export const INVOICE_ISSUES = Symbol("billing.InvoiceIssues");
export const INVOICE_READS = Symbol("billing.InvoiceReads");
export const INVOICE_CHANGES = Symbol("billing.InvoiceChanges");
export const FINANCE_SETTINGS = Symbol("billing.ClinicFinanceSettings");
export const INVOICE_SENDS = Symbol("billing.InvoiceSends");
export const PUBLIC_INVOICE_LINKS = Symbol("billing.PublicInvoiceLinks");
export const INVOICE_PDFS = Symbol("billing.InvoicePdfs");
export const INVOICE_PAYMENTS = Symbol("billing.InvoicePayments");
export const CREDIT_APPLICATIONS = Symbol("billing.CreditApplications");
export const PAYMENT_READS = Symbol("billing.PaymentReads");
export const INVOICE_REFUNDS = Symbol("billing.InvoiceRefunds");
export const REFUND_READS = Symbol("billing.RefundReads");
export const CASH_CLOSINGS = Symbol("billing.CashClosings");
export const CASH_CLOSING_READS = Symbol("billing.CashClosingReads");
