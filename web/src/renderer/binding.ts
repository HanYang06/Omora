import type { Scalar } from "../contract";
import { isRecord } from "../lib/guards";

export type BindingScope = Readonly<Record<string, unknown>>;

const BINDING_PREFIX = "$";

export function isBinding(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(BINDING_PREFIX);
}

export function resolveBinding(expression: string, scope: BindingScope): unknown {
  const path = expression
    .slice(BINDING_PREFIX.length)
    .split(".")
    .filter((segment) => segment.length > 0);
  let current: unknown = scope;
  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

export function resolveValue(value: unknown, scope: BindingScope): unknown {
  return isBinding(value) ? resolveBinding(value, scope) : value;
}

export function resolveText(value: string, scope: BindingScope): string {
  return asText(resolveValue(value, scope));
}

export function resolveItems(value: string, scope: BindingScope): readonly unknown[] {
  const resolved = resolveValue(value, scope);
  return Array.isArray(resolved) ? resolved : [];
}

export function resolveCommandArgs(
  args: Readonly<Record<string, Scalar>> | undefined,
  scope: BindingScope,
): Record<string, Scalar> {
  const resolved: Record<string, Scalar> = {};
  if (args === undefined) {
    return resolved;
  }
  for (const [key, value] of Object.entries(args)) {
    const target = resolveValue(value, scope);
    if (isScalar(target)) {
      resolved[key] = target;
    }
  }
  return resolved;
}

export function withItem(scope: BindingScope, item: unknown): BindingScope {
  return { ...scope, item };
}

export function withValue(scope: BindingScope, value: string): BindingScope {
  return { ...scope, value };
}

function asText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function isScalar(value: unknown): value is Scalar {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}
