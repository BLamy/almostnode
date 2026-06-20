import type { Story } from '../types';
import { almostnodeStory } from './almostnode';
import { appBuilderStory } from './app-builder';
import { codingAgentsStory } from './coding-agents';
import { keychainStory } from './keychain';
import { previewStory } from './preview';
import { tailscaleStory } from './tailscale';

export interface Chapter {
  id: string;
  number: number;
  title: string;
  blurb: string;
  /** accent color for the chapter card (a NodeKind-ish hue) */
  accent: string;
  story: Story;
}

export const chapters: Chapter[] = [
  {
    id: 'almostnode',
    number: 1,
    title: 'How almostnode works',
    blurb: 'A full Node.js dev environment — editor, npm, a live dev server, hot reload — running in one browser tab.',
    accent: '#34d399',
    story: almostnodeStory,
  },
  {
    id: 'keychain',
    number: 2,
    title: 'The keychain',
    blurb: 'How secrets enter as files, get encrypted into a passkey-locked vault, and reach every open sandbox.',
    accent: '#f5b942',
    story: keychainStory,
  },
  {
    id: 'agents',
    number: 3,
    title: 'How the coding agents work',
    blurb: 'Codex (Rust→WASM) and opencode run as real CLI agents in the tab — editing files and running commands in a loop.',
    accent: '#2dd4bf',
    story: codingAgentsStory,
  },
  {
    id: 'preview',
    number: 4,
    title: 'Driving & recording the preview',
    blurb: 'Playwright drives the preview iframe, eruda streams DevTools data back, and rrweb yields a replayable recording.',
    accent: '#fb7185',
    story: previewStory,
  },
  {
    id: 'tailscale',
    number: 5,
    title: 'How Tailscale works',
    blurb: 'Putting a browser tab on a private VPN — userspace WireGuard in WASM, tunneled over WebSocket to DERP.',
    accent: '#22d3ee',
    story: tailscaleStory,
  },
  {
    id: 'app-builder',
    number: 6,
    title: 'The app-builder & control plane',
    blurb: 'From a browser prompt to a real Fly machine with a provisioned Neon Postgres, tracked on a control-plane board.',
    accent: '#34d399',
    story: appBuilderStory,
  },
];
