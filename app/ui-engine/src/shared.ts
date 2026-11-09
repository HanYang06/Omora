import type { ReactNode } from "react";
import type { EventHandler, MediaResolver, Node } from "./types";

export interface NodeComponentProps {
  node: Node;
  onEvent?: EventHandler;
  loadMedia?: MediaResolver;
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

export function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
