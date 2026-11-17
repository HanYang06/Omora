/**
 * TreeView：把根宿主与渲染器注册表固定在一起的一层薄入口。
 *
 * 挂载 / 替换 / 卸载 / 销毁的语义全部在 TreeRuntime；TreeView 只负责把“这份视图用
 * 哪个宿主、哪张注册表”固定下来，给应用组合根一个稳定对象。测试与嵌入式使用可以
 * 直接持 TreeRuntime，少一层间接。
 */

import type { Document as TreeDocument } from "../../contract/tree_generated";
import { TreeRuntime, type TreeMountResult, type TreeRuntimeOptions } from "./runtime";
import type { TreeRuntimeDiagnostic } from "./types";

export class TreeView {
  private readonly runtime: TreeRuntime;

  constructor(options: TreeRuntimeOptions) {
    this.runtime = new TreeRuntime(options);
  }

  mount(value: unknown): TreeMountResult {
    return this.runtime.mount(value);
  }

  replace(value: unknown): TreeMountResult {
    return this.runtime.replace(value);
  }

  unmount(): void {
    this.runtime.unmount();
  }

  dispose(): void {
    this.runtime.dispose();
  }

  get mounted(): boolean {
    return this.runtime.mounted;
  }

  get disposed(): boolean {
    return this.runtime.disposed;
  }

  get document(): TreeDocument | null {
    return this.runtime.document;
  }

  get diagnostics(): readonly TreeRuntimeDiagnostic[] {
    return this.runtime.diagnostics;
  }
}
