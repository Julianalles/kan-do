/**
 * @module sourceCompound
 * @description A source name as the first part of a German compound ("{source}-Einstellungen"):
 * a two-word name is coupled with hyphens ("Apple-Erinnerungen-Einstellungen", #685). Other
 * locales and one-word names stay as they are. Use it only for a message that glues the name to a noun.
 */
export function sourceCompound(name: string, locale: string): string {
  return (locale === 'de' || locale.startsWith('de-')) ? name.trim().replace(/\s+/g, '-') : name
}
