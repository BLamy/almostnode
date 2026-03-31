const ADJECTIVES = [
  'amber',
  'brisk',
  'cosmic',
  'lucky',
  'magic',
  'midnight',
  'rapid',
  'silver',
  'solar',
  'wild',
] as const;

const NOUNS = [
  'badger',
  'comet',
  'falcon',
  'fox',
  'frisby',
  'harbor',
  'otter',
  'rocket',
  'signal',
  'wolf',
] as const;

function pickRandom<T>(values: readonly T[], random: () => number): T {
  return values[Math.floor(random() * values.length)] as T;
}

export function generateProjectName(random: () => number = Math.random): string {
  return `${pickRandom(ADJECTIVES, random)}-${pickRandom(NOUNS, random)}`;
}

export function resolveProjectName(
  value: string | null | undefined,
  random: () => number = Math.random,
): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : generateProjectName(random);
}
