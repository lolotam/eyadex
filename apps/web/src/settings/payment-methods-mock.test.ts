import { beforeEach, describe, expect, it } from "vitest";
import { PAYMENT_METHODS } from "@eyadex/contracts/finance";
import { errorKeyOf } from "@/shared/api/api-error";
import { api, as, clinicIdAt, getState, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { switchesOf } from "./payment-method-switches";

beforeEach(() => resetMockData());

const admin = () => as("clinic_admin");
const all = (enabled: (m: string) => boolean) =>
  PAYMENT_METHODS.map((method) => ({ method, enabled: enabled(method) }));
const refusal = async (p: Promise<unknown>) => {
  const r = await p.then(
    () => "succeeded",
    (e: unknown) => e,
  );
  if (r === "succeeded") throw new Error("expected a refusal");
  return errorKeyOf(r);
};
const rows = () =>
  getState().clinicAudit.filter(
    (e) => e.clinicId === clinicIdAt(0) && e.action === "payment_methods.changed",
  );

describe("payment methods (spec §4.6)", () => {
  it("reads all four on when nothing was saved", async () => {
    const settings = await api.finance.settings(admin());
    expect(settings.paymentMethods).toEqual(all(() => true));
    expect(switchesOf({})).toEqual({ cash: true, knet: true, bank_transfer: true, other: true });
  });

  it("saves the whole list and writes one administrative row with before and after", async () => {
    const saved = await api.finance.setPaymentMethods(
      admin(),
      all((m) => m !== "other"),
    );
    expect(saved.paymentMethods.find((m) => m.method === "other")?.enabled).toBe(false);
    expect((await api.finance.settings(admin())).paymentMethods).toEqual(saved.paymentMethods);
    const [row, ...more] = rows();
    expect(more).toEqual([]);
    expect(row).toMatchObject({
      entity: "payment_methods",
      category: "administrative",
      before: { paymentMethods: all(() => true) },
      after: { paymentMethods: saved.paymentMethods },
    });
  });

  it("NEGATIVE: turning every method off is payment_methods_empty and writes no row", async () => {
    expect(
      await refusal(
        api.finance.setPaymentMethods(
          admin(),
          all(() => false),
        ),
      ),
    ).toBe("payment_methods_empty");
    expect(rows()).toEqual([]);
  });

  it("NEGATIVE: without update:clinic_settings:clinic it is forbidden", async () => {
    expect(
      await refusal(
        api.finance.setPaymentMethods(
          as("receptionist"),
          all(() => true),
        ),
      ),
    ).toBe("forbidden");
  });
});
