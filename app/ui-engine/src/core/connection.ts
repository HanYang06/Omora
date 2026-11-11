import { FrameError, makeCall, parseInboundFrame, type JsonObject } from "./protocol";

/** net 插件的默认端点。改这里就换地址。 */
export const DEFAULT_URL = "ws://127.0.0.1:8765";

/** call 默认 30s 超时；timeout: 0 关掉。 */
export const DEFAULT_CALL_TIMEOUT_MS = 30_000;

/** 断线重连：500ms 起指数退避，封顶 10s，再在指数延迟上加 0–20% 抖动。 */
export const RECONNECT_BASE_MS = 500;
export const RECONNECT_MAX_MS = 10_000;
const RECONNECT_JITTER = 0.2;

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

export interface ConnectionOptions {
  /** 随机源，默认 Math.random；测试用来固定重连抖动。 */
  random?: () => number;
}

export interface CallOptions {
  /** 毫秒。缺省 30000；0 表示不超时。 */
  timeout?: number;
}

/** subscribe / unsubscribe 的 result：操作完之后这条连接上的 topic 列表。 */
export interface SubscriptionResult {
  topics: string[];
}

export type EventListener = (payload: JsonObject) => void;

const defaultFactory: WebSocketFactory = (url) => new WebSocket(url);

/** 调用失败：code 来自错误帧，或连接层自己造的 not_connected / connection_closed / timeout。 */
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
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * 请求按 id 配对成 Promise，event 按 topic 派发；断线自动重连，close() 之后不再重连。
 * 重连后的重放（能力、订阅、当前页）由调用方按 open 状态做。
 */
export class Connection {
  private readonly url: string;
  private readonly factory: WebSocketFactory;
  private readonly random: () => number;
  private socket: WebSocketLike | null = null;
  private readonly pending = new Map<string, PendingCall>();
  private readonly listeners = new Set<(status: ConnectionStatus) => void>();
  private readonly eventListeners = new Map<string, Set<EventListener>>();
  private current: ConnectionStatus = "idle";
  private nextId = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;
  /** connect() 之后为 true、close() 之后为 false：只有显式 close() 会停止自动重连。 */
  private autoReconnect = false;

  constructor(
    url: string = DEFAULT_URL,
    factory: WebSocketFactory = defaultFactory,
    options: ConnectionOptions = {},
  ) {
    this.url = url;
    this.factory = factory;
    this.random = options.random ?? Math.random;
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

  /** 订阅一个 topic 的推送，可多个监听者；返回取消函数。event 永不进 pending。 */
  onEvent(topic: string, listener: EventListener): () => void {
    let topicListeners = this.eventListeners.get(topic);
    if (topicListeners === undefined) {
      topicListeners = new Set();
      this.eventListeners.set(topic, topicListeners);
    }
    topicListeners.add(listener);
    return () => {
      const current = this.eventListeners.get(topic);
      if (current === undefined) {
        return;
      }
      current.delete(listener);
      if (current.size === 0) {
        this.eventListeners.delete(topic);
      }
    };
  }

  /** 建立连接；已有一条 socket（connecting / open）时什么都不做。 */
  connect(): void {
    this.autoReconnect = true;
    this.cancelRetry();
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
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) {
        return;
      }
      this.retryAttempt = 0;
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
   * 发一帧 call。未连接直接拒绝。result / error 按 id 结算；超过 timeout 以
   * CallError("timeout") 拒绝，之后迟到的同 id 帧按未知 id 忽略。
   */
  call(
    target: string,
    method: string,
    args: JsonObject = {},
    options: CallOptions = {},
  ): Promise<unknown> {
    const socket = this.socket;
    if (this.current !== "open" || socket === null) {
      return Promise.reject(new CallError("not_connected", `未连接（${this.current}），不发请求`));
    }

    const id = String(++this.nextId);
    const frame = makeCall(id, target, method, args);
    const timeout = options.timeout ?? DEFAULT_CALL_TIMEOUT_MS;

    return new Promise<unknown>((resolve, reject) => {
      const pending: PendingCall = { resolve, reject, timer: null };
      this.pending.set(id, pending);

      if (timeout > 0) {
        pending.timer = setTimeout(() => {
          if (this.pending.get(id) !== pending) {
            return;
          }
          this.settle(id, pending);
          reject(new CallError("timeout", `调用 ${target}.${method} 超时（${timeout}ms）`));
        }, timeout);
      }

      try {
        socket.send(JSON.stringify(frame));
      } catch (error) {
        this.settle(id, pending);
        reject(error instanceof Error ? error : new CallError("send_failed", String(error)));
      }
    });
  }

  /** 订阅 topic；result 是操作完这条连接上的 topic 列表。重连后要重新订阅。 */
  async subscribe(topics: string[]): Promise<SubscriptionResult> {
    const value = await this.call("net", "subscribe", { topics });
    return value as SubscriptionResult;
  }

  /** 取消订阅；result 同样是操作完这条连接上的 topic 列表。 */
  async unsubscribe(topics: string[]): Promise<SubscriptionResult> {
    const value = await this.call("net", "unsubscribe", { topics });
    return value as SubscriptionResult;
  }

  /** 显式关闭：拒绝在途调用，取消重连。之后只有再调 connect() 才会重新连。 */
  close(): void {
    this.autoReconnect = false;
    this.cancelRetry();
    this.retryAttempt = 0;

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

    if (frame.type === "event") {
      this.emitEvent(frame.topic, frame.payload);
      return;
    }

    if (frame.type === "error" && frame.id === null) {
      console.error(`[omora] 错误帧没有 id，无法配对: ${frame.code} ${frame.message}`);
      return;
    }
    if (frame.id === null) {
      return;
    }
    const frameId = frame.id;

    const pending = this.pending.get(frameId);
    if (pending === undefined) {
      console.warn(`[omora] 收到未知 id 的帧: ${frameId}`);
      return;
    }
    this.settle(frameId, pending);

    if (frame.type === "error") {
      pending.reject(new CallError(frame.code, frame.message));
      return;
    }
    pending.resolve(frame.value);
  }

  /** 按 topic 派发；没人监听就静默忽略（未订阅的 topic 不是错误）。 */
  private emitEvent(topic: string, payload: unknown): void {
    const listeners = this.eventListeners.get(topic);
    if (listeners === undefined) {
      return;
    }
    const body = payload as JsonObject;
    for (const listener of [...listeners]) {
      try {
        listener(body);
      } catch (error) {
        console.error(`[omora] 处理 ${topic} 事件失败:`, error);
      }
    }
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
    this.scheduleReconnect();
  }

  /** 断线后按指数退避排下一次连接；显式 close() 之后不再排。 */
  private scheduleReconnect(): void {
    if (!this.autoReconnect || this.retryTimer !== null || this.socket !== null) {
      return;
    }

    const exponent = Math.min(RECONNECT_BASE_MS * 2 ** this.retryAttempt, RECONNECT_MAX_MS);
    this.retryAttempt += 1;
    const scale = 1 + RECONNECT_JITTER * this.random();
    const delay = Math.min(Math.round(exponent * scale), RECONNECT_MAX_MS);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  private cancelRetry(): void {
    if (this.retryTimer === null) {
      return;
    }
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
  private detach(socket: WebSocketLike): void {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
  }
  private settle(id: string, pending: PendingCall): void {
    this.pending.delete(id);
    if (pending.timer !== null) {
      clearTimeout(pending.timer);
      pending.timer = null;
    }
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      this.settle(id, pending);
      pending.reject(error);
    }
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
