export const ROUTES = ["Plan", "Projection", "Scenarios", "Compare", "Assumptions"] as const;
export type Route = typeof ROUTES[number];

export function RouteContent({ route }: { route: Route }) {
  switch (route) {
    case "Plan": return <PlanView />;
    case "Projection": return <ProjectionView />;
    case "Scenarios": return <ScenariosView />;
    case "Compare": return <CompareView />;
    case "Assumptions": return <AssumptionsView />;
  }
}
import { PlanView } from "./views/plan/PlanView";
import { ProjectionView } from "./views/projection/ProjectionView";
import { ScenariosView } from "./views/scenarios/ScenariosView";
import { CompareView } from "./views/compare/CompareView";
import { AssumptionsView } from "./views/assumptions/AssumptionsView";

