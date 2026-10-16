export function escapeIgdbString(value: unknown): string {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
