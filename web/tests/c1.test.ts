import { describe, expect, it } from "vitest";

import { isRecord } from "../src/lib/guards";
import { C1Client, type C1Scheduler, type C1Socket } from "../src/rpc/c1";

type Frame = Record<string, unknown>;

class FakeSocket implements C1Socket {
  readonly sent: string[] = [];
  closeCalls = 0;
  private readonly openListeners: (() => void)[] = [];
  private readonly messageListeners: ((payload: string) => void)[] = [];
  private readonly closeListeners: (() => void)[] = [];
  private readonly errorListeners: (() => void)[] = [];

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(): void {
    this.closeCalls += 1;
  }

  onOpen(listener: () => void): void {
    this.openListeners.push(listener);
  }

  onMessage(listener: (payload: string) => void): void {
    this.messageListeners.push(listener);
  }

  onClose(listener: () => void): void {
    this.closeListeners.push(listener);
  }

  onError(listener: () => void): void {
    this.errorListeners.push(listener);
  }

  open(): void {
    for (const listener of this.openListeners) {
      listener();
    }
  }

  receive(frame: Frame): void {
    const payload = JSON.stringify(frame);
    for (const listener of this.messageListeners) {
      listener(payload);
    }
  }

  serverClose(): void {
    for (const listener of this.closeListeners) {
      listener();
    }
  }

  frames(): Frame[] {
    return this.sent.map((payload) => {
      const decoded: unknown = JSON.parse(payload);
      return isRecord(decoded) ? decoded : {};
    });
  }
}

interface TestScheduler {
  scheduler: C1Scheduler;
  runNext: () => void;
}

function createScheduler(): TestScheduler {
  const scheduled = new Map<number, () => void>();
  let nextHandle = 1;
  return {
    scheduler: {
      schedule: (callback) => {
        const handle = nextHandle;
        nextHandle += 1;
        scheduled.set(handle, callback);
        return handle;
      },
      cancel: (handle) => {
        scheduled.delete(handle);
      },
    },
    runNext: () => {
      for (const [handle, callback] of scheduled) {
        scheduled.delete(handle);
        callback();
        return;
      }
    },
  };
}

async function drain(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

function countRequests(socket: FakeSocket, method: string): number {
  return socket.frames().filter((frame) => frame.method === method).length;
}

function findRequest(socket: FakeSocket, method: string): Frame {
  const matches = socket.frames().filter((frame) => frame.method === method);
  const last = matches[matches.length - 1];
  if (last === undefined) {
    throw new Error(`没有发送 ${method} 请求`);
  }
  return last;
}

function respond(socket: FakeSocket, request: Frame, result: unknown): void {
  socket.receive({ jsonrpc: "2.0", id: request.id, result });
}

interface ConnectedClient {
  client: C1Client;
  socket: FakeSocket;
  events: string[];
}

async function connectClient(
  options: { revision?: number; scheduler?: C1Scheduler } = {},
): Promise<ConnectedClient> {
  const socket = new FakeSocket();
  const events: string[] = [];
  const scheduler = options.scheduler ?? createScheduler().scheduler;
  const client = new C1Client({
    url: "ws://test",
    createSocket: () => socket,
    scheduler,
    onEvent: (event) => {
      events.push(event.type);
    },
  });
  const revision = options.revision ?? 3;
  const ready = client.connect();
  socket.open();
  respond(socket, findRequest(socket, "state.snapshot"), {
    revision,
    state: {},
    ui: { slots: {} },
  });
  await drain();
  respond(socket, findRequest(socket, "event.subscribe"), { revision });
  await ready;
  return { client, socket, events };
}

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

  it("replaces the owner slice when a live event carries it", async () => {
    const { client, socket } = await connectClient({ revision: 7 });

    socket.receive({
      jsonrpc: "2.0",
      method: "event",
      params: { type: "state.changed", revision: 8, owner: "plugin.a", state: { label: "A" } },
    });
    await drain();

    expect(client.getProjection().state["plugin.a"]).toEqual({ label: "A" });
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
