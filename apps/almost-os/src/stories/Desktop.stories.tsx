import type { Meta, StoryObj } from "@storybook/react-vite";
import { Desktop } from "../desktop/Desktop";

// The full macOS desktop shell. Desktop self-wraps the runtime/keychain
// providers, which reuse the same singletons as the story decorator.
const meta = {
  title: "Desktop/Full Shell",
  component: Desktop,
} satisfies Meta<typeof Desktop>;

export default meta;

export const Default: StoryObj<typeof meta> = {};
