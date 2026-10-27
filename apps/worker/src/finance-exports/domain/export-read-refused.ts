/** رفض آمن للقراءة، من غير صفوف أو مفاتيح صلاحيات في الخطأ. */
export class ExportReadRefused extends Error {
  constructor(readonly reason: "forbidden" | "lost_lease" | "invalid_params") {
    super(`export_read_${reason}`);
  }
}
