import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import type { C3Node, UiSnapshot } from "./contract";
import { contributionsFromUi } from "./shell/contributions";
import { Shell } from "./shell/shell";

const SIDEBAR_NODES: readonly C3Node[] = [
  {
    type: "Stack",
    props: { direction: "vertical", gap: 8 },
    children: [
      { type: "Text", props: { text: "Omora", variant: "title" } },
      { type: "Text", props: { text: "渲染层就绪", variant: "caption" } },
    ],
  },
];

const MAIN_NODES: readonly C3Node[] = [
  {
    type: "Stack",
    props: { direction: "vertical", gap: 16 },
    children: [
      { type: "Text", props: { text: "组件词表", variant: "subtitle" } },
      {
        type: "Card",
        props: { title: "原语" },
        children: [
          {
            type: "List",
            props: { items: "$primitives", emptyText: "没有可显示的原语" },
            children: [{ type: "Text", props: { text: "$item", variant: "mono" } }],
          },
        ],
      },
      { type: "Input", props: { placeholder: "输入内容" } },
      { type: "Button", props: { label: "主要操作", variant: "primary" } },
    ],
  },
];

const DEMO_STATE = {
  demo: { primitives: ["Stack", "Text", "Button", "Input", "List", "Card"] },
};

const DEMO_UI: UiSnapshot = {
  slots: {
    sidebar: [{ owner: "demo", nodes: SIDEBAR_NODES as unknown as Record<string, unknown>[] }],
    main: [{ owner: "demo", nodes: MAIN_NODES as unknown as Record<string, unknown>[] }],
  },
};

const CONTRIBUTIONS = contributionsFromUi(DEMO_UI, DEMO_STATE);

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("找不到 #root 挂载点");
}

createRoot(rootElement).render(
  <StrictMode>
    <Shell contributions={CONTRIBUTIONS} />
  </StrictMode>,
);
