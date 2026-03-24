import { describe, expect, it } from 'vitest';
import {
  matchesClaudeLaunchCommand,
  matchesShadcnLaunchCommand,
  shouldRunWorkbenchCommandInteractively,
} from '../src/features/terminal-command-routing';

describe('webide terminal command routing', () => {
  it('matches Claude launch commands across wrappers', () => {
    expect(matchesClaudeLaunchCommand('npx @anthropic-ai/claude-code --version')).toBe(true);
    expect(matchesClaudeLaunchCommand('env FOO=bar npm exec -- claude')).toBe(true);
    expect(matchesClaudeLaunchCommand('time ./node_modules/.bin/claude help')).toBe(true);
  });

  it('matches shadcn launch commands across wrappers', () => {
    expect(matchesShadcnLaunchCommand('npx shadcn@latest add dropdown-menu')).toBe(true);
    expect(matchesShadcnLaunchCommand('npm exec -- shadcn add card')).toBe(true);
    expect(matchesShadcnLaunchCommand('command ./node_modules/.bin/shadcn init')).toBe(true);
  });

  it('treats shadcn and Claude as interactive in the regular workbench terminal', () => {
    expect(shouldRunWorkbenchCommandInteractively('npx shadcn@latest add dropdown-menu', 'user')).toBe(true);
    expect(shouldRunWorkbenchCommandInteractively('npx @anthropic-ai/claude-code', 'user')).toBe(true);
    expect(shouldRunWorkbenchCommandInteractively('npm run dev', 'user')).toBe(false);
    expect(shouldRunWorkbenchCommandInteractively('npx shadcn@latest add dropdown-menu', 'preview')).toBe(false);
    expect(shouldRunWorkbenchCommandInteractively('printf "hello"', 'claude')).toBe(true);
  });
});
