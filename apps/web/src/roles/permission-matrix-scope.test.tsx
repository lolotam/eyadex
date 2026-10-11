import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PERMISSION_CATALOG } from "@eyadex/contracts/permissions";
import { ar } from "@/shared/i18n/ar";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { PermissionMatrix } from "./permission-matrix";

afterEach(() => cleanup());

// P2 brief §4: a single-scope row saves its definition's scope, so create:visits:own stays own.
describe("the permission matrix", () => {
  it("saves create:visits:own (and its view) from the single-scope checkbox", () => {
    const onChange = vi.fn();
    const catalog = PERMISSION_CATALOG.filter((d) => d.resource === "visits");
    render(
      <I18nProvider>
        <PermissionMatrix catalog={[...catalog]} value={[]} onChange={onChange} readOnly={false} />
      </I18nProvider>,
    );
    const label = `${ar.roles.actions.create} — ${ar.roles.resources.visits}`;
    fireEvent.click(screen.getByRole("checkbox", { name: label }));
    expect(onChange).toHaveBeenCalledWith(["create:visits:own", "view:visits:own"]);
  });

  // ADR-0026 A3 (spec §5), moved from the patients area: the matrix belongs to roles (§1.1).
  it("offers view:patients:own as a scope of the patients view, like view:appointments:own", () => {
    render(
      <I18nProvider>
        <PermissionMatrix
          catalog={[...PERMISSION_CATALOG]}
          value={["view:patients:own"]}
          onChange={vi.fn()}
          readOnly={false}
        />
      </I18nProvider>,
    );
    const label = `${ar.roles.actions.view} — ${ar.roles.resources.patients}`;
    expect(screen.getByRole("combobox", { name: label })).toHaveTextContent(ar.roles.scopes.own);
  });
});
