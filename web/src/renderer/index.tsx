import { Fragment, type ReactElement, type ReactNode } from "react";

import type { C3Node, CmdInvokeParams } from "../contract";
import type { BindingScope } from "./binding";
import { Placeholder } from "./placeholder";
import { widgetFor } from "./registry";
import type { NodeContext } from "./types";

export interface RendererProps {
  nodes: readonly C3Node[];
  scope: BindingScope;
  onCommand?: ((command: CmdInvokeParams) => void) | undefined;
}

export function NodeRenderer({ nodes, scope, onCommand }: RendererProps): ReactElement {
  return <>{renderNodeList(nodes, scope, onCommand)}</>;
}

function renderNodeList(
  nodes: readonly C3Node[],
  scope: BindingScope,
  onCommand: ((command: CmdInvokeParams) => void) | undefined,
): ReactNode {
  const context: NodeContext = {
    scope,
    onCommand,
    renderNodes: (children, childScope) => renderNodeList(children, childScope, onCommand),
  };
  return nodes.map((node, index) => <Fragment key={index}>{renderNode(node, context)}</Fragment>);
}

function renderNode(node: C3Node, context: NodeContext): ReactNode {
  const Widget = widgetFor(node.type);
  if (Widget === undefined) {
    return <Placeholder type={node.type} />;
  }
  return <Widget node={node} context={context} />;
}
