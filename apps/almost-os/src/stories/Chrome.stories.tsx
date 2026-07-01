import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChromeApp } from "../apps/chrome/ChromeApp";

const meta = {
  title: "Apps/Chrome",
  component: ChromeApp,
} satisfies Meta<typeof ChromeApp>;

export default meta;

export const Default: StoryObj<typeof meta> = {};
