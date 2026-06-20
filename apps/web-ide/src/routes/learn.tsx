import { createFileRoute } from '@tanstack/react-router';
import { LearnPage } from '../learn/LearnPage';
import '../learn/learn.css';

// /learn — an animated, narrated explainer of how almostnode works.
export const Route = createFileRoute('/learn')({
  component: LearnPage,
});
