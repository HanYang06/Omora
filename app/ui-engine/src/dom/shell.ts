import type { ConnectionStatus } from "../core/connection";
import type { JsonObject } from "../core/protocol";
import type { MediaData, PageEntry, Snapshot } from "../core/types";
import { iconGlyph } from "../components/icons";
import { DomRenderer } from "./renderer";
import { registry } from "../components/registry";
import type { RenderContext } from "./types";

const STATUS_TEXT: Record<ConnectionStatus, string> = {
  idle: "未连接",
  connecting: "连接中…",
  open: "已连接",
  closed: "连接已断开",
  failed: "连接失败",
};

const DEFAULT_ICON = "dot";

export interface ShellOptions {
  onNavigate(page: string): void;
  onEvent(handler: string, payload?: JsonObject): void;
  loadMedia(media: string): Promise<MediaData>;
}

function pagesKey(pages: PageEntry[]): string {
  return JSON.stringify(
    pages.map((page) => [page.name, page.label, page.icon ?? "", page.glyph ?? ""]),
  );
}

/** 默认母页面：56px 图标栏 + 主区；主区内容交给 DomRenderer。 */
export class DomShell {
  private readonly options: ShellOptions;
  private readonly root: HTMLElement;
  private readonly nav: HTMLElement;
  private readonly pageInner: HTMLElement;
  private readonly status: HTMLElement;
  private readonly statusLabel: HTMLElement;
  private readonly renderer: DomRenderer;
  private readonly navButtons = new Map<string, HTMLButtonElement>();
  private navKey = "";

  constructor(container: HTMLElement, options: ShellOptions) {
    this.options = options;
    this.root = document.createElement("div");
    this.root.className = "omora-app";
    this.root.dataset.connection = "idle";

    const rail = document.createElement("aside");
    rail.className = "omora-shell-rail";
    this.nav = document.createElement("nav");
    this.nav.className = "omora-shell-nav";
    this.nav.setAttribute("aria-label", "页面");

    const foot = document.createElement("div");
    foot.className = "omora-shell-foot";
    this.status = document.createElement("div");
    this.status.className = "omora-conn";
    this.status.dataset.status = "idle";
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-label", STATUS_TEXT.idle);
    const dot = document.createElement("span");
    dot.className = "omora-conn-dot";
    dot.setAttribute("aria-hidden", "true");
    this.statusLabel = document.createElement("span");
    this.statusLabel.className = "omora-conn-label";
    this.statusLabel.textContent = STATUS_TEXT.idle;
    this.status.append(dot, this.statusLabel);
    foot.append(this.status);
    rail.append(this.nav, foot);

    const main = document.createElement("main");
    main.className = "omora-page";
    this.pageInner = document.createElement("div");
    this.pageInner.className = "omora-page-inner";
    main.append(this.pageInner);

    this.root.append(rail, main);
    container.append(this.root);

    const context: RenderContext = {
      event: (handler, payload) => options.onEvent(handler, payload),
      loadMedia: (media) => options.loadMedia(media),
      cleanup: () => undefined,
    };
    this.renderer = new DomRenderer({ registry, context });
  }

  render(snapshot: Snapshot | null, status: ConnectionStatus, endpoint: string): void {
    this.root.dataset.connection = status;
    this.status.dataset.status = status;
    this.status.setAttribute("aria-label", STATUS_TEXT[status]);
    this.status.title = endpoint;
    this.statusLabel.textContent = STATUS_TEXT[status];

    this.renderNav(snapshot?.pages ?? [], snapshot?.page ?? "");

    if (snapshot === null) {
      this.renderer.dispose();
      this.pageInner.replaceChildren();
      return;
    }
    this.renderer.render(snapshot.content, this.pageInner);
  }

  dispose(): void {
    this.renderer.dispose();
    this.root.remove();
  }

  private renderNav(pages: PageEntry[], current: string): void {
    const key = pagesKey(pages);
    if (key !== this.navKey) {
      this.navKey = key;
      this.navButtons.clear();
      this.nav.replaceChildren();
      for (const entry of pages) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "omora-shell-item";
        button.dataset.page = entry.name;
        const icon = entry.icon !== undefined && entry.icon.length > 0 ? entry.icon : DEFAULT_ICON;
        button.dataset.icon = icon;
        button.setAttribute("aria-label", entry.label);
        button.title = entry.label;
        button.append(iconGlyph(icon, entry.glyph));
        button.addEventListener("click", () => this.options.onNavigate(entry.name));
        this.navButtons.set(entry.name, button);
        this.nav.append(button);
      }
    }
    for (const [name, button] of this.navButtons) {
      if (name === current) {
        button.setAttribute("aria-current", "page");
      } else {
        button.removeAttribute("aria-current");
      }
    }
  }
}
