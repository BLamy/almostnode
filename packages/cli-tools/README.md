# @agent-wasm/cli-tools

Browser wasm CLI tools for [almostnode](https://www.npmjs.com/package/@agent-wasm/core): a
[vim.wasm](https://github.com/rhysd/vim.wasm) editor overlay and
[ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm), exposed as terminal shell commands.

## Install

```bash
npm install @agent-wasm/cli-tools
```

Peer dependencies (`@agent-wasm/core`, `@ffmpeg/ffmpeg`, `@ffmpeg/core`, `vim-wasm`, and
optionally `vite`) must be installed by the host application.

## Usage

```ts
import { createFfmpegShellCommands, createVimShellCommands } from '@agent-wasm/cli-tools'
```

The `@agent-wasm/cli-tools/vite` subpath exposes an optional Vite plugin for asset wiring.

## License

MIT
