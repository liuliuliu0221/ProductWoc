export function percentage(part: number, whole: number): number {
  return whole === 0 ? 0 : (part / whole) * 100;
}
