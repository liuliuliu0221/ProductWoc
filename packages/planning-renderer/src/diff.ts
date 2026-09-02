import type { JsonValue } from "@product-woc/planning-domain";

export interface StructuredDiffEntry {
  operation: "add" | "remove" | "replace";
  path: string;
  before?: JsonValue;
  after?: JsonValue;
}

function isObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapePathSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function childPath(path: string, key: string): string {
  return `${path}/${escapePathSegment(key)}`;
}

function valuesEqual(left: JsonValue, right: JsonValue): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((item, index) => valuesEqual(item, right[index] as JsonValue))
    );
  }
  if (isObject(left) && isObject(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key, index) =>
          key === rightKeys[index] && valuesEqual(left[key] as JsonValue, right[key] as JsonValue),
      )
    );
  }
  return false;
}

export function diffJson(
  before: JsonValue,
  after: JsonValue,
  path = "",
): readonly StructuredDiffEntry[] {
  if (valuesEqual(before, after)) {
    return [];
  }

  if (isObject(before) && isObject(after)) {
    const entries: StructuredDiffEntry[] = [];
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const key of keys) {
      const nextPath = childPath(path, key);
      if (!(key in after)) {
        entries.push({
          operation: "remove",
          path: nextPath,
          before: before[key] as JsonValue,
        });
      } else if (!(key in before)) {
        entries.push({
          operation: "add",
          path: nextPath,
          after: after[key] as JsonValue,
        });
      } else {
        entries.push(
          ...diffJson(before[key] as JsonValue, after[key] as JsonValue, nextPath),
        );
      }
    }
    return entries;
  }

  return [{ operation: "replace", path: path || "/", before, after }];
}
