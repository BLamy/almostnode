import { feature } from "bun:bundle";

export const connectorTextFeatureEnabled = feature("CONNECTOR_TEXT");

export function semverOrder(a: string, b: string): -1 | 0 | 1 {
  if (typeof Bun !== "undefined") {
    return Bun.semver.order(a, b);
  }

  throw new Error("Bun unavailable");
}

export function semverMatches(version: string, range: string): boolean {
  if (typeof Bun !== "undefined") {
    return Bun.semver.satisfies(version, range);
  }

  throw new Error("Bun unavailable");
}

export function parseYaml(input: string): unknown {
  if (typeof Bun !== "undefined") {
    return Bun.YAML.parse(input);
  }

  throw new Error("Bun unavailable");
}

export function stringifyYaml(value: unknown): string {
  if (typeof Bun !== "undefined") {
    return Bun.YAML.stringify(value);
  }

  throw new Error("Bun unavailable");
}

export function hashPair(a: string, b: string): string {
  if (typeof Bun !== "undefined") {
    return Bun.hash(b, Bun.hash(a)).toString();
  }

  throw new Error("Bun unavailable");
}
