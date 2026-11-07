import {
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
} from "react";

import type { CmdInvokeParams } from "../contract";
import {
  clampSelection,
  filterCommands,
  handlePaletteKey,
  INITIAL_PALETTE_STATE,
} from "./palette-logic";
import type { ShellCommand } from "./types";

export interface CommandPaletteProps {
  commands: readonly ShellCommand[];
  onClose: () => void;
  onInvoke?: ((command: CmdInvokeParams) => void) | undefined;
}

const OVERLAY_STYLE: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 100,
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  padding: "12vh var(--omora-space-lg) var(--omora-space-xl)",
  background: "var(--omora-color-scrim)",
};

const PANEL_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: "min(560px, 100%)",
  maxHeight: "min(420px, 70vh)",
  overflow: "hidden",
  background: "var(--omora-color-surface-raised)",
  border: "1px solid var(--omora-color-border-strong)",
  borderRadius: "var(--omora-radius-lg)",
  boxShadow: "var(--omora-shadow-lg)",
};

const INPUT_STYLE: CSSProperties = {
  width: "100%",
  padding: "14px var(--omora-space-lg)",
  border: "none",
  borderBottom: "1px solid var(--omora-color-border)",
  background: "transparent",
  color: "var(--omora-color-fg)",
  fontSize: "0.9375rem",
};

const LIST_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "2px",
  margin: 0,
  padding: "var(--omora-space-sm)",
  overflowY: "auto",
  listStyle: "none",
};

const EMPTY_STYLE: CSSProperties = {
  margin: 0,
  padding: "var(--omora-space-xl)",
  color: "var(--omora-color-fg-muted)",
  textAlign: "center",
};

const OPTION_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: "var(--omora-space-md)",
  padding: "var(--omora-space-sm) var(--omora-space-md)",
  borderRadius: "var(--omora-radius-sm)",
  cursor: "pointer",
};

const OPTION_ACTIVE_STYLE: CSSProperties = {
  background: "var(--omora-color-primary-soft)",
};

const OPTION_TITLE_STYLE: CSSProperties = { fontSize: "0.875rem", fontWeight: 500 };

const OPTION_OWNER_STYLE: CSSProperties = {
  flexShrink: 0,
  color: "var(--omora-color-fg-faint)",
  fontFamily: "var(--omora-font-mono)",
  fontSize: "0.625rem",
};

const FOOTER_STYLE: CSSProperties = {
  display: "flex",
  gap: "var(--omora-space-md)",
  padding: "var(--omora-space-sm) var(--omora-space-lg)",
  borderTop: "1px solid var(--omora-color-border)",
  color: "var(--omora-color-fg-faint)",
  fontFamily: "var(--omora-font-mono)",
  fontSize: "0.6875rem",
};

interface PaletteResultsProps {
  commands: readonly ShellCommand[];
  filtered: readonly ShellCommand[];
  active: number;
  onChoose: (command: ShellCommand) => void;
}

function PaletteResults({
  commands,
  filtered,
  active,
  onChoose,
}: PaletteResultsProps): ReactElement {
  if (filtered.length === 0) {
    return (
      <p data-command-empty="true" style={EMPTY_STYLE}>
        {commands.length === 0 ? "没有可用的命令" : "没有匹配的命令"}
      </p>
    );
  }
  return (
    <ul role="listbox" aria-label="命令列表" style={LIST_STYLE}>
      {filtered.map((command, index) => (
        <li
          key={command.id}
          role="option"
          aria-selected={index === active}
          data-command-option={command.id}
          onClick={() => {
            onChoose(command);
          }}
          style={index === active ? { ...OPTION_STYLE, ...OPTION_ACTIVE_STYLE } : OPTION_STYLE}
        >
          <span style={OPTION_TITLE_STYLE}>{command.title}</span>
          <span style={OPTION_OWNER_STYLE}>{command.owner}</span>
        </li>
      ))}
    </ul>
  );
}

export function CommandPalette({ commands, onClose, onInvoke }: CommandPaletteProps): ReactElement {
  const [state, setState] = useState(INITIAL_PALETTE_STATE);
  const filtered = filterCommands(commands, state.query);
  const active = clampSelection(state.selected, filtered.length);

  const choose = (command: ShellCommand): void => {
    onInvoke?.({ name: command.id });
    onClose();
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setState({ query: event.target.value, selected: 0 });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    const outcome = handlePaletteKey(commands, state, event.key);
    if (!outcome.handled) {
      return;
    }
    event.preventDefault();
    setState(outcome.state);
    if (outcome.invoke !== null) {
      onInvoke?.(outcome.invoke);
    }
    if (outcome.close) {
      onClose();
    }
  };

  return (
    <div data-command-palette="true" style={OVERLAY_STYLE} onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        style={PANEL_STYLE}
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
      >
        <input
          autoFocus
          type="text"
          data-palette-input="true"
          aria-label="搜索命令"
          placeholder="搜索命令"
          value={state.query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          style={INPUT_STYLE}
        />
        <PaletteResults commands={commands} filtered={filtered} active={active} onChoose={choose} />
        <footer style={FOOTER_STYLE}>↑↓ 选择 · Enter 执行 · Esc 关闭</footer>
      </section>
    </div>
  );
}
