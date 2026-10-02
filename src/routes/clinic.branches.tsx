import { createFileRoute } from "@tanstack/react-router";
import { BranchesPage } from "@/branches/branches-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic/branches")({
  head: () => pageHead("Branches", "Manage clinic branches."),
  component: BranchesPage,
});
