/**
 * node scope：父授给子的窄能力端口（granted port）。
 *
 * 契约：`schema/sdk/scope.json` 的 `capability`。端口只暴露一种能力的少量方法，
 * 不暴露父对象；方法把调用翻译成标准请求交给 host。可撤销：端口每次调用前向
 * `PortTarget.assertUsable` 确认能力仍有效，撤销后抛稳定错误。
 */

import { Request, type Response } from "./requests";

export const CAPABILITY_TYPES = ["navigation", "overlay", "focus", "scroll", "data"] as const;

export type CapabilityType = (typeof CAPABILITY_TYPES)[number];

/** 契约 `capability.types` 的运行时镜像：能力 -> 端口方法名。 */
export const CAPABILITY_METHODS: Record<CapabilityType, readonly string[]> = {
  navigation: ["navigate"],
  overlay: ["open"],
  focus: ["focus"],
  scroll: ["into_view"],
  data: ["get"],
};

/** 端口需要的宿主面：发请求 + 在调用前确认能力仍可用。 */
export interface PortTarget {
  request(request: Request): Response;
  assertUsable(type: CapabilityType): void;
}

export interface NavigationCapability {
  readonly type: "navigation";
  navigate(route: string): Response;
}

export interface OverlayCapability {
  readonly type: "overlay";
  open(kind: string, props: Record<string, unknown>): Response;
}

export interface FocusCapability {
  readonly type: "focus";
  focus(): Response;
}

export interface ScrollCapability {
  readonly type: "scroll";
  into_view(): Response;
}

export interface DataCapability {
  readonly type: "data";
  get(source: string, key: string): Response;
}

export interface CapabilityPortMap {
  navigation: NavigationCapability;
  overlay: OverlayCapability;
  focus: FocusCapability;
  scroll: ScrollCapability;
  data: DataCapability;
}

export type CapabilityPort = CapabilityPortMap[CapabilityType];

function send(
  target: PortTarget,
  type: CapabilityType,
  name: string,
  fields: Record<string, unknown>,
): Response {
  target.assertUsable(type);
  return target.request(new Request(name, fields));
}

/** 按能力类型造一个窄端口；能力是否已授 / 已撤销由 target 判定。 */
export function createCapabilityPort(target: PortTarget, type: CapabilityType): CapabilityPort {
  switch (type) {
    case "navigation":
      return {
        type,
        navigate: (route) => send(target, "navigation", "navigate", { route }),
      };
    case "overlay":
      return {
        type,
        open: (kind, props) => send(target, "overlay", "open_overlay", { kind, props }),
      };
    case "focus":
      return {
        type,
        focus: () => send(target, "focus", "focus", {}),
      };
    case "scroll":
      return {
        type,
        into_view: () => send(target, "scroll", "scroll_into_view", {}),
      };
    case "data":
      return {
        type,
        get: (source, key) => send(target, "data", "request_data", { source, key }),
      };
  }
}
