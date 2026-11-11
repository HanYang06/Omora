import { describe, expect, it } from "vitest";
import { topicsToSync } from "./topics";

describe("topicsToSync", () => {
  it("没有变化时两边都空", () => {
    expect(topicsToSync(["a", "b"], ["b", "a"])).toEqual({ add: [], remove: [] });
  });

  it("新声明的补订，去掉的退订", () => {
    expect(topicsToSync(["ui.snapshot"], ["ui.snapshot", "audio.peaks"])).toEqual({
      add: ["audio.peaks"],
      remove: [],
    });
    expect(topicsToSync(["ui.snapshot", "audio.peaks"], ["ui.snapshot"])).toEqual({
      add: [],
      remove: ["audio.peaks"],
    });
  });

  it("两边一起换也能算清", () => {
    expect(topicsToSync(["old"], ["new"])).toEqual({ add: ["new"], remove: ["old"] });
  });

  it("空集也成立", () => {
    expect(topicsToSync([], [])).toEqual({ add: [], remove: [] });
  });
});
