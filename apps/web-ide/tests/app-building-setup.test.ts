import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APP_BUILDING_REPOSITORY_CLONE_URL,
  normalizeAppBuildingSetupDraft,
  summarizeAppBuildingRepository,
  validateAppBuildingSetupDraft,
} from '../src/features/app-building-setup';

describe('app-building setup', () => {
  it('defaults the target repo and base branch', () => {
    expect(normalizeAppBuildingSetupDraft().repositoryCloneUrl).toBe(
      DEFAULT_APP_BUILDING_REPOSITORY_CLONE_URL,
    );
    expect(normalizeAppBuildingSetupDraft().repositoryBaseBranch).toBe('main');
    expect(
      normalizeAppBuildingSetupDraft({ repositoryBaseBranch: '  ' }).repositoryBaseBranch,
    ).toBe('main');
  });

  it('does not require a repo override in setup', () => {
    const draft = normalizeAppBuildingSetupDraft({
      flyAppName: 'shared-fly-app',
      flyApiToken: 'token',
      infisicalClientId: 'client-id',
      infisicalClientSecret: 'client-secret',
      infisicalProjectId: 'project-id',
      infisicalEnvironment: 'prod',
    });

    expect(validateAppBuildingSetupDraft(draft)).toBeNull();
  });

  it('summarizes GitHub clone URLs for worker job records', () => {
    expect(
      summarizeAppBuildingRepository('https://github.com/replayio/app-building/'),
    ).toEqual({
      name: 'app-building',
      fullName: 'replayio/app-building',
      htmlUrl: 'https://github.com/replayio/app-building',
    });

    expect(
      summarizeAppBuildingRepository('https://github.com/example/app-building.git'),
    ).toEqual({
      name: 'app-building',
      fullName: 'example/app-building',
      htmlUrl: 'https://github.com/example/app-building',
    });

    expect(
      summarizeAppBuildingRepository('git@github.com:example/app-building.git'),
    ).toEqual({
      name: 'app-building',
      fullName: 'example/app-building',
      htmlUrl: 'https://github.com/example/app-building',
    });
  });
});
