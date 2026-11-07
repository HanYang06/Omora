import type {
  CmdInvokeParams,
  CmdResult,
  EventSubscribeParams,
  PingResult,
  QueryInvokeParams,
  QueryResult,
  SnapshotResult,
  SubscribeResult,
} from "../contract";
import { isRecord } from "../lib/guards";
import {
  emptyProjection,
  fromSnapshot,
  applyEvent,
  type C1Event,
  type Projection,
} from "../store/projection";
import { RequestChannel } from "./channel";
import { C1Error, decodeFrame, readEvent, toError } from "./frames";
import { createBrowserSocket, defaultScheduler, type C1Scheduler, type C1Socket } from "./socket";

export type { C1Scheduler, C1Socket } from "./socket";
export { C1Error } from "./frames";

export type C1Status = "connecting" | "online" | "reconnecting" | "closed";

export interface C1ClientOptions {
  url: string;
  createSocket?: (url: string) => C1Socket;
  scheduler?: C1Scheduler;
  reconnectDelayMs?: number;
  onEvent?: (event: C1Event) => void;
  onSnapshot?: (snapshot: SnapshotResult) => void;
  onStatus?: (status: C1Status) => void;
  onError?: (error: Error) => void;
}

export class C1Client {
  private readonly url: string;
  private readonly createSocket: (url: string) => C1Socket;
  private readonly scheduler: C1Scheduler;
  private readonly reconnectDelayMs: number;
  private readonly onEvent: ((event: C1Event) => void) | undefined;
  private readonly onSnapshot: ((snapshot: SnapshotResult) => void) | undefined;
  private readonly onStatus: ((status: C1Status) => void) | undefined;
  private readonly onError: ((error: Error) => void) | undefined;
  private readonly channel = new RequestChannel();

  private socket: C1Socket | null = null;
  private status: C1Status = "closed";
  private projection: Projection = emptyProjection();
  private reconnectHandle: number | null = null;
  private closed = false;
  private resyncing = false;
  private ready: { resolve: () => void; reject: (error: Error) => void } | null = null;
  private readyPromise: Promise<void> | null = null;

  constructor(options: C1ClientOptions) {
    this.url = options.url;
    this.createSocket = options.createSocket ?? createBrowserSocket;
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.reconnectDelayMs = options.reconnectDelayMs ?? 1000;
    this.onEvent = options.onEvent;
    this.onSnapshot = options.onSnapshot;
    this.onStatus = options.onStatus;
    this.onError = options.onError;
  }

  connect(): Promise<void> {
    if (this.socket !== null) {
      return this.readyPromise ?? Promise.resolve();
    }
    const socket = this.createSocket(this.url);
    this.closed = false;
    this.setStatus("connecting");
    this.socket = socket;
    this.channel.setTransport((frame) => {
      socket.send(JSON.stringify(frame));
    });
    const ready = new Promise<void>((resolve, reject) => {
      this.ready = { resolve, reject };
    });
    this.readyPromise = ready;
    this.attach(socket);
    return ready;
  }

  close(): void {
    this.closed = true;
    this.cancelReconnect();
    this.releaseSocket();
    this.setStatus("closed");
  }

  getProjection(): Projection {
    return this.projection;
  }

  getStatus(): C1Status {
    return this.status;
  }

  stateSnapshot(): Promise<SnapshotResult> {
    return this.channel.send("state.snapshot", {}).then((result) => result as SnapshotResult);
  }

  cmdInvoke(params: CmdInvokeParams): Promise<CmdResult> {
    return this.channel.send("cmd.invoke", params).then((result) => result as CmdResult);
  }

  queryInvoke(params: QueryInvokeParams): Promise<QueryResult> {
    return this.channel.send("query.invoke", params).then((result) => result as QueryResult);
  }

  eventSubscribe(params: EventSubscribeParams): Promise<SubscribeResult> {
    return this.channel.send("event.subscribe", params).then((result) => result as SubscribeResult);
  }

  ping(): Promise<PingResult> {
    return this.channel.send("ping", {}).then((result) => result as PingResult);
  }

