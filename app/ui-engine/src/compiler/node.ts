import { JSDOM } from "jsdom";
import { compileBootSkeleton } from "./boot-skeleton";

/**
 * Node 侧宿主：Vite / CLI 在构建期没有 DOM，编译前用 jsdom 临时立一个。
 *
 * 只替换 `window` / `document`，编译完立刻还原；编译核心不认识 jsdom。
 * kind 只在 create/update 里碰 DOM、不在模块顶层碰，所以可以先 import 再立宿主。
 */

const HOST_GLOBALS = ["window", "document"] as const;

type HostGlobal = (typeof HOST_GLOBALS)[number];

interface SavedGlobal {
  name: HostGlobal;
  descriptor: PropertyDescriptor | undefined;
}

function saveGlobals(): SavedGlobal[] {
  return HOST_GLOBALS.map((name) => ({
    name,
    descriptor: Object.getOwnPropertyDescriptor(globalThis, name),
  }));
}

function install(window: Window & typeof globalThis): void {
  for (const name of HOST_GLOBALS) {
    Object.defineProperty(globalThis, name, {
      value: window[name],
      configurable: true,
      writable: true,
    });
  }
}

function restore(saved: SavedGlobal[]): void {
  for (const { name, descriptor } of saved) {
    if (descriptor === undefined) {
      Reflect.deleteProperty(globalThis, name);
      continue;
    }
    Object.defineProperty(globalThis, name, descriptor);
  }
}

/** 在 Node 里编译启动骨架；同一进程可重复调用，每次都是独立 DOM。 */
export function compileBootSkeletonInNode(): string {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
  });
  const saved = saveGlobals();
  install(dom.window as unknown as Window & typeof globalThis);
  try {
    return compileBootSkeleton();
  } finally {
    restore(saved);
    dom.window.close();
  }
}
