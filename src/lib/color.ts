/** Pick black or white text for a background colour. CSS variables fall back to the accent ink. */
export function readableText(color: string): string {
  const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1]
  if (!hex) return 'var(--c-accent-ink)'
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return lum > 0.42 ? '#16201d' : '#ffffff'
}
