import { createFileRoute } from "@tanstack/react-router";
import { MedicinesPage } from "@/medical/medicines-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic/settings/medicines")({
  ...pageHead("clinicSettingsMedicines"),
  component: MedicinesPage,
});
