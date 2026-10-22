import { Link } from 'react-router-dom'
import { useT } from '../../lib/i18n'

/**
 * "Jogar agora": leva para a mesa virtual com o mesmo código do sorteio. A mesa recebe os decks
 * sorteados; em salas online, quem tem conta já entra com o próprio deck.
 */
export default function PlayNowLink({ code }: { code: string }) {
  const t = useT()
  return (
    <Link
      to={`/table/${code.toUpperCase()}`}
      className="group mx-auto flex max-w-xl items-center justify-between gap-4 rounded-lg border border-gold/50 bg-gold/10 px-5 py-3 transition hover:bg-gold/20"
    >
      <span>
        <span className="font-display block text-xl text-gold">{t('Play now')}</span>
        <span className="block text-xs text-parchment/60">{t('Play this deal on the virtual table')}</span>
      </span>
      <span className="text-2xl text-gold transition group-hover:translate-x-1" aria-hidden>
        →
      </span>
    </Link>
  )
}
