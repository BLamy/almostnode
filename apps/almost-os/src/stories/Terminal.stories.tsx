import type { Meta, StoryObj } from "@storybook/react-vite";
import { TerminalApp } from "../apps/terminal/TerminalApp";

const meta = {
  title: "Apps/Terminal",
  component: TerminalApp,
} satisfies Meta<typeof TerminalApp>;

export default meta;

export const Default: StoryObj<typeof meta> = {};
