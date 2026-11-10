import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLogger,
  DEFAULT_LEVEL,
  FLUSH_MS,
  MAX_BATCH,
  resolveSettings,
  type LogEntry,
  type Logger,
} from "./log";
import type { JsonObject } from "./protocol";

interface Batch {
  target: string;
  method: string;
  entries: LogEntry[];
}

function makeCall() {
  const calls: Batch[] = [];
  const call = vi.fn(async (target: string, method: string, args: JsonObject): Promise<number> => {
    calls.push({ target, method, entries: (args as { entries: LogEntry[] }).entries });
    return 0;
  });
  return { call, calls };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("级别", () => {
  it("低于门槛的不进 console，也不进 entries", async () => {
    const { call, calls } = makeCall();
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const logger = createLogger({ call, enabled: true, level: "info" });
    const render = logger.child("render");

    render.debug("看不见", { page: "ideas" });
    render.info("看得见", { page: "ideas" });

    await vi.advanceTimersByTimeAsync(FLUSH_MS);

    expect(debug).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(expect.stringContaining("[engine] [render] 看得见"));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.entries).toEqual([
      { proc: "engine", ch: "render", lvl: "info", msg: "看得见", data: { page: "ideas" } },
    ]);
  });
});

describe("批量", () => {
  it("100ms 内攒成一批，到点只发一帧 write_many", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    const { call, calls } = makeCall();
    const logger = createLogger({ call, enabled: true, level: "trace" });
    const render = logger.child("render");

    render.debug("一", { page: "ideas" });
    render.debug("二");
    render.debug("三", { nodes: 31, ms: 1.4 });

    expect(calls).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(FLUSH_MS - 1);
    expect(calls).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.target).toBe("log");
    expect(calls[0]?.method).toBe("write_many");
    expect(calls[0]?.entries).toEqual([
      { proc: "engine", ch: "render", lvl: "debug", msg: "一", data: { page: "ideas" } },
      { proc: "engine", ch: "render", lvl: "debug", msg: "二", data: {} },
      { proc: "engine", ch: "render", lvl: "debug", msg: "三", data: { nodes: 31, ms: 1.4 } },
    ]);
  });

  it("到 20 条立刻发一帧，不等满 100ms", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { call, calls } = makeCall();
    const logger = createLogger({ call, enabled: true, level: "trace" });
    const render = logger.child("render");

    for (let index = 0; index < MAX_BATCH; index += 1) {
      render.info(`第 ${index} 条`);
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]?.entries).toHaveLength(MAX_BATCH);
    expect(calls[0]?.entries.every((entry) => entry.data !== undefined)).toBe(true);

    await logger.flush();
  });

  it("data 里的 undefined 不进 entries", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { call, calls } = makeCall();
    const logger = createLogger({ call, enabled: true, level: "trace" });

    logger.child("render").info("x", { keep: 1, skip: undefined });
    await logger.flush();

    expect(calls[0]?.entries[0]?.data).toEqual({ keep: 1 });
  });

  it("不同通道共用同一个批次，但每条的 ch 各自保留", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
    const { call, calls } = makeCall();
    const logger = createLogger({ call, enabled: true, level: "trace" });

    logger.child("conn").info("ws 连上");
    logger.child("event").debug("发出事件", { handler: "ideas:1:0" });
    await logger.flush();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.entries.map((entry) => entry.ch)).toEqual(["conn", "event"]);
  });
});

describe("开关", () => {
  it("enabled=false 时 console 和内核都不动", async () => {
    const { call, calls } = makeCall();
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createLogger({ call, enabled: false, level: "trace" });

    logger.child("render").info("不发");
    logger.child("render").error("也不发");

    await vi.advanceTimersByTimeAsync(FLUSH_MS);

    expect(calls).toHaveLength(0);
    expect(debug).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("resolveSettings：?log= 优先，VITE_OMORA_LOG 次之，没配就关", () => {
    expect(resolveSettings(undefined, "?log=debug")).toEqual({
      enabled: true,
      level: "debug",
    });
    expect(resolveSettings("warning", "")).toEqual({ enabled: true, level: "warning" });
    expect(resolveSettings("trace", "")).toEqual({ enabled: true, level: "trace" });

    for (const raw of [undefined, "", "off", "false", "0", "no"]) {
      expect(resolveSettings(raw, "")).toEqual({ enabled: false, level: DEFAULT_LEVEL });
    }
  });
});

describe("console", () => {
  it("带 [engine] [通道] 前缀，按级别走 console 方法", () => {
    const { call } = makeCall();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createLogger({ call, enabled: true, level: "trace" });
    const media = logger.child("media");

    media.warning("加载失败", { media: "abc" });
    media.error("炸了");

    expect(warn).toHaveBeenCalledWith('[engine] [media] 加载失败 {"media":"abc"}');
    expect(error).toHaveBeenCalledWith("[engine] [media] 炸了");
  });
});

describe("防自激", () => {
  it("发日志的那帧 call 自己不再记一条", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    let logger: Logger | undefined;
    const call = vi.fn(async (): Promise<number> => {
      logger?.child("render").info("发送中");
      return 1;
    });
    logger = createLogger({ call, enabled: true, level: "trace" });

    logger.child("render").info("hello");
    await logger.flush();

    expect(call).toHaveBeenCalledTimes(1);
  });
});
