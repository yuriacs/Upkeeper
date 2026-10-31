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
            <strong>Com conta:</strong> nome de usuário, os precons que você marca como seus, os decks que você importa e
            o histórico de decks que você recebeu nos sorteios, com o resultado das partidas.
          </li>
          <li>
            <strong>Foto de perfil (opcional):</strong> se você enviar uma, guardamos uma versão pequena e quadrada, sem os
            dados escondidos do arquivo (como o lugar onde a foto foi tirada). Ela aparece nas mesas e no seu perfil
            público. Você pode remover quando quiser, e ela é apagada junto com a conta.
          </li>
          <li>
            <strong>E-mail:</strong> não guardamos seu e-mail legível. O servidor guarda só uma impressão digital
            criptográfica dele (HMAC-SHA256), que serve para você entrar com o e-mail, para impedir duas contas com o
            mesmo e-mail e para a recuperação de senha. A partir dela não dá para descobrir o seu e-mail nem listar os
            e-mails das contas.
          </li>
          <li>
            <strong>Senha:</strong> nunca chega ao nosso servidor. Seu navegador tira dela uma chave (PBKDF2, 600 mil
            rodadas) e só essa chave é enviada; guardamos dela apenas um hash.
          </li>
          <li>
            <strong>Perfil privado:</strong> a cópia legível do seu e-mail e qualquer outro dado pessoal de perfil que o
            site venha a ter ficam criptografados no seu navegador (AES-256-GCM) antes de sair dele, com uma chave que
            só abre com a sua senha ou com o seu código de recuperação. Ninguém do site, nem o administrador, consegue
            ler. Por isso, se você perder a senha e o código de recuperação, nem nós conseguimos recuperar o perfil
            privado (a conta, os decks e o histórico continuam).
          </li>
          <li>
            <strong>Entrando com Google ou Discord:</strong> recebemos o identificador da sua conta no serviço, o nome
            (usado só para sugerir seu nome de usuário) e o e-mail, quando o serviço confirma que ele é seu, que vira a
            mesma impressão digital acima e não é guardado legível. Não recebemos sua senha nem acesso a mais nada da sua
            conta.
          </li>
          <li>
            <strong>No seu navegador</strong> (armazenamento local, não são cookies de rastreamento): sua sessão, a
            chave do seu perfil privado (apagada quando você sai da conta), a última mesa configurada e os decks
            marcados antes do login.
          </li>
        </ul>
      </Section>

      <Section title="O que fica visível">
        <p>
          A criptografia vale para os dados pessoais. O que outros jogadores precisam ver para o site funcionar não é
          criptografado: nome de usuário, foto de perfil (se você enviar uma), decks, sorteios, partidas e o nome usado
          nas salas e mesas. Ao entrar ou pedir
          a recuperação de senha, o e-mail que você digita passa pelo servidor só durante o pedido, para calcular a
          impressão digital ou enviar a mensagem, e não é gravado.
        </p>
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
            O <strong>rever</strong> de uma partida é só de quem jogou, até um dos jogadores ligar o link público. Quem
            tiver esse link vê a partida (cartas, vida e o que aconteceu, sem o chat); aparecem o nome de usuário de
            quem ligou e o de quem autorizou o nome nos posts do Upkeeper, e os outros ficam como “Jogador 2”,
            “Jogador 3”... Qualquer jogador da partida desliga o link.
          </li>
          <li>
            As imagens das cartas vêm do Scryfall (scryfall.com): ao carregá-las, seu navegador se conecta aos
            servidores deles. Na importação de decks, nosso servidor consulta o Scryfall só com os nomes das cartas.
            Para estimar o bracket, a lista de cartas do deck (sem nome, e-mail ou qualquer dado seu) é enviada ao
            Commander Spellbook (commanderspellbook.com).
          </li>
          <li>
            No <strong>gerador de decks</strong> e nas sugestões do deckbuilder, seu navegador consulta o EDHREC
            (edhrec.com) e o Scryfall com os nomes do comandante, dos temas e das cartas. Se você usar “Descreva seu
            deck” ou “Escrever o guia de jogo”, nosso servidor envia só a frase que você digitou, ou a lista de cartas
            do deck, ao Gemini, a IA do Google, para ler o pedido ou escrever o guia, sem nome, e-mail ou qualquer
            outro dado seu (sem a IA, a frase é lida no seu navegador, e só as palavras que podem ser o nome do
            comandante vão para a busca do Scryfall). Não coloque dados pessoais na frase. O texto não fica guardado no
            nosso banco, e o histórico de decks gerados fica só no seu navegador.
          </li>
          <li>
            O e-mail de recuperação de senha é enviado pelo Resend (resend.com), que recebe o endereço só para fazer a
            entrega.
          </li>
          <li>
            Os dados ficam em provedores de hospedagem contratados para rodar o site, que não os usam para outros fins.
          </li>
        </ul>
      </Section>

      <Section title="Doações">
        <p>
          As doações são feitas por Pix ou no Ko-fi (ko-fi.com), que processa o pagamento e segue a própria
          política de privacidade. Não recebemos dados de cartão. Para ativar os enfeites de apoiador na conta certa,
          o site reserva centavos para a sua conta e guarda o seu aviso de "Já doei" até a ativação (no máximo 7
          dias). Da doação, guardamos só o total somado, para o selo de Fundador: nada de cada doação, nome no banco
          ou e-mail. Doar só libera enfeites; tudo de Magic no site continua grátis para todos.
        </p>
      </Section>

      <Section title="Por quanto tempo">
        <p>
          Enquanto sua conta existir. Ao excluir a conta, apagamos o perfil privado, a impressão digital do e-mail, a
          senha, os decks e os precons marcados; nos sorteios antigos de outras pessoas, seu nome é substituído por
          "(conta excluída)".
        </p>
      </Section>

      <Section title="Seus direitos">
        <p>
          Você pode, a qualquer momento, na página{' '}
          <Link to="/account" className="text-gold hover:underline">
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
            <strong>With an account:</strong> username, the precons you mark as yours, the decks you import, and the
            history of decks you were dealt, with the game results.
          </li>
          <li>
            <strong>Profile photo (optional):</strong> if you upload one, we keep a small square version without the
            file's hidden data (like where the photo was taken). It shows at the tables and on your public profile. You
            can remove it at any time, and it is deleted with your account.
          </li>
          <li>
            <strong>Email:</strong> we don't keep your email in readable form. The server stores only a cryptographic
            fingerprint of it (HMAC-SHA256), used to let you sign in with your email, to prevent two accounts with the
            same email and for password recovery. It can't be turned back into your email, and the account emails can't
            be listed.
          </li>
          <li>
            <strong>Password:</strong> it never reaches our server. Your browser derives a key from it (PBKDF2, 600,000
            rounds) and only that key is sent; we store just a hash of it.
          </li>
          <li>
            <strong>Private profile:</strong> the readable copy of your email and any other personal profile data the
            site may have are encrypted in your browser (AES-256-GCM) before leaving it, with a key that only opens with
            your password or your recovery code. Nobody at the site, not even the admin, can read it. That's why, if you
            lose both your password and your recovery code, not even we can recover the private profile (your account,
            decks and history stay).
          </li>
          <li>
            <strong>Signing in with Google or Discord:</strong> we receive your account ID on that service, your name
            (only used to suggest a username) and your email, when the service confirms it is yours, which becomes the
            same fingerprint above and is not stored readable. We never receive your password or access to anything else
            in that account.
          </li>
          <li>
            <strong>In your browser</strong> (local storage, not tracking cookies): your session, the key to your private
            profile (erased when you sign out), the last table you set up and the decks you marked before signing in.
          </li>
        </ul>
      </Section>

      <Section title="What stays visible">
        <p>
          Encryption covers personal data. What other players need to see for the site to work is not encrypted:
          username, profile photo (if you upload one), decks, deals, games and the name you use in rooms and tables.
          When you sign in or ask for a password
          reset, the email you type passes through the server only during that request, to compute the fingerprint or
          send the message, and is not stored.
        </p>
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
            A game's <strong>replay</strong> is only for the people who played it, until one of them turns on the public
            link. Anyone with that link sees the game (cards, life and what happened, without the chat); it shows the
            username of whoever turned it on and of those who allowed their name in Upkeeper's posts, and the others
            appear as “Player 2”, “Player 3”... Any player in the game can turn the link off.
          </li>
          <li>
            Card images come from Scryfall (scryfall.com): when they load, your browser connects to their servers. When
            importing decks, our server queries Scryfall with card names only. To estimate the bracket, the deck's card
            list (without your name, email or any other data of yours) is sent to Commander Spellbook
            (commanderspellbook.com).
          </li>
          <li>
            In the <strong>deck generator</strong> and in the deckbuilder suggestions, your browser queries EDHREC
            (edhrec.com) and Scryfall with the names of the commander, the themes and the cards. If you use “Describe
            your deck” or “Write the play guide”, our server sends only the sentence you typed, or the deck's card list,
            to Gemini, Google's AI, to read the request or write the guide, without your name, email or any other data
            of yours (without the AI, the sentence is read in your browser, and only the words that may be the
            commander's name go to the Scryfall search). Don't put personal data in the sentence. The text isn't stored
            in our database, and the history of generated decks stays only in your browser.
          </li>
          <li>
            Password reset emails are sent through Resend (resend.com), which receives the address only to deliver it.
          </li>
          <li>
            The data is kept with hosting providers hired to run the site, who don't use it for any other purpose.
          </li>
        </ul>
      </Section>

      <Section title="Donations">
        <p>
          Donations are made by Pix or on Ko-fi (ko-fi.com), which processes the payment and follows its own privacy
          policy. We don't receive card details. To activate supporter perks on the right account, the site reserves
          cents for your account and keeps your "I donated" notice until activation (7 days at most). From donations
          we keep only the summed total, for the Founder badge: nothing about each donation, bank name or email.
          Donating only unlocks cosmetics; everything about Magic on the site stays free for everyone.
        </p>
      </Section>

      <Section title="How long we keep it">
        <p>
          For as long as your account exists. When you delete your account, we erase your private profile, the email
          fingerprint, your password, decks and marked precons; in other people's past deals, your name is replaced with
          "(deleted account)".
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          At any time, on the{' '}
          <Link to="/account" className="text-gold hover:underline">
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
