import type { KindRegistry } from "../dom/types";
import { audioKinds } from "./audio_kinds";
import { captureKinds } from "./capture_kinds";
import { videoKinds } from "./video_kinds";

/**
 * 媒体组汇总：registry.ts 只认这个入口。
 *
 * 实现按控制器边界拆在 audio_kinds / capture_kinds / video_kinds 里；Lead 汇总时
 * 也可以在 registry.ts 直接展开这三个 map，然后删掉这个文件。
 */
export const mediaKinds: KindRegistry = {
  ...audioKinds,
  ...captureKinds,
  ...videoKinds,
};
