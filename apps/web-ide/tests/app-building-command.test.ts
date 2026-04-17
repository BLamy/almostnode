import { describe, expect, it } from 'vitest';
import {
  APP_BUILDING_HELP_TEXT,
  parseAppBuildingCommand,
  summarizeAppBuildingPrompt,
} from '../src/features/app-building-command';

describe('app-building command parser', () => {
  it('parses remote create commands', () => {
    expect(
      parseAppBuildingCommand([
        'create',
        '--remote',
        '--name',
        'weather-radar',
        '--prompt',
        'Ship a weather app',
      ]),
    ).toEqual({
      verb: 'create',
      remote: true,
      name: 'weather-radar',
      prompt: 'Ship a weather app',
    });
  });

  it('parses message and logs commands', () => {
    expect(
      parseAppBuildingCommand([
        'message',
        'job-123',
        '--prompt',
        'Tighten the mobile nav',
      ]),
    ).toEqual({
      verb: 'message',
      jobId: 'job-123',
      prompt: 'Tighten the mobile nav',
    });

    expect(
      parseAppBuildingCommand(['logs', 'job-123', '--offset', '40']),
    ).toEqual({
      verb: 'logs',
      jobId: 'job-123',
      offset: 40,
    });
  });

  it('rejects unsupported create flows without --remote', () => {
    expect(() => parseAppBuildingCommand([
      'create',
      '--name',
      'weather-radar',
      '--prompt',
      'Ship a weather app',
    ])).toThrow('requires `--remote`');
  });

  it('provides help text and prompt summaries', () => {
    expect(parseAppBuildingCommand(['help'])).toEqual({ verb: 'help' });
    expect(APP_BUILDING_HELP_TEXT).toContain('app-building create --remote');
    expect(summarizeAppBuildingPrompt('a'.repeat(200), 12)).toBe('aaaaaaaaaaa…');
  });
});
