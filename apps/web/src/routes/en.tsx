import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage } from "@/marketing/marketing-page";
import { marketingHead } from "@/marketing/seo/marketing-head";

export const Route = createFileRoute("/en")({
  head: () => marketingHead("en"),
  component: EnglishLanding,
});

function EnglishLanding() {
  return <MarketingPage lang="en" />;
}
