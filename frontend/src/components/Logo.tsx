/** Marca do Upkeeper: três cartas em leque com uma estrela no centro (favicon). */
export function LogoMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <g fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round">
        <rect x="14" y="14" width="24" height="34" rx="4" transform="rotate(-14 26 31)" opacity=".5" />
        <rect x="26" y="14" width="24" height="34" rx="4" transform="rotate(14 38 31)" opacity=".5" />
        <rect x="20" y="12" width="24" height="36" rx="4" className="fill-surface" />
      </g>
      <path d="M32 21l2.6 6.4L41 30l-6.4 2.6L32 39l-2.6-6.4L23 30l6.4-2.6z" fill="currentColor" />
    </svg>
  )
}

/** Logotipo em texto, condensado e maiúsculo. */
export default function Logo() {
  return (
    <span className="font-display text-xl font-extrabold tracking-wide text-parchment sm:text-2xl">
      Upkeeper
    </span>
  )
}
