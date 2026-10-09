import type { ReactNode } from 'react'
import { LogoMark } from '../components/Logo'
import { useTitle } from '../hooks/useTitle'
import { KOFI_URL, SITE_NAME } from '../lib/site'

function KofiButton({ className = '' }: { className?: string }) {
  return (
    <a
      href={KOFI_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center justify-center gap-2 rounded-lg bg-gold px-6 py-3.5 font-display text-lg font-bold text-ink shadow-lg shadow-gold/20 transition hover:brightness-110 ${className}`}
    >
      <span aria-hidden>☕</span> Apoiar no Ko-fi
    </a>
  )
}

function Item({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1 p-4">
      <p className="font-semibold text-parchment">{title}</p>
      <p className="text-sm leading-relaxed text-parchment/70">{children}</p>
    </div>
  )
}

export default function SupportPage() {
  useTitle('Apoie o projeto')
  return (
    <section className="mx-auto max-w-2xl space-y-10">
      <div className="space-y-4 text-center">
        <LogoMark className="mx-auto h-14 w-14 text-gold" />
        <h1 className="font-display text-3xl text-gold sm:text-4xl">Apoie o {SITE_NAME}</h1>
        <p className="mx-auto max-w-xl text-balance text-parchment/75">
          O site é e vai continuar 100% gratuito, sem anúncios e sem recursos pagos. Se ele anima as suas mesas de
          Commander, um café ajuda a mantê-lo no ar.
        </p>
        <KofiButton className="w-full sm:w-auto" />
        <p className="text-xs text-parchment/40">
          Você será levado ao Ko-fi, que processa o pagamento com segurança.
        </p>
      </div>

      <div className="space-y-3">
        <h2 className="font-display text-xl text-gold">Para onde vai o apoio</h2>
        <div className="divide-y divide-gold/10 overflow-hidden rounded-xl border border-gold/15 bg-surface/60">
          <Item title="Servidor e banco de dados">
            Manter a API sempre acordada (sem a espera de quase um minuto do plano gratuito) e guardar decks, salas e
            sorteios.
          </Item>
          <Item title="Domínio próprio">Um endereço fácil de lembrar e de mandar no grupo.</Item>
          <Item title="Novidades">
            Tempo para novas funções: ranking da mesa, importação por link do Moxfield/Archidekt e o que a comunidade
            pedir.
          </Item>
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="font-display text-xl text-gold">Combinado</h2>
        <ul className="space-y-2 text-sm leading-relaxed text-parchment/75">
          <li className="flex gap-2">
            <span className="text-gold">✦</span>
            <span>
              <strong className="text-parchment">Apoiar não libera nada extra.</strong> Todo mundo tem acesso a tudo,
              com ou sem doação. É um agradecimento, não uma assinatura.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-gold">✦</span>
            <span>Não tem valor mínimo nem compromisso mensal: é uma contribuição única, quando e se você quiser.</span>
          </li>
          <li className="flex gap-2">
            <span className="text-gold">✦</span>
            <span>
              O {SITE_NAME} é um projeto de fã não oficial, sem vínculo com a Wizards of the Coast. As doações apoiam o
              site, não o Magic: The Gathering.
            </span>
          </li>
        </ul>
      </div>

      <div className="space-y-3 rounded-xl border border-gold/15 bg-surface/40 p-5 text-center">
        <p className="text-parchment/80">
          Não dá para doar agora? Tudo bem! Divulgar o site para o seu grupo já ajuda muito.
        </p>
        <KofiButton />
      </div>
    </section>
  )
}
