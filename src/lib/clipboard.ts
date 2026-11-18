export async function copyText(text: string): Promise<boolean> {
  if (!globalThis.isSecureContext || !navigator.clipboard) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
