// @agent-wasm/keychain — headless credential / OAuth / vault engine.
//
// A WebAuthn-PRF-backed AES-GCM vault over a VirtualFS, an OAuth 2.0
// orchestrator (discovery, PKCE, dynamic client registration, token refresh),
// a credential mirror, and network/tailscale session persistence. No React and
// no DOM beyond Web Crypto / WebAuthn / localStorage. Agent-launch detection is
// injected (see KeychainOptions.isAgentLaunchCommand) so the engine carries no
// CLI-launch heuristics.
export * from './keychain';
export * from './credential-mirror';
export * from './network-session';

// The OAuth orchestrator subsystem is also available via the './oauth' subpath
// (@agent-wasm/keychain/oauth).
export * as oauth from './oauth-services/index';
