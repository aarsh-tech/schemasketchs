export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect x="2.5" y="4.5" width="12" height="15" rx="2.5" fill="var(--c-accent)" />
      <rect x="2.5" y="4.5" width="12" height="4.5" rx="2" fill="var(--c-ink)" opacity="0.18" />
      <rect x="17.5" y="12.5" width="12" height="15" rx="2.5" fill="none" stroke="var(--c-accent)" strokeWidth="2" />
      <path d="M14.5 14 H17.5 M17.5 11 L14.5 14 L17.5 17" fill="none" stroke="var(--c-ink)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
