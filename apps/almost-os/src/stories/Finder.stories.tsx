import type { Meta, StoryObj } from "@storybook/react-vite";
import { FinderApp } from "../apps/finder/FinderApp";

const meta = {
  title: "Apps/Finder",
  component: FinderApp,
} satisfies Meta<typeof FinderApp>;

export default meta;

export const Default: StoryObj<typeof meta> = {};
