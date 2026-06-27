import { createFileRoute } from "@tanstack/react-router";
import { FlowBuilder } from "@/components/flow/builder";

export const Route = createFileRoute("/_authenticated/automations/builder/$id")({
  component: BuilderEdit,
});

function BuilderEdit() {
  const { id } = Route.useParams();
  return <FlowBuilder flowId={id} />;
}
