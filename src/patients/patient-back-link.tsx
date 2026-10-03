import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/i18n-provider";

export function PatientBackLink() {
  const { t } = useI18n();
  return (
    <Button variant="ghost" size="sm" asChild className="mb-3 -ms-2">
      <Link to="/clinic/patients">
        <ArrowLeft className="size-4 rtl:rotate-180" />
        {t("patients.backToList")}
      </Link>
    </Button>
  );
}
