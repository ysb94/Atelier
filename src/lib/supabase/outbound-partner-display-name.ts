/** Keep existing readers usable until the additive display-name migration is applied. */
export async function readOutboundPartnerDisplayName<T extends {
  error: { code?: string; message?: string } | null
}>(read: (displayNameColumn: string) => PromiseLike<T>): Promise<T> {
  const result = await read(', display_name')
  if (result.error?.message?.includes('display_name') &&
      (result.error.code === '42703' || result.error.code === 'PGRST204')) {
    return read('')
  }
  return result
}
