export function escapeIgdbString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
