import { createFileRoute } from '@tanstack/react-router';
import { KanbanBoardScreen } from '../projects/kanban-board-screen';

function RouteComponent() {
  const { projectId } = Route.useParams();
  return <KanbanBoardScreen projectId={projectId} />;
}

export const Route = createFileRoute('/projects/$projectId')({
  component: RouteComponent,
});
