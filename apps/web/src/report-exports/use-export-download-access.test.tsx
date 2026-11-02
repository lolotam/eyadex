import { act } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { blobBytes } from "@/shared/api/mock/mock-report-exports.test-kit";
import { personaWith } from "@/shared/api/mock/mock-report-test-kit";
import { context, fixture, restoreDownloadTest } from "./use-export-download.test-kit";

vi.mock("@/shared/api/api-provider", () => ({ useApi: () => context.api }));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({ persona: context.persona, ready: true }),
  useSession: () => ({ session: context.session, isLoading: false, error: null }),
}));
afterEach(restoreDownloadTest);

it("A to B to A can download without inheriting A's obsolete in-flight request", async () => {
  const f = await fixture();
  const session = context.session;
  const actual = f.api.reports.downloadExport;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const call = vi.spyOn(f.api.reports, "downloadExport").mockImplementationOnce(async (p, id) => {
    const blob = await actual(p, id);
    await gate;
    return blob;
  });
  let old: Promise<void> | undefined;
  await act(async () => {
    old = f.h.result.current.download(f.row);
  });
  context.persona = personaWith([]);
  context.session = await f.api.session.getContext(context.persona);
  f.h.rerender({ rows: [] });
  context.persona = f.persona;
  context.session = session;
  f.h.rerender({ rows: [f.row] });
  let fresh: Promise<void> | undefined;
  try {
    await act(async () => {
      fresh = f.h.result.current.download(f.row);
    });
    expect(fresh).not.toBe(old);
    expect(call).toHaveBeenCalledTimes(2);
    await act(async () => {
      await fresh;
    });
    expect(f.create).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => {
      release();
      await old;
    });
  }
  expect(f.create).toHaveBeenCalledTimes(1);
});

it("a forbidden mark clears when access is restored, and a still-denied retry hides it again", async () => {
  const f = await fixture();
  const keys = [...f.role.permissions];
  f.role.permissions = [];
  context.session = await f.api.session.getContext(f.persona);
  f.h.rerender({ rows: [f.row] });
  await act(async () => {
    await f.h.result.current.download(f.row);
  });
  expect(f.h.result.current.canDownload(f.row)).toBe(false);
  expect(f.h.result.current.errors[f.row.id]).toBe("forbidden");
  f.role.permissions = keys;
  context.session = await f.api.session.getContext(f.persona);
  await act(async () => f.h.rerender({ rows: [f.row] }));
  expect(f.h.result.current.unavailable.has(f.row.id)).toBe(false);
  expect(f.h.result.current.errors).toStrictEqual({});
  expect(f.h.result.current.canDownload(f.row)).toBe(true);
  await act(async () => {
    await f.h.result.current.download(f.row);
  });
  expect(f.create).toHaveBeenCalledTimes(1);
  const blob = f.create.mock.calls[0]?.[0];
  if (!blob) throw new Error("Missing real Blob");
  expect(new TextDecoder().decode(await blobBytes(blob))).toContain("Branch A");
  f.role.permissions = [];
  context.session = await f.api.session.getContext(f.persona);
  await act(async () => f.h.rerender({ rows: [f.row] }));
  await act(async () => {
    await f.h.result.current.download(f.row);
  });
  expect(f.h.result.current.canDownload(f.row)).toBe(false);
  expect(f.create).toHaveBeenCalledTimes(1);
});

it("a delayed forbidden from older access is ignored and does not block a retry after restoration", async () => {
  const f = await fixture();
  const keys = [...f.role.permissions];
  f.role.permissions = [];
  context.session = await f.api.session.getContext(f.persona);
  f.h.rerender({ rows: [f.row] });
  const real = f.api.reports.downloadExport.bind(f.api.reports);
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const spy = vi.spyOn(f.api.reports, "downloadExport").mockImplementationOnce(async (p, id) => {
    // The real adapter judges the denied access now; its answer arrives only after restoration.
    const answer = real(p, id).then(
      (blob) => ({ blob }),
      (failure: unknown) => ({ failure }),
    );
    const settled = await answer;
    await gate;
    if ("failure" in settled) throw settled.failure;
    return settled.blob;
  });
  let old: Promise<void> = Promise.resolve();
  act(() => {
    old = f.h.result.current.download(f.row);
  });
  f.role.permissions = keys;
  context.session = await f.api.session.getContext(f.persona);
  await act(async () => f.h.rerender({ rows: [f.row] }));
  await act(async () => {
    await f.h.result.current.download(f.row);
  });
  expect(spy).toHaveBeenCalledTimes(2);
  expect(f.create).toHaveBeenCalledTimes(1);
  await act(async () => {
    release();
    await old;
  });
  expect(f.h.result.current.errors).toStrictEqual({});
  expect(f.h.result.current.unavailable.has(f.row.id)).toBe(false);
  expect(f.h.result.current.canDownload(f.row)).toBe(true);
});

