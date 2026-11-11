import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CallError, Connection, type WebSocketLike } from "./connection";

class FakeSocket implements WebSocketLike {
  static instances: FakeSocket[] = [];

  readonly sent: string[] = [];
  closed = false;

  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor() {
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
  target?: string;
  method?: string;
  args?: unknown;
}

function socketAt(index: number): FakeSocket {
  const socket = FakeSocket.instances[index];
  if (socket === undefined) {
    throw new Error(`没有第 ${index} 条 socket`);
  }
  return socket;
}

function frames(socket: FakeSocket): SentFrame[] {
  return socket.sent.map((line) => JSON.parse(line) as SentFrame);
}

function firstFrame(socket: FakeSocket): SentFrame {
  const frame = frames(socket)[0];
  if (frame === undefined) {
    throw new Error("一条帧都没发出去");
  }
  return frame;
}

function setup(options: { random?: () => number } = {}): {
  connection: Connection;
  socket: FakeSocket;
} {
  const connection = new Connection("ws://test", () => new FakeSocket(), {
    random: options.random ?? (() => 0),
  });
  connection.connect();
  const socket = socketAt(0);
  socket.open();
  return { connection, socket };
}

beforeEach(() => {
  FakeSocket.instances = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Connection", () => {
  it("按 id 配对：乱序返回的 result 各自结算自己的 Promise", async () => {
    const { connection, socket } = setup();
    const first = connection.call("ui", "render", { view: "main" });
    const second = connection.call("ui", "event", { handler: "main:1:0", payload: {} });

    const sent = frames(socket);
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
    socket.receive({
      id: firstFrame(socket).id,
      type: "error",
      code: "call_failed",
      message: "炸了",
    });

    const error = await call.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(CallError);
    expect((error as CallError).code).toBe("call_failed");
    expect((error as CallError).message).toBe("炸了");
  });

  it("未连接时不创建 socket，call 与订阅都拒绝 not_connected", async () => {
    const connection = new Connection("ws://test", () => new FakeSocket());
    await expect(connection.call("ui", "render", { view: "main" })).rejects.toMatchObject({
      code: "not_connected",
    });
    await expect(connection.subscribe(["ui.snapshot"])).rejects.toMatchObject({
      code: "not_connected",
    });
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it("断线后 call 立即以 not_connected 拒绝，不发任何帧", async () => {
    const { connection, socket } = setup();
    const sentBefore = socket.sent.length;
    socket.drop();

    expect(connection.status).toBe("closed");
    await expect(connection.call("ui", "render", {})).rejects.toMatchObject({
      code: "not_connected",
    });
    expect(socket.sent).toHaveLength(sentBefore);
  });

  it("连接失败时状态是 failed，在途请求以 connection_failed 拒绝", async () => {
    const { connection, socket } = setup();
    const call = connection.call("ui", "render", {});
    socket.fail();

    expect(connection.status).toBe("failed");
    await expect(call).rejects.toMatchObject({ code: "connection_failed" });
  });

  it("close() 关闭 socket，并以 connection_closed 拒绝在途调用", async () => {
    const { connection, socket } = setup();
    const call = connection.call("ui", "render", {});
    connection.close();

    expect(socket.closed).toBe(true);
    expect(connection.status).toBe("closed");
    await expect(call).rejects.toMatchObject({ code: "connection_closed" });
  });
});

describe("call 超时", () => {
  it("默认 30s 超时；自定义 timeout 按给定毫秒数生效", async () => {
    const { connection } = setup();
    let outcome: "pending" | "resolved" | "rejected" = "pending";
    const call = connection.call("ui", "render", {});
    void call.then(
      () => {
        outcome = "resolved";
      },
      () => {
        outcome = "rejected";
      },
    );

    vi.advanceTimersByTime(29_999);
    await Promise.resolve();
    expect(outcome).toBe("pending");
    vi.advanceTimersByTime(1);
    await expect(call).rejects.toMatchObject({ code: "timeout" });
    expect(outcome).toBe("rejected");

    const custom = connection.call("ui", "render", {}, { timeout: 1_000 });
    vi.advanceTimersByTime(999);
    await Promise.resolve();
    await expect(
      Promise.race([custom.then(() => "done"), Promise.resolve("pending")]),
    ).resolves.toBe("pending");
    vi.advanceTimersByTime(1);
    await expect(custom).rejects.toMatchObject({ code: "timeout" });
  });

  it("timeout: 0 关掉超时，多久都等 result", async () => {
    const { connection, socket } = setup();
    let outcome = "pending";
    const call = connection.call("ui", "render", {}, { timeout: 0 });
    void call.then(
      () => {
        outcome = "resolved";
      },
      () => {
        outcome = "rejected";
      },
    );

    vi.advanceTimersByTime(10 * 60_000);
    await Promise.resolve();
    expect(outcome).toBe("pending");

    socket.receive({ id: firstFrame(socket).id, type: "result", value: { page: "ideas" } });
    await expect(call).resolves.toEqual({ page: "ideas" });
  });

  it("超时后迟到的同 id result 按未知 id 忽略，不结算任何人", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { connection, socket } = setup();
    const call = connection.call("ui", "render", {});
    const timedOut = firstFrame(socket);
    vi.advanceTimersByTime(30_000);
    await expect(call).rejects.toMatchObject({ code: "timeout" });

    const next = connection.call("ui", "render", {});
    const nextFrame = frames(socket)[1];
    let nextOutcome = "pending";
    void next.then(
      () => {
        nextOutcome = "resolved";
      },
      () => {
        nextOutcome = "rejected";
      },
    );

    socket.receive({ id: timedOut.id, type: "result", value: { late: true } });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(timedOut.id));
    await Promise.resolve();
    expect(nextOutcome).toBe("pending");
    expect(connection.status).toBe("open");

    socket.receive({ id: nextFrame?.id, type: "result", value: { page: "main" } });
    await expect(next).resolves.toEqual({ page: "main" });
    expect(nextOutcome).toBe("resolved");
  });
});

describe("超时定时器", () => {
  it("result 到岸与超时自己触发都不留下定时器", async () => {
    const { connection, socket } = setup();
    const answered = connection.call("ui", "render", {});
    socket.receive({ id: firstFrame(socket).id, type: "result", value: { ok: true } });
    await expect(answered).resolves.toEqual({ ok: true });
    expect(vi.getTimerCount()).toBe(0);

    const timedOut = connection.call("ui", "render", {});
    vi.advanceTimersByTime(30_000);
    await expect(timedOut).rejects.toMatchObject({ code: "timeout" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("close() 清掉所有在途调用的定时器", async () => {
    const { connection } = setup();
    const first = connection.call("ui", "render", {});
    const second = connection.call("ui", "render", {});
    connection.close();

    await expect(first).rejects.toMatchObject({ code: "connection_closed" });
    await expect(second).rejects.toMatchObject({ code: "connection_closed" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("断线时清掉在途调用的定时器，只留一条重连", async () => {
    const { connection, socket } = setup();
    const first = connection.call("ui", "render", {});
    const second = connection.call("ui", "render", {});
    socket.drop();

    await expect(first).rejects.toMatchObject({ code: "connection_closed" });
    await expect(second).rejects.toMatchObject({ code: "connection_closed" });
    expect(vi.getTimerCount()).toBe(1);

    connection.close();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("event 推送", () => {
  it("同一 topic 的 event 派发给所有监听者，别的 topic 不受影响", () => {
    const { connection, socket } = setup();
    const first: unknown[] = [];
    const second: unknown[] = [];
    const other: unknown[] = [];
    connection.onEvent("ui.snapshot", (payload) => first.push(payload));
    connection.onEvent("ui.snapshot", (payload) => second.push(payload));
    connection.onEvent("media.progress", (payload) => other.push(payload));

    socket.receive({ type: "event", topic: "ui.snapshot", payload: { version: 3 } });

    expect(first).toEqual([{ version: 3 }]);
    expect(second).toEqual([{ version: 3 }]);
    expect(other).toEqual([]);
  });

  it("event 不结算在途调用，只派发给监听者", async () => {
    const { connection, socket } = setup();
    const call = connection.call("ui", "render", {});
    const seen: unknown[] = [];
    connection.onEvent("ui.snapshot", (payload) => seen.push(payload));

    socket.receive({ type: "event", topic: "ui.snapshot", payload: { version: 1 } });
    expect(seen).toHaveLength(1);

    socket.receive({ id: firstFrame(socket).id, type: "result", value: { page: "main" } });
    await expect(call).resolves.toEqual({ page: "main" });
  });

  it("取消监听后不再收到该 topic 的 event", () => {
    const { connection, socket } = setup();
    const kept: unknown[] = [];
    const removed: unknown[] = [];
    const off = connection.onEvent("ui.snapshot", (payload) => removed.push(payload));
    connection.onEvent("ui.snapshot", (payload) => kept.push(payload));

    off();
    socket.receive({ type: "event", topic: "ui.snapshot", payload: { version: 2 } });

    expect(removed).toEqual([]);
    expect(kept).toEqual([{ version: 2 }]);
  });

  it("没有监听者的 topic 静默忽略，连接照常可用", async () => {
    const { connection, socket } = setup();
    socket.receive({ type: "event", topic: "nope", payload: {} });

    expect(connection.status).toBe("open");
    const call = connection.call("ui", "render", {});
    socket.receive({ id: firstFrame(socket).id, type: "result", value: { page: "main" } });
    await expect(call).resolves.toEqual({ page: "main" });
  });

  it("一个监听者抛错不影响同一 topic 的其他监听者", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { connection, socket } = setup();
    const seen: unknown[] = [];
    connection.onEvent("ui.snapshot", () => {
      throw new Error("坏监听者");
    });
    connection.onEvent("ui.snapshot", (payload) => seen.push(payload));

    expect(() => {
      socket.receive({ type: "event", topic: "ui.snapshot", payload: { version: 4 } });
    }).not.toThrow();
    expect(seen).toEqual([{ version: 4 }]);
  });
});

describe("订阅", () => {
  it("subscribe 发一帧 net.subscribe，返回操作完的 topics", async () => {
    const { connection, socket } = setup();
    const pending = connection.subscribe(["ui.snapshot", "media.progress"]);
    const frame = firstFrame(socket);
    expect(frame).toMatchObject({
      type: "call",
      target: "net",
      method: "subscribe",
      args: { topics: ["ui.snapshot", "media.progress"] },
    });

    socket.receive({
      id: frame.id,
      type: "result",
      value: { topics: ["ui.snapshot", "media.progress"] },
    });
    await expect(pending).resolves.toEqual({ topics: ["ui.snapshot", "media.progress"] });
  });

  it("unsubscribe 发一帧 net.unsubscribe，返回剩下的 topics", async () => {
    const { connection, socket } = setup();
    const pending = connection.unsubscribe(["media.progress"]);
    const frame = firstFrame(socket);
    expect(frame).toMatchObject({
      type: "call",
      target: "net",
      method: "unsubscribe",
      args: { topics: ["media.progress"] },
    });

    socket.receive({ id: frame.id, type: "result", value: { topics: ["ui.snapshot"] } });
    await expect(pending).resolves.toEqual({ topics: ["ui.snapshot"] });
  });

  it("未连接时订阅直接拒绝 not_connected", async () => {
    const connection = new Connection("ws://test", () => new FakeSocket());
    await expect(connection.subscribe(["ui.snapshot"])).rejects.toMatchObject({
      code: "not_connected",
    });
  });
});

describe("断线重连", () => {
  it("断线 500ms 后自动重开一条 socket", () => {
    const { connection, socket } = setup();
    socket.drop();

    expect(connection.status).toBe("closed");
    vi.advanceTimersByTime(499);
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(2);
  });
  it("一次断线只重连一次：error 与 close 同时来也不会重复开 socket", () => {
    const { socket } = setup();
    socket.fail();
    socket.drop();
    vi.advanceTimersByTime(500);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("指数退避 500ms 起、封顶 10s，连上后从 500ms 重新起算", () => {
    const { socket } = setup();
    socket.drop();
    vi.advanceTimersByTime(500);
    socketAt(1).open();
    socketAt(1).drop();
    vi.advanceTimersByTime(499);
    expect(FakeSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(3);
    socketAt(2).fail();

    for (const delay of [1_000, 2_000, 4_000, 8_000, 10_000, 10_000]) {
      const before = FakeSocket.instances.length;
      vi.advanceTimersByTime(delay - 1);
      expect(FakeSocket.instances).toHaveLength(before);
      vi.advanceTimersByTime(1);
      expect(FakeSocket.instances).toHaveLength(before + 1);
      socketAt(before).fail();
    }
  });

  it("重连延迟带抖动：随机源拉满时首个延迟是 600ms", () => {
    const { socket } = setup({ random: () => 1 });
    socket.drop();

    vi.advanceTimersByTime(599);
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("连接失败也自动重连，状态先 failed", () => {
    const { connection, socket } = setup();
    socket.fail();
    expect(connection.status).toBe("failed");

    vi.advanceTimersByTime(500);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("close() 之后不再重连，也会取消已排好的重连", () => {
    const first = setup();
    first.connection.close();
    first.socket.drop();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);

    FakeSocket.instances = [];
    const second = setup();
    second.socket.drop();
    second.connection.close();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });
  it("close() 之后手动 connect() 会重新连", () => {
    const { connection } = setup();
    connection.close();
    connection.connect();

    expect(connection.status).toBe("connecting");
    expect(FakeSocket.instances).toHaveLength(2);
  });
});
