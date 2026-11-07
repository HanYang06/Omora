import { describe, expect, it } from "vitest";

import { C1Client } from "../src/rpc/c1";
import {
  FakeSocket,
  connectClient,
  countRequests,
  createScheduler,
  drain,
  findRequest,
  respond,
} from "./support/c1-harness";
describe("C1 connection", () => {
  it("loads a snapshot and subscribes from its revision", async () => {
    const { client, socket } = await connectClient({ revision: 7 });

    expect(client.getProjection().revision).toBe(7);
    expect(findRequest(socket, "event.subscribe").params).toEqual({ since: 7 });
    expect(client.getStatus()).toBe("online");
  });
});

describe("C1 catch-up", () => {
  it("refreshes state when the subscription reports catch-up events", async () => {
    const socket = new FakeSocket();
    const client = new C1Client({
      url: "ws://test",
      createSocket: () => socket,
      scheduler: createScheduler().scheduler,
    });
    const ready = client.connect();
    socket.open();
    respond(socket, findRequest(socket, "state.snapshot"), {
      revision: 2,
      state: {},
      ui: { slots: {} },
    });
    await drain();
    respond(socket, findRequest(socket, "event.subscribe"), { revision: 4 });
    await drain();

    expect(countRequests(socket, "state.snapshot")).toBe(2);
    respond(socket, findRequest(socket, "state.snapshot"), {
      revision: 4,
      state: { "plugin.a": { label: "A" } },
      ui: { slots: {} },
    });
    await ready;

    expect(client.getProjection().revision).toBe(4);
    expect(client.getProjection().state["plugin.a"]).toEqual({ label: "A" });
  });
});

describe("C1 revision handling", () => {
  it("ignores a repeated event revision", async () => {
    const { client, socket, events } = await connectClient({ revision: 7 });
    const frame = {
      jsonrpc: "2.0",
      method: "event",
      params: { type: "state.changed", revision: 8, data: {} },
    };

    socket.receive(frame);
    await drain();
    socket.receive(frame);
    await drain();

    expect(events).toEqual(["state.changed"]);
    expect(client.getProjection().revision).toBe(8);
  });

  it("replaces every updated owner slice when a live event carries them", async () => {
    const { client, socket } = await connectClient({ revision: 7 });

    socket.receive({
      jsonrpc: "2.0",
      method: "event",
      params: {
        type: "state.changed",
        revision: 8,
        updates: [
          { owner: "plugin.a", state: { label: "A" } },
          { owner: "plugin.b", state: { label: "B" } },
        ],
      },
    });
    await drain();

    expect(client.getProjection().state["plugin.a"]).toEqual({ label: "A" });
    expect(client.getProjection().state["plugin.b"]).toEqual({ label: "B" });
    expect(client.getProjection().revision).toBe(8);
  });

  it("requests a fresh snapshot when a revision is missing", async () => {
    const { socket, events } = await connectClient({ revision: 7 });
    const before = countRequests(socket, "state.snapshot");

    socket.receive({
      jsonrpc: "2.0",
      method: "event",
      params: { type: "state.changed", revision: 9 },
    });
    await drain();

    expect(countRequests(socket, "state.snapshot")).toBe(before + 1);
    expect(events).toEqual([]);
  });
});

describe("C1 reconnection", () => {
  it("reconnects and reloads a snapshot after the socket closes", async () => {
    const sockets: FakeSocket[] = [];
    const { scheduler, runNext } = createScheduler();
    const client = new C1Client({
      url: "ws://test",
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      scheduler,
    });

    const ready = client.connect();
    const first = sockets[0];
    if (first === undefined) {
      throw new Error("没有创建第一个 socket");
    }
    first.open();
    respond(first, findRequest(first, "state.snapshot"), {
      revision: 1,
      state: {},
      ui: { slots: {} },
    });
    await drain();
    respond(first, findRequest(first, "event.subscribe"), { revision: 1 });
    await ready;

    first.serverClose();
    runNext();

    const second = sockets[1];
    if (second === undefined) {
      throw new Error("没有创建重连 socket");
    }
    second.open();
    expect(countRequests(second, "state.snapshot")).toBe(1);
  });
});

describe("C1 requests", () => {
  it("rejects a command with the server error", async () => {
    const { client, socket } = await connectClient();

    const call = client.cmdInvoke({ name: "sample.run" });
    const request = findRequest(socket, "cmd.invoke");
    socket.receive({
      jsonrpc: "2.0",
      id: request.id,
      error: { code: "E_DENIED", message: "denied" },
    });

    expect(request.params).toEqual({ name: "sample.run" });
    await expect(call).rejects.toMatchObject({ code: "E_DENIED", message: "denied" });
  });
});