it("pending follows request tokens: older access never blocks a retry nor clears a newer request", async () => {
  const f = await fixture();
  const real = f.api.reports.downloadExport.bind(f.api.reports);
  const gates: (() => void)[] = [];
  vi.spyOn(f.api.reports, "downloadExport").mockImplementation(async (p, id) => {
    const blob = await real(p, id);
    await new Promise<void>((resolve) => gates.push(resolve));
    return blob;
  });
  let old: Promise<void> = Promise.resolve();
  act(() => {
    old = f.h.result.current.download(f.row);
  });
  expect(f.h.result.current.pending.has(f.row.id)).toBe(true);
  // The access fingerprint moves (one more real key), so the old request is no longer current.
  f.role.permissions = [...f.role.permissions, "view:audit_log:clinic"];
  context.session = await f.api.session.getContext(f.persona);
  await act(async () => f.h.rerender({ rows: [f.row] }));
  expect(f.h.result.current.pending.has(f.row.id)).toBe(false);
  let fresh: Promise<void> = Promise.resolve();
  await act(async () => {
    fresh = f.h.result.current.download(f.row);
    await Promise.resolve();
  });
  await vi.waitFor(() => expect(gates).toHaveLength(2));
  expect(f.h.result.current.pending.has(f.row.id)).toBe(true);
  await act(async () => {
    gates[0]?.();
    await old;
  });
  expect(f.h.result.current.pending.has(f.row.id)).toBe(true);
  await act(async () => {
    gates[1]?.();
    await fresh;
  });
  expect(f.h.result.current.pending.has(f.row.id)).toBe(false);
  expect(f.create).toHaveBeenCalledTimes(1);
});

it("access that cycles A to B to A for the same member never revives the first request", async () => {
  const f = await fixture();
  const real = f.api.reports.downloadExport.bind(f.api.reports);
  const gates: (() => void)[] = [];
  vi.spyOn(f.api.reports, "downloadExport").mockImplementation(async (p, id) => {
    const blob = await real(p, id);
    await new Promise<void>((resolve) => gates.push(resolve));
    return blob;
  });
  const original = [...f.role.permissions];
  let first: Promise<void> = Promise.resolve();
  act(() => {
    first = f.h.result.current.download(f.row);
  });
  // Access moves to B (one more key) and comes back to A: the same fingerprint as when it started.
  f.role.permissions = [...original, "view:audit_log:clinic"];
  context.session = await f.api.session.getContext(f.persona);
  await act(async () => f.h.rerender({ rows: [f.row] }));
  f.role.permissions = original;
  context.session = await f.api.session.getContext(f.persona);
  await act(async () => f.h.rerender({ rows: [f.row] }));
  let retry: Promise<void> = Promise.resolve();
  await act(async () => {
    retry = f.h.result.current.download(f.row);
    await Promise.resolve();
  });
  expect(retry).not.toBe(first);
  await vi.waitFor(() => expect(gates).toHaveLength(2));
  // The first request's late answer neither downloads nor clears the retry's pending mark.
  await act(async () => {
    gates[0]?.();
    await first;
  });
  expect(f.create).not.toHaveBeenCalled();
  expect(f.h.result.current.pending.has(f.row.id)).toBe(true);
  await act(async () => {
    gates[1]?.();
    await retry;
  });
  expect(f.create).toHaveBeenCalledTimes(1);
  expect(f.h.result.current.pending.has(f.row.id)).toBe(false);
});
