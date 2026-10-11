import { useEffect, useRef } from "react";
import type { UseFormReturn } from "react-hook-form";

const sameItems = <T>(a: readonly T[], b: readonly T[], key: (item: T) => readonly unknown[]) =>
  a.length === b.length &&
  a.every((item, i) => {
    const mine = key(item);
    const theirs = key(b[i]!);
    return mine.length === theirs.length && mine.every((value, j) => value === theirs[j]);
  });

/**
 * Keeps a section form's list (diagnoses, prescription) in step with the visit the server answers.
 * Every visit write, a note autosave included, puts a new visit in the cache and hands the section a
 * new list; resetting on each one wiped what the provider was typing (Codex PR #68). The server's list
 * is taken only when its content changed and the form still shows the previous one (nothing typed), so
 * a save that lands while the provider keeps typing leaves the newer edits in place. `key` lists the
 * fields compared, since a form row and a server row may differ in key order and extra fields.
 */
export function useServerItems<T>(
  form: UseFormReturn<{ items: T[] }>,
  server: T[],
  key: (item: T) => readonly unknown[],
) {
  const lastServer = useRef(server);
  useEffect(() => {
    if (sameItems(server, lastServer.current, key)) return;
    const pristine = sameItems(form.getValues().items, lastServer.current, key);
    lastServer.current = server;
    if (pristine) form.reset({ items: server });
  }, [form, server, key]);
}
