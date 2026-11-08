import { beforeEach, describe, expect, it } from "vitest";
import { CallError, Connection, type WebSocketLike } from "./connection";

class FakeSocket implements WebSocketLike {
  static instances: FakeSocket[] = [];

  readonly url: string;
  readonly sent: string[] = [];
  closed = false;

  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  open(): void {
    this.onopen?.(new Event("open"));
  }

  receive(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent);
  }

  fail(): void {
    this.onerror?.(new Event("error"));
  }

  drop(): void {
    this.onclose?.({} as CloseEvent);
  }
}

interface SentFrame {
  id: string;
  type: string;
  target: string;
  method: string;
  args: unknown;
}

function setup(): { connection: Connection; socket: FakeSocket } {
  const connection = new Connection("ws://test", (url) => new FakeSocket(url));
  connection.connect();
  const socket = FakeSocket.instances[0];
  if (socket === undefined) {
    throw new Error("连接没有建立");
  }
  socket.open();
  return { connection, socket };
}

beforeEach(() => {
  FakeSocket.instances = [];
});

describe("Connection", () => {
  it("按 id 配对：乱序返回的 result 各自结算自己的 Promise", async () => {
    const { connection, socket } = setup();

    const first = connection.call("ui", "render", { view: "main" });
    const second = connection.call("ui", "event", {
      handler: "main:1:0",
      payload: {},
    });

    const sent = socket.sent.map((line) => JSON.parse(line) as SentFrame);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({
      type: "call",
      target: "ui",
      method: "render",
      args: { view: "main" },
    });
    expect(sent[1]).toMatchObject({
      type: "call",
      target: "ui",
      method: "event",
      args: { handler: "main:1:0", payload: {} },
    });
    expect(sent[0]?.id).not.toBe(sent[1]?.id);

    socket.receive({ id: sent[1]?.id, type: "result", value: ["second"] });
    socket.receive({ id: sent[0]?.id, type: "result", value: ["first"] });

    await expect(first).resolves.toEqual(["first"]);
    await expect(second).resolves.toEqual(["second"]);
  });

  it("错误帧让同 id 的 Promise 拒绝，并带上 code 与 message", async () => {
    const { connection, socket } = setup();

    const call = connection.call("ui", "render", { view: "main" });
    const frame = JSON.parse(socket.sent[0] ?? "{}") as SentFrame;

    socket.receive({
      id: frame.id,
      type: "error",
      code: "call_failed",
      message: "炸了",
    });

    const error = await call.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(CallError);
    expect((error as CallError).code).toBe("call_failed");
    expect((error as CallError).message).toBe("炸了");
  });

  it("断线后不发请求、不重连：call 直接拒绝", async () => {
    const { connection, socket } = setup();
    const sentBefore = socket.sent.length;

    socket.drop();

    expect(connection.status).toBe("closed");
    await expect(connection.call("ui", "render", { view: "main" })).rejects.toMatchObject({
      code: "not_connected",
    });
    expect(socket.sent).toHaveLength(sentBefore);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("连接失败时状态是 failed，在途请求被拒绝", async () => {
    const { connection, socket } = setup();

    const call = connection.call("ui", "render", { view: "main" });
    socket.fail();

    expect(connection.status).toBe("failed");
    await expect(call).rejects.toMatchObject({ code: "connection_failed" });
  });

  it("未连接时不创建 socket，也不发请求", async () => {
    const connection = new Connection("ws://test", (url) => new FakeSocket(url));

    await expect(connection.call("ui", "render", { view: "main" })).rejects.toMatchObject({
      code: "not_connected",
    });
    expect(FakeSocket.instances).toHaveLength(0);
  });
});
