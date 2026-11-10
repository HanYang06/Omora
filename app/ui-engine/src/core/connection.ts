import { FrameError, makeCall, parseInboundFrame, type JsonObject } from "./protocol";

/** net 插件的默认端点。改这里就换地址。 */
export const DEFAULT_URL = "ws://127.0.0.1:8765";

export type ConnectionStatus = "idle" | "connecting" | "open" | "closed" | "failed";

/** 只用到 WebSocket 的几个成员，测试里可以打桩。 */
export interface WebSocketLike {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(data: string): void;
  close(): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

const defaultFactory: WebSocketFactory = (url) => new WebSocket(url) as unknown as WebSocketLike;

/** 调用失败：code 来自错误帧，或连接层的 not_connected / connection_closed。 */
export class CallError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CallError";
    this.code = code;
  }
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * WebSocket 客户端：请求按 id 配对成 Promise。
 * 断线不发请求；v0 不重连、不超时。
 */
export class Connection {
  private readonly url: string;
  private readonly factory: WebSocketFactory;
  private socket: WebSocketLike | null = null;
  private readonly pending = new Map<string, PendingCall>();
  private readonly listeners = new Set<(status: ConnectionStatus) => void>();
  private current: ConnectionStatus = "idle";
  private nextId = 0;

  constructor(url: string = DEFAULT_URL, factory: WebSocketFactory = defaultFactory) {
    this.url = url;
    this.factory = factory;
  }

  get status(): ConnectionStatus {
    return this.current;
  }

  get endpoint(): string {
    return this.url;
  }

  /** 订阅状态；订阅时立刻回调一次当前状态。返回取消订阅的函数。 */
  subscribeStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => {
      this.listeners.delete(listener);
    };
  }

  connect(): void {
    if (this.socket !== null) {
      return;
    }

    this.setStatus("connecting");

    let socket: WebSocketLike;
    try {
      socket = this.factory(this.url);
    } catch (error) {
      console.error("[omora] 建立连接失败:", error);
      this.setStatus("failed");
      return;
    }

    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) {
        return;
      }
      this.setStatus("open");
    };

    socket.onmessage = (event) => {
      if (this.socket !== socket) {
        return;
      }
      this.receive(event.data);
    };

    socket.onerror = () => {
      if (this.socket !== socket) {
        return;
      }
      this.disconnect(new CallError("connection_failed", `无法连接 ${this.url}`), "failed");
    };

    socket.onclose = () => {
      if (this.socket !== socket) {
        return;
      }
      const next: ConnectionStatus = this.current === "failed" ? "failed" : "closed";
      this.disconnect(new CallError("connection_closed", "连接已断开"), next);
    };
  }

  /**
   * 发一帧 call。未连接直接拒绝，不发任何东西。
   * 返回的 Promise 由同 id 的 result / error 帧结算。
   */
  call(target: string, method: string, args: JsonObject = {}): Promise<unknown> {
    const socket = this.socket;
    if (this.current !== "open" || socket === null) {
      return Promise.reject(new CallError("not_connected", `未连接（${this.current}），不发请求`));
    }

    const id = String(++this.nextId);
    const frame = makeCall(id, target, method, args);

    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        socket.send(JSON.stringify(frame));
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new CallError("send_failed", String(error)));
      }
    });
  }

  close(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket !== null) {
      this.detach(socket);
      try {
        socket.close();
      } catch {
        // 已经关闭就算了。
      }
    }
    this.rejectAll(new CallError("connection_closed", "连接已关闭"));
    if (this.current !== "idle") {
      this.setStatus("closed");
    }
  }

  private receive(data: unknown): void {
    if (typeof data !== "string") {
      console.error("[omora] 忽略非文本帧:", data);
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(data);
    } catch (error) {
      console.error("[omora] 帧不是合法 JSON:", error);
      return;
    }

    let frame;
    try {
      frame = parseInboundFrame(raw);
    } catch (error) {
      if (error instanceof FrameError) {
        console.error(`[omora] 非法帧（${error.code}）: ${error.message}`);
      } else {
        console.error("[omora] 解析帧失败:", error);
      }
      return;
    }

    if (frame.type === "error" && frame.id === null) {
      console.error(`[omora] 错误帧没有 id，无法配对: ${frame.code} ${frame.message}`);
      return;
    }

    const frameId = frame.id;
    if (frameId === null) {
      return;
    }

    const pending = this.pending.get(frameId);
    if (pending === undefined) {
      console.warn(`[omora] 收到未知 id 的帧: ${frameId}`);
      return;
    }
    this.pending.delete(frameId);

    if (frame.type === "error") {
      pending.reject(new CallError(frame.code, frame.message));
      return;
    }
    pending.resolve(frame.value);
  }

  private disconnect(reason: Error, status: ConnectionStatus): void {
    const socket = this.socket;
    this.socket = null;
    if (socket !== null) {
      this.detach(socket);
      try {
        socket.close();
      } catch {
        // 已经关闭就算了。
      }
    }
    this.rejectAll(reason);
    this.setStatus(status);
  }

  private detach(socket: WebSocketLike): void {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.current === status) {
      return;
    }
    this.current = status;
    for (const listener of this.listeners) {
      listener(status);
    }
  }
}
