// Shared state of the #143 concurrency harness (one React component per file lives next to it).
import { createContext } from "react";
import type { Persona, SessionContext } from "@eyadex/contracts/session";
import type { useExportDownload } from "./use-export-download";

export type Who = { persona: Persona; session: SessionContext | null; ready: boolean };

/** The identity the mocked providers hand to the hook; the transition changes it speculatively. */
export const Identity = createContext<Who | null>(null);

/** The handlers the last commit exposed: only committed handlers ever reach a user's click. */
export const handle: { current: ReturnType<typeof useExportDownload> | null } = { current: null };

/** Set by the harness: starts the speculative switch inside a transition. */
export const controls: { switchTo: (who: Who) => void } = { switchTo: () => {} };
