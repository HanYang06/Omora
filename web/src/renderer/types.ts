import type { ReactNode } from "react";

import type { C3Node, CmdInvokeParams } from "../contract";
import type { BindingScope } from "./binding";

export type NodeOf<T extends C3Node["type"]> = Extract<C3Node, { type: T }>;

export interface NodeContext {
  scope: BindingScope;
  onCommand: ((command: CmdInvokeParams) => void) | undefined;
  renderNodes: (nodes: readonly C3Node[], scope: BindingScope) => ReactNode;
}

export interface WidgetProps {
  node: C3Node;
  context: NodeContext;
}

export type WidgetComponent = (props: WidgetProps) => ReactNode;
