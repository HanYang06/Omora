import type { ReactNode } from "react";
import type { DeviceSource } from "../capture/devices";
import type { EventHandler, MediaResolver, Node } from "./types";

export interface NodeComponentProps {
  node: Node;
  onEvent?: EventHandler;
  loadMedia?: MediaResolver;
  /** 设备来源；缺省用 navigator.mediaDevices。测试里传假的。 */
  devices?: DeviceSource;
  children?: ReactNode;
}

export function textOf(node: Node): string {
  const value = node.props?.text;
  return typeof value === "string" ? value : "";
}

export function prop(node: Node, name: string): string | undefined {
  const value = node.props?.[name];
  return typeof value === "string" ? value : undefined;
}

/** props 里的布尔开关；只有真正的 true 才算开。 */
export function flag(node: Node, name: string): boolean {
  return node.props?.[name] === true;
}

export function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
