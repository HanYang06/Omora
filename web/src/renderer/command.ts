import type { CmdInvokeParams, CommandRef } from "../contract";
import { resolveCommandArgs, type BindingScope } from "./binding";

export function resolveCommand(
  command: CommandRef | undefined,
  scope: BindingScope,
): CmdInvokeParams | null {
  if (command === undefined) {
    return null;
  }
  return { name: command.command, args: resolveCommandArgs(command.args, scope) };
}
