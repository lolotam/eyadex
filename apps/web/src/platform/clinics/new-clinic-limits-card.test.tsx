import { zodResolver } from "@hookform/resolvers/zod";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { afterEach, describe, expect, it } from "vitest";
import { createClinicInputSchema, type CreateClinicInput } from "@eyadex/contracts/clinics";
import { DEFAULT_PLATFORM_SETTINGS } from "@eyadex/contracts/platform";
import { Form } from "@/components/ui/form";
import { ar } from "@/shared/i18n/ar";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { newClinicFormValues } from "./new-clinic-form-values";
import { NewClinicLimitsCard } from "./new-clinic-limits-card";

const settings = {
  ...DEFAULT_PLATFORM_SETTINGS,
  defaultMaxUsers: 25,
  defaultMaxBranches: 5,
  defaultModules: { patients: false, appointments: false },
};

// A complete form, so only the limits decide whether it submits.
const filled = (): CreateClinicInput => ({
  ...newClinicFormValues(settings),
  nameAr: "عيادة",
  nameEn: "Clinic",
  slug: "x-clinic",
  adminName: "Admin Person",
  adminEmail: "admin@example.test",
});

let submitted: CreateClinicInput | null = null;

function Harness({ values }: { values: CreateClinicInput }) {
  const form = useForm<CreateClinicInput>({
    resolver: zodResolver(createClinicInputSchema),
    defaultValues: values,
  });
  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((v) => {
          submitted = v;
        })}
      >
        <NewClinicLimitsCard control={form.control} />
        <button type="submit">submit</button>
      </form>
    </Form>
  );
}

afterEach(() => {
  cleanup();
  submitted = null;
});

describe("the create-clinic form starts from the platform settings (ADR-0020 amendment)", () => {
  it("fills limits and modules from the settings; the clinic fields start empty", () => {
    expect(newClinicFormValues(settings)).toMatchObject({
      slug: "",
      adminEmail: "",
      maxUsers: 25,
      maxBranches: 5,
      modules: { patients: false, appointments: false },
    });
  });

  it("shows the settings' values, which the super admin may change before creating", async () => {
    render(
      <I18nProvider>
        <Harness values={filled()} />
      </I18nProvider>,
    );
    const [users, branches] = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    expect(users?.value).toBe("25");
    expect(branches?.value).toBe("5");
    const patients = screen.getByRole("switch", { name: ar.clinics.modules.patients });
    expect(patients).toHaveAttribute("aria-checked", "false");
    await act(async () => patients.click());
    expect(patients).toHaveAttribute("aria-checked", "true");
    await act(async () => screen.getByRole("button", { name: "submit" }).click());
    expect(submitted).toMatchObject({
      maxUsers: 25,
      maxBranches: 5,
      modules: { patients: true, appointments: false },
    });
  });

  it("NEGATIVE: a limit outside the API's bounds is not submitted", async () => {
    const values = { ...filled(), maxUsers: 1001 };
    render(
      <I18nProvider>
        <Harness values={values} />
      </I18nProvider>,
    );
    await act(async () => screen.getByRole("button", { name: "submit" }).click());
    expect(submitted).toBeNull();
    expect(createClinicInputSchema.safeParse(values).success).toBe(false);
  });
});
