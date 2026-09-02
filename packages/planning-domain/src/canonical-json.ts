import { createHash } from "node:crypto";

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function normalizeNumber(value: number): number {
  if (!Number.isFinite(value)) {
    throw new TypeError("Canonical JSON does not support non-finite numbers");
  }

  return Object.is(value, -0) ? 0 : value;
}

export function canonicalize(value: JsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    return JSON.stringify(normalizeNumber(value));
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }

  const entries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
    .join(",")}}`;
}

export function contentHash(value: JsonValue): string {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}
