import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CommandPalette } from "../src/shell/command-palette";
import { filterCommands, handlePaletteKey, isPaletteShortcut } from "../src/shell/palette-logic";
import type { ShellCommand } from "../src/shell/types";

const COMMANDS: readonly ShellCommand[] = [
  { owner: "omora.ideas", id: "ideas.new", title: "新建灵感" },
  { owner: "omora.projects", id: "projects.open", title: "打开项目" },
  { owner: "omora.search", id: "search.focus", title: "Search workspace" },
];

describe("command palette filtering", () => {
  it("matches title fragments case-insensitively", () => {
    expect(filterCommands(COMMANDS, "项目").map((command) => command.id)).toEqual([
      "projects.open",
    ]);
    expect(filterCommands(COMMANDS, "SEARCH").map((command) => command.id)).toEqual([
      "search.focus",
    ]);
  });

  it("keeps every command when the query is blank", () => {
    expect(filterCommands(COMMANDS, "   ")).toEqual(COMMANDS);
  });
});

describe("command palette keys", () => {
  it("dispatches the selected command id when Enter is pressed", () => {
    const outcome = handlePaletteKey(COMMANDS, { query: "项目", selected: 0 }, "Enter");

    expect(outcome.invoke).toEqual({ name: "projects.open" });
    expect(outcome.close).toBe(true);
  });

  it("closes without invoking a command when Escape is pressed", () => {
    const outcome = handlePaletteKey(COMMANDS, { query: "", selected: 1 }, "Escape");

    expect(outcome.invoke).toBeNull();
    expect(outcome.close).toBe(true);
    expect(outcome.handled).toBe(true);
  });

  it("moves the selection with the arrow keys and wraps at both ends", () => {
    const last = handlePaletteKey(COMMANDS, { query: "", selected: 2 }, "ArrowDown");
    const first = handlePaletteKey(COMMANDS, { query: "", selected: 0 }, "ArrowUp");

    expect(last.state.selected).toBe(0);
    expect(first.state.selected).toBe(2);
  });

  it("does nothing on Enter when the filter matches no command", () => {
    const outcome = handlePaletteKey(COMMANDS, { query: "不存在", selected: 0 }, "Enter");

    expect(outcome.invoke).toBeNull();
    expect(outcome.close).toBe(false);
  });
});

describe("command palette shortcut", () => {
  it("maps Ctrl+K and Cmd+K to the palette", () => {
    expect(isPaletteShortcut({ key: "k", ctrlKey: true, metaKey: false })).toBe(true);
    expect(isPaletteShortcut({ key: "K", ctrlKey: false, metaKey: true })).toBe(true);
    expect(isPaletteShortcut({ key: "k", ctrlKey: false, metaKey: false })).toBe(false);
    expect(isPaletteShortcut({ key: "j", ctrlKey: true, metaKey: false })).toBe(false);
  });
});

describe("command palette rendering", () => {
  function render(commands: readonly ShellCommand[]): string {
    return renderToStaticMarkup(
      <CommandPalette commands={commands} onClose={() => undefined} onInvoke={() => undefined} />,
    );
  }

  it("shows that no command is available when the snapshot exposes none", () => {
    expect(render([])).toContain("没有可用的命令");
  });

  it("lists every available command with its owner", () => {
    const html = render(COMMANDS);

    expect(html).toContain("新建灵感");
    expect(html).toContain("打开项目");
    expect(html).toContain("omora.projects");
  });
});
