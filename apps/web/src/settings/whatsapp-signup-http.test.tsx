import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ar } from "@/shared/i18n/ar";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import type { FbLike } from "./embedded-signup";
import { WhatsappSignupPanel } from "./whatsapp-signup-panel";

const signup = vi.hoisted(() => vi.fn());
const sdk = vi.hoisted(() => vi.fn());
vi.mock("@/shared/api/api-mode", () => ({ API_MODE: "http" }));
vi.mock("./embedded-signup", async (original) => ({
  ...(await original<typeof import("./embedded-signup")>()),
  loadFacebookSdk: sdk,
}));
vi.mock("@/shared/api/api-provider", () => ({
  useApi: () => ({
    whatsapp: {
      signupConfig: async () => ({
        appId: "100000000000001",
        configId: "200000000000002",
        graphVersion: "v22.0",
      }),
      embeddedSignup: signup,
    },
  }),
}));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({
    persona: { kind: "clinic_admin", clinicId: "c", memberId: null },
    ready: true,
  }),
}));

beforeEach(() => {
  signup.mockReset();
  sdk.mockReset();
});
afterEach(() => cleanup());

function show() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider>
        <WhatsappSignupPanel blocked={false} onConnected={() => {}} />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe("Meta popup lifecycle", () => {
  it("keeps one flow active until the popup closes", async () => {
    let answer: Parameters<FbLike["login"]>[0] | undefined;
    const login = vi.fn((callback: Parameters<FbLike["login"]>[0]) => {
      answer = callback;
    });
    sdk.mockResolvedValue({ init: () => {}, login });
    show();
    const button = await screen.findByRole("button", { name: ar.whatsapp.signup.connect });
    fireEvent.click(button);
    await waitFor(() => expect(login).toHaveBeenCalledOnce());
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(login).toHaveBeenCalledOnce();
    await act(async () => {
      answer!({ authResponse: null });
    });
    await waitFor(() => expect(button).toBeEnabled());
    expect(signup).not.toHaveBeenCalled();
  });

  it("does not open a popup after leaving the tab while the SDK loads", async () => {
    let loaded: (fb: FbLike) => void = () => {};
    sdk.mockReturnValue(
      new Promise<FbLike>((resolve) => {
        loaded = resolve;
      }),
    );
    const rendered = show();
    fireEvent.click(await screen.findByRole("button", { name: ar.whatsapp.signup.connect }));
    rendered.unmount();
    const login = vi.fn();
    await act(async () => {
      loaded({ init: () => {}, login });
    });
    expect(login).not.toHaveBeenCalled();
    expect(signup).not.toHaveBeenCalled();
  });
});
