import { describe, expect, it } from 'vitest';
import {
  BRIDGED_COMMAND_NAMES,
  shouldProxyShellWrapperCommand,
} from './almostnode-command-bridge';

describe('almostnode command bridge shell wrapper', () => {
  it('keeps standard one-line shell commands proxied', () => {
    expect(shouldProxyShellWrapperCommand('npm install')).toBe(true);
    expect(shouldProxyShellWrapperCommand('node script.js')).toBe(true);
  });

  it('bypasses agent launch commands and multiline heredoc scripts', () => {
    expect(shouldProxyShellWrapperCommand('opencode')).toBe(false);
    expect(shouldProxyShellWrapperCommand('codex --help')).toBe(false);
    expect(shouldProxyShellWrapperCommand(`cat <<'EOF' > src/App.tsx
console.log("hello");
EOF`)).toBe(false);
  });

  it('does not install a cat shim so real-shell heredocs keep working', () => {
    expect(BRIDGED_COMMAND_NAMES).not.toContain('cat');
    expect(BRIDGED_COMMAND_NAMES).toContain('npm');
  });
});
