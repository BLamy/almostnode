import { MessageChannel } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import { CodexJsonRpcPeer } from "../src/json-rpc";
import {
  createMessagePortTransport,
  type MessagePortLike,
} from "../src/message-port-transport";

describe("CodexJsonRpcPeer", () => {
  it("routes requests, responses, notifications, and server requests over a MessagePort", async () => {
    const channel = new MessageChannel();
    const client = new CodexJsonRpcPeer(
      createMessagePortTransport(channel.port1 as unknown as MessagePortLike),
    );
    const server = new CodexJsonRpcPeer(
      createMessagePortTransport(channel.port2 as unknown as MessagePortLike),
    );

    server.onServerRequest((request) => {
      server.respond(request.id, {
        method: request.method,
        params: request.params,
      });
    });

    const notifications: string[] = [];
    client.onNotification((notification) => {
      notifications.push(notification.method);
    });

    await expect(client.request("thread/start", { model: "gpt-5.4" })).resolves.toEqual({
      method: "thread/start",
      params: { model: "gpt-5.4" },
    });

    server.notify("turn/started", { turn: { id: "turn_1" } });
    await waitFor(() => expect(notifications).toEqual(["turn/started"]));

    client.dispose();
    server.dispose();
  });

  it("ignores almostnode host bridge control messages", async () => {
    const channel = new MessageChannel();
    const peer = new CodexJsonRpcPeer(
      createMessagePortTransport(channel.port1 as unknown as MessagePortLike),
    );
    const notifications: string[] = [];
    peer.onNotification((notification) => {
      notifications.push(notification.method);
    });

    channel.port2.postMessage({
      type: "codex/host/response",
      id: "1",
      result: { ok: true },
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(notifications).toEqual([]);
    peer.dispose();
    channel.port2.close();
  });
});

async function waitFor(assertion: () => void): Promise<void> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < 500) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw lastError;
}
