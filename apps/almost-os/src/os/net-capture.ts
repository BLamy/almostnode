// Network capture → OpenAPI. Records external HTTP calls made from the desktop
// (host/AI/codemode context) into a per-host buffer, generates an OpenAPI 3.1
// spec from the samples, and serves it at a virtual URL that the executor app
// can add as an OpenAPI source — so a running app's live API becomes callable,
// typed code-mode tools without a pre-existing spec.
//
// Capture point: the page-level `window.fetch` (host-context calls, including
// what code mode routes through the host). App-iframe traffic lives in another
// realm; extending capture there (via the ServerBridge middleware seam) is a
// follow-up. Kept deliberately self-contained so it doesn't touch the executor
// modules.
import type { ContainerInstance } from "@agent-wasm/core";
import { generateOpenApi, type CapturedRequest } from "./openapi-gen";

const MAX_PER_HOST = 200;
const captures = new Map<string, CapturedRequest[]>();
let installed = false;

function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url, typeof location !== "undefined" ? location.href : undefined);
    // Only external http(s) APIs are useful as codemode tools.
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.pathname.includes("/__virtual__/")) return null; // app's own dev server
    return parsed.host;
  } catch {
    return null;
  }
}

export function recordCapture(sample: CapturedRequest): void {
  const host = hostOf(sample.url);
  if (!host) return;
  const list = captures.get(host) ?? [];
  list.push(sample);
  if (list.length > MAX_PER_HOST) list.shift();
  captures.set(host, list);
}

export function capturedHosts(): Array<{ host: string; samples: number }> {
  return [...captures.entries()].map(([host, list]) => ({ host, samples: list.length }));
}

export function specForHost(host: string) {
  const samples = captures.get(host) ?? [];
  return generateOpenApi(samples, { title: `${host} (captured)` });
}

export function clearCaptures(host?: string): void {
  if (host) captures.delete(host);
  else captures.clear();
}

async function readBodySample(source: {
  clone: () => { text: () => Promise<string> };
}): Promise<unknown> {
  try {
    const text = await source.clone().text();
    if (!text) return undefined;
    return JSON.parse(text);
  } catch {
    return undefined; // non-JSON or unreadable — omit from the schema
  }
}

/** Patch the page `window.fetch` to record external JSON API traffic. Idempotent. */
export function installFetchRecorder(): void {
  if (installed || typeof window === "undefined" || typeof window.fetch !== "function") return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const response = await original(input as RequestInfo, init);
    if (hostOf(url)) {
      let requestBody: unknown;
      if (init?.body && typeof init.body === "string") {
        try {
          requestBody = JSON.parse(init.body);
        } catch {
          /* non-JSON body */
        }
      }
      const responseBody = await readBodySample(response);
      recordCapture({
        method,
        url,
        requestBody,
        status: response.status,
        responseBody,
      });
    }
    return response;
  };
}

export function installNetCaptureBridge(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { almostOS?: Record<string, unknown> };
  w.almostOS = {
    ...(w.almostOS ?? {}),
    netcapture: {
      hosts: () => capturedHosts(),
      spec: (host: string) => specForHost(host),
      clear: (host?: string) => clearCaptures(host),
    },
  };
}

const NETCAPTURE_HELP = `netcapture — turn observed API traffic into an OpenAPI spec for executor

Usage:
  netcapture hosts              List hosts with captured traffic
  netcapture spec <host>        Print the generated OpenAPI spec (JSON)
  netcapture clear [host]       Clear captured traffic (all, or one host)
`;

export function registerNetCaptureCommand(container: ContainerInstance): void {
  installFetchRecorder();
  installNetCaptureBridge();
  container.registerShellCommand({
    name: "netcapture",
    execute: async (args) => {
      const [verb, host] = args;
      switch (verb) {
        case "hosts": {
          const hosts = capturedHosts();
          if (hosts.length === 0) {
            return { stdout: "No captured traffic yet.\n", stderr: "", exitCode: 0 };
          }
          const lines = hosts.map((h) => `${h.host.padEnd(32)} ${h.samples} samples`);
          return { stdout: `${lines.join("\n")}\n`, stderr: "", exitCode: 0 };
        }
        case "spec": {
          if (!host) return { stdout: "", stderr: "usage: netcapture spec <host>\n", exitCode: 1 };
          return { stdout: `${JSON.stringify(specForHost(host), null, 2)}\n`, stderr: "", exitCode: 0 };
        }
        case "clear": {
          clearCaptures(host);
          return { stdout: `Cleared ${host ?? "all"} captures.\n`, stderr: "", exitCode: 0 };
        }
        default:
          return { stdout: NETCAPTURE_HELP, stderr: "", exitCode: 0 };
      }
    },
  });
}
