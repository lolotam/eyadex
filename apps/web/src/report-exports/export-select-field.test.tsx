import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ExportSelectField } from "./export-select-field";

afterEach(cleanup);

it("ignores Radix's empty form-control event when async options become ready", async () => {
  const onChange = vi.fn();
  const view = (ready: boolean) => (
    <form>
      <ExportSelectField
        id="export-branch"
        label="Branch"
        value={ready ? "__all__" : ""}
        options={ready ? [{ value: "__all__", label: "All branches" }] : []}
        disabled={!ready}
        onChange={onChange}
      />
    </form>
  );
  const page = render(view(false));
  page.rerender(view(true));
  await waitFor(() => expect(page.getByRole("combobox")).toHaveTextContent("All branches"));
  expect(onChange).not.toHaveBeenCalledWith("");
});

it("does not replace a reach-invalid branch with all branches during a refresh", async () => {
  const onChange = vi.fn();
  const view = (value: string, loading = false) => (
    <form>
      <ExportSelectField
        id="export-branch"
        label="Branch"
        value={value}
        options={
          loading
            ? []
            : [
                { value: "__all__", label: "All branches" },
                { value: "branch-a", label: "Branch A" },
                { value: "__unavailable__", label: "Unavailable", disabled: true },
              ]
        }
        disabled={loading}
        onChange={onChange}
      />
    </form>
  );
  const page = render(view("branch-a"));
  page.rerender(view("", true));
  page.rerender(view("__unavailable__"));
  await waitFor(() => expect(page.getByRole("combobox")).toHaveTextContent("Unavailable"));
  expect(onChange).not.toHaveBeenCalledWith("");
  expect(onChange).not.toHaveBeenCalledWith("__all__");
});
