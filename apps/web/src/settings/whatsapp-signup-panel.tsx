import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { WhatsappEmbeddedSignupRequest } from "@eyadex/contracts/whatsapp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { API_MODE } from "@/shared/api/api-mode";
import { useApi } from "@/shared/api/api-provider";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { loadFacebookSdk, runEmbeddedSignup, type SignupOutcome } from "./embedded-signup";
import { signupErrorKey } from "./whatsapp-signup-error";
import { useRefreshWhatsapp } from "./whatsapp-queries";

/** Fictional ids the demo "Meta window" reports (mock mode only). */
const DEMO_IDS = { wabaId: "300000000000003", phoneNumberId: "400000000000004" };

/** The one-click "Connect WhatsApp Business" (Meta Embedded Signup, spec §7.2). */
export function WhatsappSignupPanel({
  blocked,
  onConnected,
}: {
  blocked: boolean;
  onConnected: () => void;
}) {
  const { t, tDynamic } = useI18n();
  const api = useApi();
  const { persona } = usePersona();
  const refresh = useRefreshWhatsapp();
  const [error, setError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const flow = useRef<(() => void) | null>(null);
  const mounted = useRef(false);
  const [demoCode, setDemoCode] = useState("demo");
  const config = useQuery({
    queryKey: ["clinic", "whatsapp", "signup-config", persona.clinicId],
    queryFn: () => api.whatsapp.signupConfig(persona),
    retry: false,
  });
  useEffect(() => {
    if (API_MODE === "http" && config.data) void loadFacebookSdk(config.data).catch(() => {});
  }, [config.data]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      flow.current?.();
    };
  }, []);

  const signup = useMutation({
    mutationFn: (input: WhatsappEmbeddedSignupRequest) =>
      api.whatsapp.embeddedSignup(persona, input),
    onSuccess: (view) => {
      refresh(view);
      toast.success(t("whatsapp.qr.connected"));
      onConnected();
    },
    onError: (e) => setError(signupErrorKey(e)),
  });

  const settle = (outcome: SignupOutcome) => {
    setLinking(false);
    if (outcome.kind === "ready") signup.mutate(outcome.request);
    else if (outcome.kind === "cancelled") toast(t("whatsapp.signup.cancelled"));
    else if (outcome.kind === "missing_ids") setError("whatsapp.signup.missingIds");
  };

  const start = () => {
    setError(null);
    if (!config.data) return;
    if (API_MODE !== "http") {
      if (demoCode.trim() === "cancel") return;
      signup.mutate({ code: demoCode.trim() || "demo", ...DEMO_IDS });
      return;
    }
    setLinking(true);
    void loadFacebookSdk(config.data)
      .then((fb) => {
        if (!mounted.current) return;
        flow.current = runEmbeddedSignup(fb, config.data!, window, settle);
      })
      .catch(() => {
        if (!mounted.current) return;
        setLinking(false);
        setError("whatsapp.unavailableTitle");
      });
  };

  if (config.isLoading) return <Loader2 className="size-4 animate-spin text-muted-foreground" />;
  if (!config.data) return null;
  return (
    <div className="flex flex-col items-start gap-2">
      {API_MODE !== "http" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="wa-demo-code">{t("whatsapp.signup.demoCode")}</Label>
          <Input
            id="wa-demo-code"
            dir="ltr"
            className="w-48"
            value={demoCode}
            onChange={(e) => setDemoCode(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t("whatsapp.signup.demoHint")}</p>
        </div>
      )}
      <Button disabled={blocked || linking || signup.isPending} onClick={start}>
        {API_MODE === "http" ? t("whatsapp.signup.connect") : t("whatsapp.signup.demo")}
      </Button>
      {error && <p className="text-[0.8rem] font-medium text-destructive">{tDynamic(error)}</p>}
    </div>
  );
}
