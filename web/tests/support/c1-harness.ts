import { isRecord } from "../../src/lib/guards";
import { C1Client, type C1Scheduler, type C1Socket } from "../../src/rpc/c1";

export type Frame = Record<string, unknown>;

export class FakeSocket implements C1Socket {
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

export interface TestScheduler {
  scheduler: C1Scheduler;
  runNext: () => void;
}

export function createScheduler(): TestScheduler {
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

export async function drain(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

export function countRequests(socket: FakeSocket, method: string): number {
  return socket.frames().filter((frame) => frame.method === method).length;
}

export function findRequest(socket: FakeSocket, method: string): Frame {
  const matches = socket.frames().filter((frame) => frame.method === method);
  const last = matches[matches.length - 1];
  if (last === undefined) {
    throw new Error(`没有发送 ${method} 请求`);
  }
  return last;
}

export function respond(socket: FakeSocket, request: Frame, result: unknown): void {
  socket.receive({ jsonrpc: "2.0", id: request.id, result });
}

interface ConnectedClient {
  client: C1Client;
  socket: FakeSocket;
  events: string[];
}

export async function connectClient(
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
