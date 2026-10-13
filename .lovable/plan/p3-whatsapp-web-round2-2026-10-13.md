# Phase 3 N2 — web round 2: WhatsApp Business direct to Meta, delivery failures

Branch: `lovable` (already contains your N2 WhatsApp tab, plus the API/worker merge and review fixes).

Before you start, read:
- `CLAUDE.md` (fully)
- `CLAUDE.architecture.md`
- `docs/specs/notifications-design.md` §7 and §7.1

Do not edit any of these:
- `packages/contracts`, `apps/api`, `apps/worker`, `db/`, `docs/adr`
- `apps/web/src/components/ui`

House rules:
- Every string in ar + en.
- Logical CSS only.
- shadcn/ui and react-hook-form only.
- «المراجع», never «المريض».
- The mock refuses exactly what the API refuses.

## What changed on the server (decided by the owner)

1. **WhatsApp Business (coexistence) now talks to Meta directly**, not through Evolution.
   - On save, the server checks the token and the ids with Meta. It fills `phoneLast4` from Meta's display number.
   - A refused token answers `validation` with details path `["accessToken"]` and code `meta_credentials_invalid`.
   - Meta down answers 503.
   - The Business card works even when the server has no Evolution configured.
2. **Delivery failures.** WhatsApp can accept a message and refuse it later. The row then becomes `failed`.
   - Frozen contract: `patientNotificationSchema` gained `failureReason` (`notificationFailureReasonSchema`, see its JSDoc). It is `null` unless `status === "failed"`.
3. **No answer in time** from the sender: the row fails with reason `unconfirmed` and is never resent, so the patient never gets it twice.

## Tasks

### 0. Type errors first

`failureReason` is now required on history rows. Fix the mock (default `null`; set a reason on failed rows), fixtures and tests until `pnpm --filter @eyadex/web typecheck` passes.

### 1. WhatsApp tab

**The "WhatsApp not available on this server" empty state** (`details.code === "unavailable"`):
- Blocks only the **QR link (Evolution)** card.
- The **WhatsApp Business** card stays usable, and the disconnect button stays usable.
- Today the whole tab is replaced; change that.

**Business form:**
- Show `meta_credentials_invalid` under the access-token field: «Meta رفضت بيانات الدخول — تأكد من التوكن ورقم الهاتف ورقم حساب الأعمال» / "Meta refused these credentials — check the token, phone number id and business account id".
- Add a help line: the token must be a permanent (system-user) token from Meta Business, and the number keeps working in the WhatsApp Business app (coexistence).

**After a successful save:** the card shows «متصل …1234» / "Connected …1234" from `phoneLast4`.

**QR dialog:**
- While `status === "pending"` and `qrDataUrl === null`, show a spinner with «جارٍ تجهيز رمز QR…» / "Preparing the QR code…".
- Never show a broken image. Keep polling.

### 2. Message history (appointment details, signed visit)

For `failed` rows, show the reason under the status line (`failureReason`):

| `failureReason` | Arabic | English |
|---|---|---|
| `delivery_rejected` | رفض واتساب توصيل الرسالة (غالبًا لأن المراجع لم يراسل العيادة من قبل) | WhatsApp refused delivery (often because the patient never messaged the clinic) |
| `not_on_whatsapp` | الرقم غير مسجّل على واتساب | This number is not on WhatsApp |
| `whatsapp_credentials` | بيانات ربط واتساب مرفوضة — راجع الإعدادات | WhatsApp credentials were refused — check the settings |
| `template` | Meta رفضت قالب الرسالة | Meta refused the message template |
| `disconnected` | هاتف العيادة انفصل عن واتساب | The clinic's phone disconnected from WhatsApp |
| `unconfirmed` | لم يصل رد في الوقت؛ لم يُعد الإرسال حتى لا تتكرر الرسالة | No answer in time; not resent so the message is never duplicated |
| `invalid_address` | رقم الهاتف أو البريد غير صالح | The phone number or email is not valid |
| `other` | تعذّر الإرسال | Could not send |

### 3. Mock

- **Coexistence save:** a token containing `invalid` throws the `meta_credentials_invalid` refusal. Any other token connects with `phoneLast4: "0000"`. It works even when the mock's WhatsApp is `unavailable`.
- **Message history:** a WhatsApp row to a patient whose phone ends in `0` fails with `delivery_rejected`. Keep it deterministic, and document it in a code comment.

### 4. Done when

- `pnpm typecheck`, `pnpm lint` (0 errors) and `pnpm test` all pass.
- vitest covers:
  - the unavailable state blocks only the QR card;
  - the `meta_credentials_invalid` field error;
  - the QR "preparing" state;
  - every `failureReason` label in ar and en;
  - mock delivery failure.
- Checked in Arabic and English at 1440 px and 390 px.
- Small conventional commits. List the files you touched.
