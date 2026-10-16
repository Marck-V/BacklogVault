// A caught value is not always an Error (anything can be thrown), so this turns it into text a person can read.
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
