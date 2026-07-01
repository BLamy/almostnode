import type { Meta, StoryObj } from "@storybook/react-vite";
import { KeychainApp } from "../apps/keychain/KeychainApp";

const meta = {
  title: "Apps/Keychain",
  component: KeychainApp,
} satisfies Meta<typeof KeychainApp>;

export default meta;

export const Default: StoryObj<typeof meta> = {};
