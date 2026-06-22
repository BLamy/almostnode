import { describe, expect, it } from "vitest";
import {
  OAuthRegistrationError,
  registerDynamicClient,
} from "@agent-wasm/keychain/oauth/registration";
import type { FetchLike } from "@agent-wasm/keychain/oauth/proxy-fetch";

interface CapturedRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

function createCapturingFetch(handler: (req: CapturedRequest) => Response | Promise<Response>): {
  fetchImpl: FetchLike;
  calls: CapturedRequest[];
} {
  const calls: CapturedRequest[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const captured: CapturedRequest = {
      url,
      method: init?.method,
      headers: init?.headers as Record<string, string> | undefined,
      body: typeof init?.body === "string" ? init.body : undefined,
    };
    calls.push(captured);
    return handler(captured);
  };
  return { fetchImpl, calls };
}

describe("registerDynamicClient", () => {
  it("rejects when no registration endpoint is configured", async () => {
    await expect(() =>
      registerDynamicClient({
        registrationEndpoint: "",
        redirectUri: "https://app.example.com/oauth/callback",
        clientName: "almostnode",
      }),
    ).rejects.toBeInstanceOf(OAuthRegistrationError);
  });

  it("POSTs JSON with the canonical public-client body and returns the issued client_id", async () => {
    const { fetchImpl, calls } = createCapturingFetch(() =>
      new Response(
        JSON.stringify({
          client_id: "abc123",
          redirect_uris: ["https://app.example.com/oauth/callback"],
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await registerDynamicClient(
      {
        registrationEndpoint: "https://auth.example.com/register",
        redirectUri: "https://app.example.com/oauth/callback",
        clientName: "almostnode IDE",
        scope: "openid email",
      },
      { fetchImpl, tryDirectFirst: true, proxyBase: "" },
    );

    expect(result.clientId).toBe("abc123");
    expect(result.clientSecret).toBeUndefined();
    expect(result.redirectUris).toEqual(["https://app.example.com/oauth/callback"]);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("POST");
    const headers = calls[0]!.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Accept).toBe("application/json");
    const sentBody = JSON.parse(calls[0]!.body!);
    expect(sentBody).toEqual({
      redirect_uris: ["https://app.example.com/oauth/callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "almostnode IDE",
      scope: "openid email",
    });
  });

  it("captures any client_secret the AS chooses to issue", async () => {
    const { fetchImpl } = createCapturingFetch(() =>
      new Response(
        JSON.stringify({ client_id: "id", client_secret: "shhh" }),
        { status: 200 },
      ),
    );

    const result = await registerDynamicClient(
      {
        registrationEndpoint: "https://auth.example.com/register",
        redirectUri: "https://app.example.com/oauth/callback",
        clientName: "almostnode",
      },
      { fetchImpl, tryDirectFirst: true, proxyBase: "" },
    );
    expect(result.clientSecret).toBe("shhh");
  });

  it("rejects when the response is not OK", async () => {
    const { fetchImpl } = createCapturingFetch(() =>
      new Response("invalid_redirect_uri", { status: 400 }),
    );

    await expect(() =>
      registerDynamicClient(
        {
          registrationEndpoint: "https://auth.example.com/register",
          redirectUri: "https://app.example.com/oauth/callback",
          clientName: "almostnode",
        },
        { fetchImpl, tryDirectFirst: true, proxyBase: "" },
      ),
    ).rejects.toThrowError(/400/);
  });

  it("rejects when the response is not JSON", async () => {
    const { fetchImpl } = createCapturingFetch(() =>
      new Response("oops not json", { status: 200 }),
    );

    await expect(() =>
      registerDynamicClient(
        {
          registrationEndpoint: "https://auth.example.com/register",
          redirectUri: "https://app.example.com/oauth/callback",
          clientName: "almostnode",
        },
        { fetchImpl, tryDirectFirst: true, proxyBase: "" },
      ),
    ).rejects.toThrowError(/valid JSON/);
  });

  it("rejects when the response lacks a client_id", async () => {
    const { fetchImpl } = createCapturingFetch(() =>
      new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
    );

    await expect(() =>
      registerDynamicClient(
        {
          registrationEndpoint: "https://auth.example.com/register",
          redirectUri: "https://app.example.com/oauth/callback",
          clientName: "almostnode",
        },
        { fetchImpl, tryDirectFirst: true, proxyBase: "" },
      ),
    ).rejects.toThrowError(/client_id/);
  });

  it("wraps a network error in OAuthRegistrationError", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error("ECONNREFUSED");
    };
    await expect(() =>
      registerDynamicClient(
        {
          registrationEndpoint: "https://auth.example.com/register",
          redirectUri: "https://app.example.com/oauth/callback",
          clientName: "almostnode",
        },
        { fetchImpl, tryDirectFirst: true, proxyBase: "" },
      ),
    ).rejects.toBeInstanceOf(OAuthRegistrationError);
  });
});
