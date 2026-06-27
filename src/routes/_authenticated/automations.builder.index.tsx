import { createFileRoute } from "@tanstack/react-router";
import { FlowBuilder } from "@/components/flow/builder";

export const Route = createFileRoute("/_authenticated/automations/builder/")({
  component: () => <FlowBuilder />,
});
