import type { Meta, StoryObj } from "@storybook/react-vite";
import { CodeApp } from "../apps/vscode/CodeApp";

const meta = {
  title: "Apps/Code",
  component: CodeApp,
} satisfies Meta<typeof CodeApp>;

export default meta;

export const Default: StoryObj<typeof meta> = {};
