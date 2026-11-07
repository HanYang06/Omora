import type { Request, RequestId } from "../contract";
import { C1Error, readError, toError } from "./frames";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export class RequestChannel {
  private readonly pending = new Map<RequestId, PendingRequest>();
  private nextId = 1;
  private transport: ((frame: Request) => void) | null = null;

  setTransport(transport: ((frame: Request) => void) | null): void {
    this.transport = transport;
  }

  send(method: Request["method"], params: unknown): Promise<unknown> {
    const transport = this.transport;
    if (transport === null) {
      return Promise.reject(new C1Error("E_UNAVAILABLE", "C1 连接未建立"));
    }
    const id = this.takeId();
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        transport({ jsonrpc: "2.0", id, method, params } as Request);
      } catch (error: unknown) {
        this.pending.delete(id);
        reject(toError(error));
      }
    });
  }

  resolve(frame: Record<string, unknown>): void {
    const id = frame.id;
    if (typeof id !== "string" && typeof id !== "number") {
      return;
    }
    const pending = this.pending.get(id);
    if (pending === undefined) {
      return;
    }
    this.pending.delete(id);
    if ("error" in frame) {
      pending.reject(readError(frame.error));
      return;
    }
    if ("result" in frame) {
      pending.resolve(frame.result);
    }
  }

  rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  private takeId(): RequestId {
    const id = this.nextId;
    this.nextId += 1;
    return id;
  }
}
