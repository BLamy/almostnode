# @agent-wasm/keychain

The headless credential / OAuth / vault engine behind agent-wasm. A
WebAuthn-PRF-backed AES-GCM vault over a [`@agent-wasm/core`](https://www.npmjs.com/package/@agent-wasm/core)
`VirtualFS`, an OAuth 2.0 orchestrator (discovery, PKCE, dynamic client
registration, token refresh), a credential mirror, and network/tailscale session
persistence. No React and no DOM beyond Web Crypto / WebAuthn / `localStorage`.

```bash
npm install @agent-wasm/keychain @agent-wasm/core
```

```ts
import { Keychain } from "@agent-wasm/keychain";

const keychain = new Keychain({
  vfs,
  // The engine carries no CLI heuristics — agent-launch detection is injected:
  isAgentLaunchCommand: (cmd) => /\b(claude|codex|opencode)\b/.test(cmd),
  onStateChange: (state) => render(state),
});
```

## API

- **`Keychain`** — the vault: WebAuthn unlock, AES-GCM encrypt/decrypt, credential
  slot registration, auto-restore. Agent-launch detection is **injected** via
  `isAgentLaunchCommand`, so the engine stays free of terminal-routing coupling.
- **`encryptData` / `decryptData` / `deriveVaultKeyFromPrf` / `detectWebAuthnPrfSupport`** —
  the crypto primitives.
- **`CredentialMirror`** — mirror saved credentials into a workspace VFS / env.
- Credential path constants (`CLAUDE_AUTH_*`, `CODEX_AUTH_PATH`,
  `TAILSCALE_SESSION_KEYCHAIN_PATH`, …) and tailscale session helpers.

## `@agent-wasm/keychain/oauth`

The OAuth 2.0 orchestrator subsystem: `OAuthServiceOrchestrator`,
`OAuthServiceRegistry`, token store, PKCE, discovery, and dynamic client
registration — usable independently of the vault.

## License

MIT
