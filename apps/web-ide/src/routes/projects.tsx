import { createFileRoute } from '@tanstack/react-router';
import { ProjectsScreen } from '../projects/projects-screen';

export const Route = createFileRoute('/projects')({
  component: ProjectsScreen,
});
