import { Component, memo, type ReactNode } from "react";
import { components } from "./components";
import type { EventHandler, MediaResolver, Node } from "../core/types";

/**
 * 节点数据 → React 元素。
 *
 * 每个节点外面套一层 memo，比较的是节点数据的**引用**：补丁应用后没变的子树保持
 * 同一个对象（见 `patch.ts`），memo 因此直接跳过这棵子树——组件不重画，children
 * 也不重建。整棵重建会让这条路径失效。
 *
 * key 用位置（下标）而不是节点引用：补丁必然沿着从根到改动点的路径克隆节点，
 * 如果按引用给 key，根节点一变就会把整棵树重新挂载，memo 白做。
 */

interface NodeViewProps {
  node: Node;
  onEvent?: EventHandler;
  loadMedia?: MediaResolver;
}

function NodeView({ node, onEvent, loadMedia }: NodeViewProps): ReactNode {
  const type = typeof node.type === "string" ? node.type : "";
  const Component = components[type];
  if (Component === undefined) {
    console.warn("[omora] 未知组件类型:", type || "(空)");
    return <UnknownNode type={type} />;
  }

  const children = Array.isArray(node.children) ? node.children : [];
  return (
    <Component node={node} onEvent={onEvent} loadMedia={loadMedia}>
      {renderTree(children, onEvent, loadMedia)}
    </Component>
  );
}

/** 只有节点数据引用与两个回调都没变时才跳过。 */
const MemoNode = memo(NodeView);

interface BoundaryProps {
  /** 节点数据；它换了才允许重试一次，避免同一条坏节点无限重画。 */
  resetKey: unknown;
  children: ReactNode;
}

interface BoundaryState {
  failed: boolean;
}

/**
 * 每个节点外面套一层错误边界：一个组件抛异常只换掉它那一格，壳和兄弟节点照常。
 *
 * 重试条件是节点数据换了（引用不同），不是每次渲染都重试——同一个坏节点反复重画
 * 只会刷屏。React 的错误边界只能在 class 组件里，所以这里是唯一一个 class。
 */
class NodeBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    console.error("[omora] 节点渲染失败:", error);
  }

  componentDidUpdate(previous: BoundaryProps): void {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render(): ReactNode {
    return this.state.failed ? <FailedNode /> : this.props.children;
  }
}

function FailedNode(): ReactNode {
  return (
    <div className="omora-unknown" data-failed="true">
      这一块暂时显示不出来
    </div>
  );
}

/** 节点数组 → React 节点数组。children 一律按数组处理。 */
export function renderTree(
  nodes: Node[],
  onEvent?: EventHandler,
  loadMedia?: MediaResolver,
): ReactNode[] {
  const list = Array.isArray(nodes) ? nodes : [];
  return list.map((node, index) => {
    if (node === null || typeof node !== "object") {
      console.warn("[omora] 节点必须是对象:", node);
      return <UnknownNode key={String(index)} type="" />;
    }
    return (
      <NodeBoundary key={String(index)} resetKey={node}>
        <MemoNode node={node} onEvent={onEvent} loadMedia={loadMedia} />
      </NodeBoundary>
    );
  });
}

function UnknownNode({ type }: { type: string }): ReactNode {
  return (
    <div className="omora-unknown" data-unknown-type={type}>
      {`未知组件: ${type || "(空)"}`}
    </div>
  );
}
