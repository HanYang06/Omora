import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BAD_FRAME, FrameError, isCallFrame, makeCall, parseInboundFrame } from "./protocol";

interface ValidCallCase {
  name: string;
  ok: true;
  frame: {
    id: string;
    type: string;
    target: string;
    method: string;
    args?: Record<string, unknown>;
  };
}

interface InvalidCase {
  name: string;
  ok: false;
  code: string;
  frame: unknown;
}

type FixtureCase = ValidCallCase | InvalidCase;

interface EventCase {
  name: string;
  ok: boolean;
  code?: string;
  frame: unknown;
}

interface Fixture {
  calls: FixtureCase[];
  events: EventCase[];
}

const FIXTURE_URL = new URL("../../../sdk/tests/fixtures/protocol.json", import.meta.url);
const fixture = JSON.parse(readFileSync(fileURLToPath(FIXTURE_URL), "utf8")) as Fixture;
const cases = fixture.calls;

const validCalls = cases.filter((item): item is ValidCallCase => item.ok);
const invalidFrames = cases.filter((item): item is InvalidCase => !item.ok);
const validEvents = fixture.events.filter((item) => item.ok);
const invalidEvents = fixture.events.filter((item) => !item.ok);

function errorFrom(run: () => unknown): FrameError {
  try {
    run();
  } catch (error) {
    if (error instanceof FrameError) {
      return error;
    }
    throw error;
  }
  throw new Error("预期抛 FrameError，但没有抛");
}

describe("协议：与 Python 共用同一份 fixture", () => {
  it.each(validCalls)("接受合法 call 帧: $name", (item) => {
    expect(isCallFrame(item.frame), item.name).toBe(true);
    expect(item.frame.type).toBe("call");
  });

  it.each(invalidFrames)("拒绝非法帧: $name", (item) => {
    expect(isCallFrame(item.frame), item.name).toBe(false);
  });
});

describe("event 帧：与 Python 共用同一份 fixture", () => {
  it.each(validEvents)("解合法 event 帧: $name", (item) => {
    const frame = parseInboundFrame(item.frame);
    if (frame.type !== "event") {
      throw new Error("预期是 event 帧");
    }
    const raw = item.frame as { topic: string; payload?: unknown };
    expect(frame.topic).toBe(raw.topic);
    expect(frame.payload).toEqual(raw.payload ?? {});
  });

  it.each(invalidEvents)("拒绝非法 event 帧: $name", (item) => {
    expect(errorFrom(() => parseInboundFrame(item.frame)).code).toBe(item.code);
  });
});

describe("makeCall", () => {
  it("带 id / target / method / args，且 type 是 call", () => {
    expect(makeCall("1", "ui", "render", { view: "main" })).toEqual({
      id: "1",
      type: "call",
      target: "ui",
      method: "render",
      args: { view: "main" },
    });
  });

  it("缺省 args 写成空对象", () => {
    expect(makeCall("2", "store", "items")).toEqual({
      id: "2",
      type: "call",
      target: "store",
      method: "items",
      args: {},
    });
  });
});

describe("parseInboundFrame", () => {
  it("解 result 帧，value 原样带出", () => {
    const value = [{ type: "text", props: { text: "hi" }, children: [] }];

    expect(parseInboundFrame({ id: "7", type: "result", value })).toEqual({
      id: "7",
      type: "result",
      value,
    });
  });

  it("解错误帧，code 与 message 原样带出", () => {
    expect(
      parseInboundFrame({
        id: "7",
        type: "error",
        code: "call_failed",
        message: "炸了",
      }),
    ).toEqual({
      id: "7",
      type: "error",
      code: "call_failed",
      message: "炸了",
    });
  });

  it("允许 id 为 null 的错误帧（帧没解析出来时 Python 无法回填 id）", () => {
    expect(
      parseInboundFrame({
        id: null,
        type: "error",
        code: "bad_frame",
        message: "帧必须是对象",
      }),
    ).toEqual({
      id: null,
      type: "error",
      code: "bad_frame",
      message: "帧必须是对象",
    });
  });

  it.each([
    { name: "数组不是帧对象", frame: [1, 2] },
    { name: "result 缺 id", frame: { type: "result", value: 1 } },
    { name: "result 的 id 为空串", frame: { id: "", type: "result", value: 1 } },
    { name: "未知 type", frame: { id: "1", type: "push", value: 1 } },
    { name: "error 缺 code", frame: { id: "1", type: "error", message: "x" } },
    { name: "event 缺 topic", frame: { type: "event", payload: {} } },
    { name: "event 的 topic 为空串", frame: { type: "event", topic: "" } },
    { name: "event 的 payload 不是对象", frame: { type: "event", topic: "x", payload: [] } },
  ])("拒绝非法入站帧: $name", ({ frame }) => {
    expect(errorFrom(() => parseInboundFrame(frame)).code).toBe(BAD_FRAME);
  });
});
