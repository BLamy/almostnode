import { createFileRoute } from '@tanstack/react-router';
import { AppBuilderScreen } from '../app-builder/app-builder-screen';

export const Route = createFileRoute('/app-builder')({
  component: AppBuilderScreen,
});
