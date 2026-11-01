// Finance F1 and F2 (plan Task 8): billing names its own tables, the price column of clinic_services, and
// branches and clinics for the invoice prefix and the currency; patients, appointments, visits and members
// come through its ports, bound in billing.module.ts to the adapters their owners export from index.ts.
export const BILLING_RELATIONS = [
  "clinic_services",
  "service_provider_prices",
  "invoices",
  "invoice_lines",
  "invoice_sequences",
  "used_invoice_prefixes",
  "invoice_links",
  // 0062: the patient link lookup, SECURITY DEFINER over invoice_links.
  "invoice_link_lookup",
  // Finance F2 (0064): the payment tables billing owns (spec §4.2).
  "clinic_payment_methods",
  "receipt_sequences",
  "payments",
  "payment_allocations",
  "patient_credits",
  "refunds",
  "refund_sources",
  "branch_cash_drawers",
  // Finance F2 slice 5: the daily cash closings.
  "cash_closings",
  "finance_report_exports",
  "finance_report_export_blobs",
  "finance_report_export_patients",
  "finance_invoice_balances",
  "finance_report_daily_takings",
  "finance_report_period_summary",
  "finance_report_by_service",
  "finance_report_by_doctor",
  "finance_report_cash_closings",
  // The jsonb set function its id lists read.
  "jsonb_array_elements_text",
  // PostgreSQL set-returning function for the stored own patient set, not another module table.
  "unnest",
  "branches",
  "clinics",
];
