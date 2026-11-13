import { basicKinds } from "./basic";
import { cardKinds } from "./cards";
import { formKinds } from "./form";
import { formChoiceKinds } from "./form_choice";
import { layoutKinds } from "./layout";
import { mediaKinds } from "./media";
import { navKinds } from "./nav";
import { searchKinds } from "./search";
import type { KindRegistry } from "../dom/types";

/** type → Kind；分组文件由不同 owner 维护，这里只汇总。 */
export const registry: KindRegistry = {
  ...layoutKinds,
  ...cardKinds,
  ...basicKinds,
  ...formKinds,
  ...formChoiceKinds,
  ...navKinds,
  ...searchKinds,
  ...mediaKinds,
};
