import { HOME_ART } from '@/lib/homeArt'
import { useT } from '@/lib/i18n'

// Arte fixa do painel de login: guerreiro com a espada em chamas, no tom dourado do site
const FEATURED = 'Jared Carthalion'

/**
 * Arte de um comandante cobrindo o painel, escurecida embaixo para o texto, com o crédito.
 * `credit` mostra o nome do comandante no canto.
 */
export default function AuthArt({ className = '', credit = true }: { className?: string; credit?: boolean }) {
  const t = useT()
  const items = HOME_ART
  // Sem ela no banco, cai na primeira arte disponível
  const pick = items.find((it) => it.commander === FEATURED) ?? items[0] ?? null

  return (
    <div aria-hidden className={`absolute inset-0 -z-10 overflow-hidden bg-ink ${className}`}>
      {pick && (
        <img
          src={pick.art}
          alt=""
          className="h-full w-full scale-105 object-cover object-[22%_50%] animate-[fade-in_0.8s_ease-out]"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/40 via-35% to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-transparent to-ink/50" />
      {pick && credit && (
        <p className="absolute top-4 right-5 text-[0.65rem] text-parchment/50">{t('Art: {name}', { name: pick.commander })}</p>
      )}
    </div>
  )
}
