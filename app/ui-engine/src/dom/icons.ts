type GlyphPart =
  | { tag: "path"; d: string }
  | { tag: "circle"; cx: number; cy: number; r: number; fill?: string; stroke?: string }
  | { tag: "rect"; x: number; y: number; width: number; height: number; rx?: number };

const GLYPHS: Record<string, GlyphPart[]> = {
  ideas: [
    { tag: "path", d: "M10 2.8a5.2 5.2 0 0 0-3.1 9.4v1.5h6.2v-1.5A5.2 5.2 0 0 0 10 2.8Z" },
    { tag: "path", d: "M8.3 16.4h3.4" },
    { tag: "path", d: "M8.8 18.2h2.4" },
  ],
  projects: [
    {
      tag: "path",
      d: "M3 6.2a1.4 1.4 0 0 1 1.4-1.4h3l1.7 1.9h6.5A1.4 1.4 0 0 1 17 8.1v6.3a1.4 1.4 0 0 1-1.4 1.4H4.4A1.4 1.4 0 0 1 3 14.4Z",
    },
    { tag: "path", d: "M3 8.9h14" },
  ],
  requirements: [
    { tag: "path", d: "M7.4 4.2H5.2v12.6h9.6V4.2h-2.2" },
    { tag: "rect", x: 7.4, y: 2.6, width: 5.2, height: 3, rx: 1 },
    { tag: "path", d: "M8 9.4h4M8 12.4h4M8 15.4h2.6" },
  ],
  settings: [
    { tag: "circle", cx: 10, cy: 10, r: 2.6 },
    {
      tag: "path",
      d: "M10 2.6v2M10 15.4v2M2.6 10h2M15.4 10h2M4.8 4.8l1.4 1.4M13.8 13.8l1.4 1.4M15.2 4.8l-1.4 1.4M6.2 13.8l-1.4 1.4",
    },
  ],
  search: [
    { tag: "circle", cx: 8.9, cy: 8.9, r: 4.6 },
    { tag: "path", d: "m12.3 12.3 3.9 3.9" },
  ],
  mic: [
    { tag: "rect", x: 8, y: 2.8, width: 4, height: 7.4, rx: 2 },
    { tag: "path", d: "M5.4 9.2a4.6 4.6 0 0 0 9.2 0" },
    { tag: "path", d: "M10 13.8v2.4M8 16.2h4" },
  ],
  video: [
    { tag: "rect", x: 2.8, y: 5.6, width: 10.2, height: 8.8, rx: 2 },
    { tag: "path", d: "m13 9 4.2-2.3v6.6L13 11" },
  ],
  text: [{ tag: "path", d: "M3.2 5.4h13.6M3.2 9.1h13.6M3.2 12.8h9.4M3.2 16.5h6" }],
  pin: [
    { tag: "path", d: "M7 2.8h6" },
    { tag: "path", d: "M8.2 2.8v3.6l-1.9 1.8v1.2h7.4V8.2l-1.9-1.8V2.8" },
    { tag: "path", d: "M10 9.4v7.8" },
  ],
  archive: [
    { tag: "rect", x: 3, y: 4.4, width: 14, height: 3.6, rx: 1 },
    { tag: "path", d: "M4.2 8v6.2a1.4 1.4 0 0 0 1.4 1.4h8.8a1.4 1.4 0 0 0 1.4-1.4V8" },
    { tag: "path", d: "M8.2 10.8h3.6" },
  ],
  back: [{ tag: "path", d: "M16 10H4M8.4 5.6 4 10l4.4 4.4" }],
  plus: [{ tag: "path", d: "M10 3.6v12.8M3.6 10h12.8" }],
  dot: [{ tag: "circle", cx: 10, cy: 10, r: 3.2, fill: "currentColor", stroke: "none" }],
};

const SVG_NS = "http://www.w3.org/2000/svg";

function addPart(svg: SVGSVGElement, part: GlyphPart): void {
  const el = document.createElementNS(SVG_NS, part.tag);
  if (part.tag === "path") {
    el.setAttribute("d", part.d);
  } else if (part.tag === "circle") {
    el.setAttribute("cx", String(part.cx));
    el.setAttribute("cy", String(part.cy));
    el.setAttribute("r", String(part.r));
    if (part.fill !== undefined) {
      el.setAttribute("fill", part.fill);
    }
    if (part.stroke !== undefined) {
      el.setAttribute("stroke", part.stroke);
    }
  } else {
    el.setAttribute("x", String(part.x));
    el.setAttribute("y", String(part.y));
    el.setAttribute("width", String(part.width));
    el.setAttribute("height", String(part.height));
    if (part.rx !== undefined) {
      el.setAttribute("rx", String(part.rx));
    }
  }
  svg.appendChild(el);
}

/** 内联 SVG：插件自带 path 优先，其次词表，再其次虚线空位。 */
export function iconGlyph(name: string, path?: string, size = 20): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "omora-icon-svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");

  const custom = path !== undefined && path.length > 0;
  const glyph = custom ? undefined : GLYPHS[name];
  svg.dataset.icon = custom ? "custom" : name;
  svg.dataset.known = glyph === undefined && !custom ? "false" : "true";

  if (custom) {
    addPart(svg, { tag: "path", d: path });
  } else if (glyph !== undefined) {
    for (const part of glyph) {
      addPart(svg, part);
    }
  } else {
    addPart(svg, { tag: "rect", x: 3.6, y: 3.6, width: 12.8, height: 12.8, rx: 2.4 });
  }
  return svg;
}
