import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/shared/seo/page-head";
import { VisitPage } from "@/visits/visit-page";

export const Route = createFileRoute("/clinic/visits/$visitId")({
  ...pageHead("clinicVisit"),
  component: VisitRoute,
});

function VisitRoute() {
  const { visitId } = Route.useParams();
  return <VisitPage visitId={visitId} />;
}
