import { basicKinds } from "./kinds/basic";
import { formKinds } from "./kinds/form";
import { layoutKinds } from "./kinds/layout";
import { mediaKinds } from "./kinds/media";
import { navKinds } from "./kinds/nav";
import type { KindRegistry } from "./types";

/** type → Kind；分组文件由不同 owner 维护，这里只汇总。 */
export const registry: KindRegistry = {
  ...layoutKinds,
  ...basicKinds,
  ...formKinds,
  ...navKinds,
  ...mediaKinds,
};
