/** Marca do Upkeeper: o leque de cartas do logotipo, sem o nome (favicon). */
export function LogoMark({ className = 'h-8 w-8' }: { className?: string }) {
  return <img src="/logo-mark.webp" alt="" aria-hidden className={`object-contain ${className}`} draggable={false} />
}

/** Logotipo completo: o leque de cartas e o nome. */
export default function Logo({ className = 'h-9 sm:h-11' }: { className?: string }) {
  return <img src="/logo.webp" alt="Upkeeper" width={522} height={112} className={`w-auto ${className}`} />
}
