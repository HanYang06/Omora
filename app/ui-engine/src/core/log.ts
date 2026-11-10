import type { JsonObject } from "./protocol";

/**
 * 与内核同一套级别（app/core/omora/core/log.py 的 LEVELS）：
 * trace 最细，error 最重。两边数值一样，过滤才有可比性。
 */
export const LEVELS = {
  trace: 5,
  debug: 10,
  info: 20,
  warning: 30,
  error: 40,
} as const;

export type Level = keyof typeof LEVELS;

export const DEFAULT_LEVEL: Level = "info";

/** 攒批：到 100ms 或 20 条就发一次。 */
export const FLUSH_MS = 100;
export const MAX_BATCH = 20;

/** 把一行送出去。和 Connection.call 同形，测试里可以打桩。 */
export type LogCall = (target: string, method: string, args: JsonObject) => Promise<unknown>;

/** 与内核落盘的一行同形。 */
export interface LogEntry {
  proc: "engine";
  ch: string;
  lvl: Level;
  msg: string;
  data: Record<string, unknown>;
}

export interface LogSettings {
  enabled: boolean;
  level: Level;
}

export interface LoggerOptions {
  call?: LogCall;
  /** 不给就从 VITE_OMORA_LOG / ?log= 推出来。 */
  enabled?: boolean;
  level?: Level;
  /** 根出口的通道名；钩子一律用 child("conn" | "render" | ...)。 */
  channel?: string;
}

/** 取逗号前那一段级别；认不出（含通道写法）就回默认。 */
export function levelOf(text: string | undefined): Level {
  const head = (text ?? "").split(",")[0]?.split(":")[0]?.trim().toLowerCase() ?? "";
  return Object.prototype.hasOwnProperty.call(LEVELS, head) ? (head as Level) : DEFAULT_LEVEL;
}

/**
 * 开关只认两个来源：?log=debug 优先，其次 VITE_OMORA_LOG。
 * 没配置、off、false、0 都是关（默认关）。
 */
export function resolveSettings(envValue: string | undefined, search: string): LogSettings {
  const query = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("log");
  const raw = (query ?? envValue ?? "").trim().toLowerCase();
  if (raw === "" || raw === "off" || raw === "false" || raw === "0" || raw === "no") {
    return { enabled: false, level: DEFAULT_LEVEL };
  }
  return { enabled: true, level: levelOf(raw) };
}

function configured(): LogSettings {
  const raw = import.meta.env.VITE_OMORA_LOG;
  const search = typeof window === "undefined" ? "" : window.location.search;
  return resolveSettings(typeof raw === "string" ? raw : undefined, search);
}

interface SharedState {
  queue: LogEntry[];
  timer: ReturnType<typeof setTimeout> | null;
  sending: boolean;
  pending: Promise<void> | null;
}

/** core 只收 dict；undefined 会被 JSON 变成 null，这里先剔掉。 */
function cleanData(data: Record<string, unknown> | undefined): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data ?? {})) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function mirror(entry: LogEntry): void {
  const prefix = `[engine] [${entry.ch}]`;
  const tail = Object.keys(entry.data).length > 0 ? ` ${JSON.stringify(entry.data)}` : "";
  const line = `${prefix} ${entry.msg}${tail}`;

  if (entry.lvl === "error") {
    console.error(line);
  } else if (entry.lvl === "warning") {
    console.warn(line);
  } else if (entry.lvl === "info") {
    console.info(line);
  } else {
    console.debug(line);
  }
}

/**
 * 一个引擎侧出口：控制台立刻照一份，内核那边攒批送。
 *
 * 内核是唯一写者：这里不碰文件，只把一批行送成 target=log / method=write_many
 * 的帧（与 docs/design/logging.md 的批量约定一致）。
 */
export class Logger {
  readonly channel: string;
  private readonly settings: LogSettings;
  private readonly call: LogCall | undefined;
  private readonly state: SharedState;

  constructor(
    settings: LogSettings,
    call: LogCall | undefined,
    state: SharedState,
    channel: string,
  ) {
    this.settings = settings;
    this.call = call;
    this.state = state;
    this.channel = channel;
  }

  get enabled(): boolean {
    return this.settings.enabled;
  }

  get level(): Level {
    return this.settings.level;
  }

  child(channel: string): Logger {
    return new Logger(this.settings, this.call, this.state, channel);
  }

  trace(msg: string, data?: Record<string, unknown>): void {
    this.emit("trace", msg, data);
  }

  debug(msg: string, data?: Record<string, unknown>): void {
    this.emit("debug", msg, data);
  }

  info(msg: string, data?: Record<string, unknown>): void {
    this.emit("info", msg, data);
  }

  warning(msg: string, data?: Record<string, unknown>): void {
    this.emit("warning", msg, data);
  }

  error(msg: string, data?: Record<string, unknown>): void {
    this.emit("error", msg, data);
  }

  /** 立刻把队列送出去；测试和退出前用。 */
  async flush(): Promise<void> {
    if (this.state.timer !== null) {
      clearTimeout(this.state.timer);
      this.state.timer = null;
    }
    if (this.state.pending !== null) {
      await this.state.pending;
    }

    const entries = this.state.queue.splice(0);
    if (entries.length === 0 || this.call === undefined || !this.settings.enabled) {
      return;
    }

    this.state.sending = true;
    const call = this.call;
    const pending = (async () => {
      try {
        // 一次 flush 一帧；单条日志帧（write）留给一次性调用。
        await call("log", "write_many", { entries } as unknown as JsonObject);
      } catch {
        // 日志送不出去不该反噬调用方；控制台那份已经打过了。
      }
    })();
    this.state.pending = pending;
    try {
      await pending;
    } finally {
      this.state.pending = null;
      this.state.sending = false;
    }
  }

  private emit(lvl: Level, msg: string, data?: Record<string, unknown>): void {
    if (!this.settings.enabled || LEVELS[lvl] < LEVELS[this.settings.level]) {
      return;
    }
    // 送日志的那次 call 不再往回记：否则 flush -> call -> log -> flush 自激。
    if (this.state.sending) {
      return;
    }

    const entry: LogEntry = {
      proc: "engine",
      ch: this.channel,
      lvl,
      msg,
      data: cleanData(data),
    };
    mirror(entry);

    if (this.call === undefined) {
      return;
    }

    this.state.queue.push(entry);
    if (this.state.queue.length >= MAX_BATCH) {
      void this.flush();
      return;
    }
    if (this.state.timer === null) {
      this.state.timer = setTimeout(() => {
        this.state.timer = null;
        void this.flush();
      }, FLUSH_MS);
    }
  }
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const auto = configured();
  const settings: LogSettings = {
    enabled: options.enabled ?? auto.enabled,
    level: options.level ?? auto.level,
  };
  const state: SharedState = {
    queue: [],
    timer: null,
    sending: false,
    pending: null,
  };
  return new Logger(settings, options.call, state, options.channel ?? "engine");
}
