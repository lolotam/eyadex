import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage } from "@/marketing/marketing-page";
import { marketingHead } from "@/marketing/seo/marketing-head";

export const Route = createFileRoute("/")({
  head: () => marketingHead("ar"),
  component: ArabicLanding,
});

function ArabicLanding() {
  return <MarketingPage lang="ar" />;
}
