import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTitle } from '../hooks/useTitle'
import { useI18n } from '../lib/i18n'
import { CONTACT_EMAIL, PRIVACY_UPDATED_AT, SITE_NAME } from '../lib/site'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="font-display text-lg text-parchment">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-parchment/80">{children}</div>
    </section>
  )
}

/** Data ISO (AAAA-MM-DD) formatada no idioma atual, sem deslocamento de fuso. */
function formatIsoDate(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`))
}

// Texto longo: um bloco por idioma, com as mesmas seções e links.

function IntroPt() {
  return (
    <p className="text-parchment/80">
      O {SITE_NAME} é um projeto de fã, gratuito, para sortear decks de Commander. Coletamos o mínimo necessário para o
      site funcionar e não vendemos nem compartilhamos seus dados para publicidade. Este texto segue a Lei Geral de
      Proteção de Dados (Lei nº 13.709/2018).
    </p>
  )
}

function IntroEn() {
  return (
    <p className="text-parchment/80">
      {SITE_NAME} is a free fan project for dealing Commander decks. We collect only what the site needs to work, and we
      don't sell or share your data for advertising. This policy follows the LGPD, Brazil's General Data Protection Law
      (Law No. 13.709/2018).
    </p>
  )
}

function BodyPt() {
  return (
    <>
      <Section title="O que guardamos">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Sem conta:</strong> os nomes digitados para os jogadores, os sorteios feitos (para o link de
            resultado funcionar), quem venceu a partida (quando alguém marca) e, nas salas online, o nome que você usa
            na sala.
          </li>
          <li>
            <strong>Com conta:</strong> nome de usuário, e-mail e senha (guardada só como hash, nunca em texto), os
            precons que você marca como seus, os decks que você importa e o histórico de decks que você recebeu nos
            sorteios, com o resultado das partidas.
          </li>
          <li>
            <strong>Entrando com Google ou Discord:</strong> recebemos só o identificador da sua conta no serviço, o
            nome e o e-mail (quando o serviço confirma que ele é seu). Não recebemos sua senha nem acesso a mais nada da
            sua conta. Você pode excluir sua conta aqui a qualquer momento.
          </li>
          <li>
            <strong>No seu navegador</strong> (armazenamento local, não são cookies de rastreamento): sua sessão, a
            última mesa configurada e os decks marcados antes do login.
          </li>
        </ul>
      </Section>

      <Section title="Para que usamos">
        <p>
          Só para o funcionamento do site: entrar na conta, montar sua deckpool, fazer os sorteios, aplicar a regra "não
          repetir deck" e mostrar os resultados compartilhados. A base legal é a execução do serviço que você pediu ao
          usar o site (art. 7º, V, da LGPD).
        </p>
      </Section>

      <Section title="Quem mais vê">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Quem tem o link de um sorteio ou de uma sala vê os nomes dos jogadores e os decks sorteados. Decks
            importados podem ser vistos por quem recebe o link, mas a lista original colada fica visível só para você.
          </li>
          <li>
            No <strong>Ranking</strong> público aparecem só o nome de usuário, o número de partidas e de vitórias de
            quem tem conta e já jogou pelo menos 3 partidas com resultado marcado. E-mail e outros dados nunca aparecem.
          </li>
          <li>
            As imagens das cartas vêm do Scryfall (scryfall.com): ao carregá-las, seu navegador se conecta aos
            servidores deles. Na importação de decks, nosso servidor consulta o Scryfall só com os nomes das cartas.
            Para estimar o bracket, a lista de cartas do deck (sem nome, e-mail ou qualquer dado seu) é enviada ao
            Commander Spellbook (commanderspellbook.com).
          </li>
          <li>
            Os dados ficam em provedores de hospedagem contratados para rodar o site, que não os usam para outros fins.
          </li>
        </ul>
      </Section>

      <Section title="Doações">
        <p>
          As doações são feitas no Ko-fi (ko-fi.com), que processa o pagamento e segue a própria política de
          privacidade. Não recebemos dados de cartão; o Ko-fi pode nos mostrar o nome e a mensagem que você escolher
          deixar. Doar não muda nada na sua conta nem no que você pode usar no site.
        </p>
      </Section>

      <Section title="Por quanto tempo">
        <p>
          Enquanto sua conta existir. Ao excluir a conta, apagamos e-mail, senha, decks e precons marcados; nos sorteios
          antigos de outras pessoas, seu nome é substituído por "(conta excluída)".
        </p>
      </Section>

      <Section title="Seus direitos">
        <p>
          Você pode, a qualquer momento, na página{' '}
          <Link to="/conta" className="text-gold hover:underline">
            Minha conta
          </Link>
          : baixar uma cópia dos seus dados e excluir sua conta.
          {CONTACT_EMAIL && (
            <>
              {' '}
              Para qualquer outro pedido (correção, dúvidas, informações), escreva para{' '}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-gold hover:underline">
                {CONTACT_EMAIL}
              </a>
              .
            </>
          )}
        </p>
      </Section>
    </>
  )
}

function BodyEn() {
  return (
    <>
      <Section title="What we store">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Without an account:</strong> the names typed in for the players, the deals you make (so the result
            link works), who won the game (when someone marks it) and, in online rooms, the name you use in the room.
          </li>
          <li>
            <strong>With an account:</strong> username, email and password (stored only as a hash, never as plain text),
            the precons you mark as yours, the decks you import, and the history of decks you were dealt, with the game
            results.
          </li>
          <li>
            <strong>Signing in with Google or Discord:</strong> we only receive your account ID on that service, your
            name and your email (when the service confirms it is yours). We never receive your password or access to
            anything else in that account. You can delete your account here at any time.
          </li>
          <li>
            <strong>In your browser</strong> (local storage, not tracking cookies): your session, the last table you set
            up and the decks you marked before signing in.
          </li>
        </ul>
      </Section>

      <Section title="What we use it for">
        <p>
          Only to make the site work: signing in, building your deck pool, dealing decks, applying the "No repeats" rule
          and showing shared results. The legal basis is performing the service you request when you use the site (art.
          7, item V, of the LGPD).
        </p>
      </Section>

      <Section title="Who else sees it">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Anyone with the link to a deal or a room sees the player names and the decks dealt. Imported decks can be
            seen by whoever gets the link, but the original pasted list is visible only to you.
          </li>
          <li>
            The public <strong>Ranking</strong> shows only the username and the number of games and wins of account
            holders who have played at least 3 games with a recorded result. Email and other data never appear.
          </li>
          <li>
            Card images come from Scryfall (scryfall.com): when they load, your browser connects to their servers. When
            importing decks, our server queries Scryfall with card names only. To estimate the bracket, the deck's card
            list (without your name, email or any other data of yours) is sent to Commander Spellbook
            (commanderspellbook.com).
          </li>
          <li>
            The data is kept with hosting providers hired to run the site, who don't use it for any other purpose.
          </li>
        </ul>
      </Section>

      <Section title="Donations">
        <p>
          Donations are made on Ko-fi (ko-fi.com), which processes the payment and follows its own privacy policy. We
          don't receive card details; Ko-fi may show us the name and message you choose to leave. Donating doesn't
          change anything about your account or what you can use on the site.
        </p>
      </Section>

      <Section title="How long we keep it">
        <p>
          For as long as your account exists. When you delete your account, we erase your email, password, decks and
          marked precons; in other people's past deals, your name is replaced with "(deleted account)".
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          At any time, on the{' '}
          <Link to="/conta" className="text-gold hover:underline">
            My account
          </Link>{' '}
          page, you can download a copy of your data and delete your account.
          {CONTACT_EMAIL && (
            <>
              {' '}
              For any other request (corrections, questions, information), write to{' '}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-gold hover:underline">
                {CONTACT_EMAIL}
              </a>
              .
            </>
          )}
        </p>
      </Section>
    </>
  )
}

export default function PrivacyPage() {
  const { t, lang, locale } = useI18n()
  useTitle(t('Privacy'))
  const pt = lang === 'pt'
  return (
    <article className="mx-auto max-w-2xl space-y-8">
      <header className="space-y-2">
        <h1 className="font-display text-3xl text-parchment">{t('Privacy policy')}</h1>
        <p className="text-sm text-parchment/50">
          {t('Updated on {date}.', { date: formatIsoDate(PRIVACY_UPDATED_AT, locale) })}
        </p>
        {pt ? <IntroPt /> : <IntroEn />}
      </header>

      {pt ? <BodyPt /> : <BodyEn />}
    </article>
  )
}
