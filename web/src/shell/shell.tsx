import { useEffect, useState, type CSSProperties, type ReactElement } from "react";

import type { CmdInvokeParams } from "../contract";
import { CommandPalette } from "./command-palette";
import { MainArea } from "./main-area";
import { isPaletteShortcut } from "./palette-logic";
import { Sidebar } from "./sidebar";
import type { ConnectionStatus, ShellCommand, SlotContribution, SlotName } from "./types";

export { SLOT_NAMES } from "./types";
export type { SlotContribution, SlotName } from "./types";

export interface ShellProps {
  contributions: Partial<Record<SlotName, readonly SlotContribution[]>>;
  commands?: readonly ShellCommand[];
  revision?: number;
  status?: ConnectionStatus;
  notice?: string | undefined;
  onCommand?: ((command: CmdInvokeParams) => void) | undefined;
}

const SHELL_STYLE: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "280px minmax(0, 1fr)",
  height: "100vh",
  overflow: "hidden",
  background: "var(--omora-color-bg)",
  color: "var(--omora-color-fg)",
};

export function Shell({
  contributions,
  commands = [],
  revision = 0,
  status = "closed",
  notice,
  onCommand,
}: ShellProps): ReactElement {
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setPaletteOpen(false);
        return;
      }
      if (!isPaletteShortcut(event)) {
        return;
      }
      event.preventDefault();
      setPaletteOpen((open) => !open);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const closePalette = (): void => {
    setPaletteOpen(false);
  };

  const online = status === "online";

  return (
    <div data-shell="omora" style={SHELL_STYLE}>
      <Sidebar
        contributions={contributions.sidebar}
        onCommand={onCommand}
        revision={revision}
        status={status}
        notice={notice}
      />
      <MainArea
        contributions={contributions.main}
        onCommand={onCommand}
        emptyTitle={online ? "主区还没有内容" : "未连接内核"}
        emptyHint={
          online ? "插件激活后，它的界面会出现在这里。" : "启动内核后，插件贡献的界面会出现在这里。"
        }
      />
      {paletteOpen ? (
        <CommandPalette commands={commands} onClose={closePalette} onInvoke={onCommand} />
      ) : null}
    </div>
  );
}
