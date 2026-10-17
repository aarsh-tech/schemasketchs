/* Helpers for turning what someone types into DBML. Kept free of the DBML
   compiler so the UI can use them on the main thread. */

/**
 * Turn what someone typed in a "default" box into a DBML default value.
 * Numbers, booleans, null and already-quoted values pass through; function
 * calls such as now() become expressions; anything else becomes a string.
 */
export function toDbmlDefault(input: string): string | null {
  const v = input.trim()
  if (!v) return null
  if (/^-?\d+(\.\d+)?$/.test(v) || /^(true|false|null)$/i.test(v)) return v
  if (/^'(?:[^'\\]|\\.)*'$/.test(v) || /^`[^`]*`$/.test(v)) return v
  if (/^"(.*)"$/.test(v)) return quoteString(v.slice(1, -1))
  if (/^[A-Za-z_][\w.]*\(.*\)$/.test(v)) return `\`${v}\``
  return quoteString(v)
}

const quoteString = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

/** Column types with spaces outside parentheses (double precision) need quotes. */
export function toDbmlType(input: string): string {
  const v = input.trim()
  if (/^".*"$/.test(v)) return v
  return /\s/.test(v.replace(/\([^)]*\)/g, '')) ? `"${v.replace(/"/g, '\\"')}"` : v
}

/** First free name of the form base, base_2, base_3… (case-insensitive). */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((t) => t.toLowerCase()))
  if (!used.has(base.toLowerCase())) return base
  for (let i = 2; ; i++) if (!used.has(`${base}_${i}`.toLowerCase())) return `${base}_${i}`
}
