import type { ReactNode } from "react";
import { prop, type NodeComponentProps } from "../core/shared";

/**
 * 图标词表：引擎只认识这几个内联路径，不引第三方图标库。
 * 名字对不上就画一个空位，不猜近似图标。
 */
const GLYPHS: Record<string, ReactNode> = {
  ideas: (
    <>
      <path d="M10 2.8a5.2 5.2 0 0 0-3.1 9.4v1.5h6.2v-1.5A5.2 5.2 0 0 0 10 2.8Z" />
      <path d="M8.3 16.4h3.4" />
      <path d="M8.8 18.2h2.4" />
    </>
  ),
  projects: (
    <>
      <path d="M3 6.2a1.4 1.4 0 0 1 1.4-1.4h3l1.7 1.9h6.5A1.4 1.4 0 0 1 17 8.1v6.3a1.4 1.4 0 0 1-1.4 1.4H4.4A1.4 1.4 0 0 1 3 14.4Z" />
      <path d="M3 8.9h14" />
    </>
  ),
  requirements: (
    <>
      <path d="M7.4 4.2H5.2v12.6h9.6V4.2h-2.2" />
      <rect x="7.4" y="2.6" width="5.2" height="3" rx="1" />
      <path d="M8 9.4h4M8 12.4h4M8 15.4h2.6" />
    </>
  ),
  settings: (
    <>
      <circle cx="10" cy="10" r="2.6" />
      <path d="M10 2.6v2M10 15.4v2M2.6 10h2M15.4 10h2M4.8 4.8l1.4 1.4M13.8 13.8l1.4 1.4M15.2 4.8l-1.4 1.4M6.2 13.8l-1.4 1.4" />
    </>
  ),
  search: (
    <>
      <circle cx="8.9" cy="8.9" r="4.6" />
      <path d="m12.3 12.3 3.9 3.9" />
    </>
  ),
  mic: (
    <>
      <rect x="8" y="2.8" width="4" height="7.4" rx="2" />
      <path d="M5.4 9.2a4.6 4.6 0 0 0 9.2 0" />
      <path d="M10 13.8v2.4M8 16.2h4" />
    </>
  ),
  video: (
    <>
      <rect x="2.8" y="5.6" width="10.2" height="8.8" rx="2" />
      <path d="m13 9 4.2-2.3v6.6L13 11" />
    </>
  ),
  text: <path d="M3.2 5.4h13.6M3.2 9.1h13.6M3.2 12.8h9.4M3.2 16.5h6" />,
  pin: (
    <>
      <path d="M7 2.8h6" />
      <path d="M8.2 2.8v3.6l-1.9 1.8v1.2h7.4V8.2l-1.9-1.8V2.8" />
      <path d="M10 9.4v7.8" />
    </>
  ),
  archive: (
    <>
      <rect x="3" y="4.4" width="14" height="3.6" rx="1" />
      <path d="M4.2 8v6.2a1.4 1.4 0 0 0 1.4 1.4h8.8a1.4 1.4 0 0 0 1.4-1.4V8" />
      <path d="M8.2 10.8h3.6" />
    </>
  ),
  back: <path d="M16 10H4M8.4 5.6 4 10l4.4 4.4" />,
  plus: <path d="M10 3.6v12.8M3.6 10h12.8" />,
  dot: <circle cx="10" cy="10" r="3.2" fill="currentColor" stroke="none" />,
};

/** 空位：虚线圆角框，明确表示"这个名字没有图标"。 */
function EmptySlot(): ReactNode {
  return <rect x="3.6" y="3.6" width="12.8" height="12.8" rx="2.4" strokeDasharray="2 2.4" />;
}

export interface IconGlyphProps {
  name: string;
  size?: number;
  className?: string;
}

/** 一个内联 SVG：20px、currentColor、描边风格。 */
export function IconGlyph({ name, size = 20, className }: IconGlyphProps): ReactNode {
  const glyph = GLYPHS[name];

  return (
    <svg
      className={className === undefined ? "omora-icon-svg" : `omora-icon-svg ${className}`}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon={name}
      data-known={glyph === undefined ? "false" : "true"}
    >
      {glyph ?? <EmptySlot />}
    </svg>
  );
}

/** icon：节点合同里的一个图标；名字不认识就画空位。 */
export function Icon({ node }: NodeComponentProps): ReactNode {
  return (
    <span className="omora-icon" data-type="icon">
      <IconGlyph name={prop(node, "name") ?? ""} />
    </span>
  );
}
