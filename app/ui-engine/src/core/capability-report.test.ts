import { describe, expect, it, vi } from "vitest";

import type { ConnectionStatus } from "./connection";
import {
  CAPABILITY_METHOD,
  CAPABILITY_TARGET,
  reportCapabilities,
  reportClientCapabilities,
} from "./capability-report";

vi.mock("../capture/devices", () => ({
  detectCapabilities: vi.fn(async () => ["microphone"]),
}));

interface Call {
  target: string;
  method: string;
  args: Record<string, unknown>;
}

function fakeConnection() {
  let listener: ((status: ConnectionStatus) => void) | null = null;
  const calls: Call[] = [];
  const connection = {
    calls,
    subscribeStatus(next: (status: ConnectionStatus) => void) {
      listener = next;
      next("idle");
      return () => {
        listener = null;
      };
    },
    call(target: string, method: string, args: Record<string, unknown> = {}) {
      calls.push({ target, method, args });
      return Promise.resolve({});
    },
    emit(status: ConnectionStatus) {
      listener?.(status);
    },
  };
  return connection;
}

async function flush(): Promise<void> {
  for (let index = 0; index < 4; index += 1) {
    await Promise.resolve();
  }
}

describe("reportCapabilities", () => {
  it("连接 open 后把检测到的能力上报给 manager，且只报一次", async () => {
    const connection = fakeConnection();
    const detect = vi.fn(async () => ["microphone", "camera"]);

    reportCapabilities(connection, detect);
    connection.emit("connecting");
    expect(connection.calls).toHaveLength(0);
    connection.emit("open");
    await flush();
    connection.emit("open");
    await flush();

    expect(connection.calls).toEqual([
      { target: CAPABILITY_TARGET, method: CAPABILITY_METHOD, args: { capabilities: ["microphone", "camera"] } },
    ]);
    expect(detect).toHaveBeenCalledTimes(1);
  });

  it("没有设备时也上报空列表，让 Python 侧知道客户端确实连上了", async () => {
    const connection = fakeConnection();

    reportCapabilities(connection, async () => []);
    connection.emit("open");
    await flush();

    expect(connection.calls[0]?.args).toEqual({ capabilities: [] });
  });

  it("检测失败只记日志，不打断连接", async () => {
    const connection = fakeConnection();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    reportCapabilities(connection, async () => {
      throw new Error("enumeration blocked");
    });
    connection.emit("open");
    await flush();

    expect(connection.calls).toHaveLength(0);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe("reportClientCapabilities", () => {
  it("连上后用 devices.ts 的检测结果上报，不用第二套枚举", async () => {
    const connection = fakeConnection();

    reportClientCapabilities(connection);
    connection.emit("open");
    await flush();

    expect(connection.calls).toEqual([
      {
        target: CAPABILITY_TARGET,
        method: CAPABILITY_METHOD,
        args: { capabilities: ["microphone"] },
      },
    ]);
  });
});

