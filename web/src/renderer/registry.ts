import type { WidgetComponent } from "./types";
import { ButtonWidget } from "./widgets/button";
import { CardWidget } from "./widgets/card";
import { InputWidget } from "./widgets/input";
import { ListWidget } from "./widgets/list";
import { StackWidget } from "./widgets/stack";
import { TextWidget } from "./widgets/text";

const WIDGETS: Record<string, WidgetComponent> = {
  Button: ButtonWidget,
  Card: CardWidget,
  Input: InputWidget,
  List: ListWidget,
  Stack: StackWidget,
  Text: TextWidget,
};

export function widgetFor(type: string): WidgetComponent | undefined {
  if (!Object.hasOwn(WIDGETS, type)) {
    return undefined;
  }
  return WIDGETS[type];
}