  private attach(socket: C1Socket): void {
    socket.onOpen(() => {
      this.handleOpen(socket);
    });
    socket.onMessage((payload) => {
      this.handleMessage(payload);
    });
    socket.onClose(() => {
      this.handleClose(socket);
    });
    socket.onError(() => {
      this.handleSocketError(socket);
    });
  }

  private handleOpen(socket: C1Socket): void {
    if (this.socket !== socket) {
      return;
    }
    this.setStatus("online");
    void this.resync();
  }

  private handleClose(socket: C1Socket): void {
    if (this.socket !== socket) {
      return;
    }
    this.socket = null;
    this.channel.setTransport(null);
    const error = new C1Error("E_UNAVAILABLE", "C1 连接已断开");
    this.channel.rejectAll(error);
    this.rejectReady(error);
    if (this.closed) {
      this.setStatus("closed");
      return;
    }
    this.setStatus("reconnecting");
    this.scheduleReconnect();
  }

  private handleSocketError(socket: C1Socket): void {
    if (this.socket !== socket) {
      return;
    }
    socket.close();
    this.handleClose(socket);
  }

  private handleMessage(payload: string): void {
    const frame = decodeFrame(payload);
    if (frame === null) {
      return;
    }
    if (frame.method === "event") {
      if (isRecord(frame.params)) {
        const event = readEvent(frame.params);
        if (event !== null) {
          this.handleEvent(event);
        }
      }
      return;
    }
    this.channel.resolve(frame);
  }

  private handleEvent(event: C1Event): void {
    if (this.resyncing) {
      return;
    }
    const outcome = applyEvent(this.projection, event);
    if (outcome.status === "gap") {
      void this.resync();
      return;
    }
    if (outcome.status === "duplicate") {
      return;
    }
    this.projection = outcome.projection;
    this.onEvent?.(event);
  }

  private async resync(): Promise<void> {
    if (this.resyncing) {
      return;
    }
    this.resyncing = true;
    try {
      const snapshot = await this.stateSnapshot();
      this.projection = fromSnapshot(snapshot);
      this.onSnapshot?.(snapshot);
      const subscribed = await this.eventSubscribe({ since: snapshot.revision });
      if (subscribed.revision > snapshot.revision) {
        const caughtUp = await this.stateSnapshot();
        this.projection = fromSnapshot(caughtUp);
        this.onSnapshot?.(caughtUp);
      }
      this.resyncing = false;
      this.resolveReady();
    } catch (error: unknown) {
      this.resyncing = false;
      this.reportError(error);
      this.rejectReady(toError(error));
      this.dropConnection();
    }
  }

  private releaseSocket(): void {
    const socket = this.socket;
    this.socket = null;
    this.channel.setTransport(null);
    socket?.close();
    const error = new C1Error("E_UNAVAILABLE", "C1 连接已关闭");
    this.channel.rejectAll(error);
    this.rejectReady(error);
  }

  private dropConnection(): void {
    const socket = this.socket;
    if (socket === null) {
      return;
    }
    socket.close();
    this.handleClose(socket);
  }

  private scheduleReconnect(): void {
    if (this.reconnectHandle !== null) {
      return;
    }
    this.reconnectHandle = this.scheduler.schedule(() => {
      this.reconnectHandle = null;
      if (this.closed) {
        return;
      }
      this.connect().catch((error: unknown) => {
        this.reportError(error);
      });
    }, this.reconnectDelayMs);
  }

  private cancelReconnect(): void {
    if (this.reconnectHandle === null) {
      return;
    }
    this.scheduler.cancel(this.reconnectHandle);
    this.reconnectHandle = null;
  }

  private setStatus(status: C1Status): void {
    if (this.status === status) {
      return;
    }
    this.status = status;
    this.onStatus?.(status);
  }

  private resolveReady(): void {
    const ready = this.ready;
    this.ready = null;
    this.readyPromise = null;
    ready?.resolve();
  }

  private rejectReady(error: Error): void {
    const ready = this.ready;
    this.ready = null;
    this.readyPromise = null;
    ready?.reject(error);
  }

  private reportError(error: unknown): void {
    this.onError?.(toError(error));
  }
}
