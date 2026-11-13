// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { registry } from "./registry";

/** legacy 节点词表的全部 type；DOM renderer 必须一个不少。 */
const EXPECTED = [
  "column",
  "row",
  "text",
  "button",
  "input",
  "recorder",
  "audio",
  "audio_capture",
  "video_capture",
  "video",
  "hotkey",
  "waveform",
  "list",
  "slot",
  "item",
  "empty",
  "search",
  "suggestion",
  "result",
  "split",
  "rail",
  "panel",
  "icon",
  "tile",
  "chip",
  "card",
  "switch",
  "checkbox",
  "radio",
  "select",
  "textarea",
  "number_input",
  "slider",
  "field",
  "button_group",
  "tabs",
  "accordion",
  "progress",
];

describe("kind registry", () => {
  it("覆盖 legacy 的全部 38 个节点类型", () => {
    expect(Object.keys(registry).sort()).toEqual([...EXPECTED].sort());
  });

  it("每个 kind 都能 create 一个元素", () => {
    for (const [type, kind] of Object.entries(registry)) {
      const el = kind.create(
        { type, props: {}, children: [] },
        {
          event: () => undefined,
          loadMedia: () => Promise.resolve({ mime: "", data: "" }),
          cleanup: () => undefined,
        },
      );
      expect(el, type).toBeInstanceOf(HTMLElement);
      if (el.dataset.type !== undefined) {
        expect(el.dataset.type, type).toBe(type);
      }
    }
  });
});
