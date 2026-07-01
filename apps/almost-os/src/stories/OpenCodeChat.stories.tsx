import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChatPopover } from "../chat/ChatPopover";

const meta = {
  title: "Apps/OpenCode Chat",
  component: ChatPopover,
  args: { open: true, onClose: () => {} },
} satisfies Meta<typeof ChatPopover>;

export default meta;

export const Default: StoryObj<typeof meta> = {};
