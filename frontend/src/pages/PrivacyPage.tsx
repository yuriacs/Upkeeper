import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTitle } from '../hooks/useTitle'
import { CONTACT_EMAIL, PRIVACY_UPDATED_AT, SITE_NAME } from '../lib/site'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="font-display text-lg text-gold">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-parchment/80">{children}</div>
    </section>
  )
}

export default function PrivacyPage() {
  useTitle('Privacidade')
  return (
    <article className="mx-auto max-w-2xl space-y-8">
      <header className="space-y-2">
        <h1 className="font-display text-3xl text-gold">Política de privacidade</h1>
        <p className="text-sm text-parchment/50">Atualizada em {PRIVACY_UPDATED_AT}.</p>
        <p className="text-parchment/80">
          O {SITE_NAME} é um projeto de fã, gratuito, para sortear decks de Commander. Coletamos o mínimo necessário
          para o site funcionar e não vendemos nem compartilhamos seus dados para publicidade. Este texto segue a Lei
          Geral de Proteção de Dados (Lei nº 13.709/2018).
        </p>
      </header>

      <Section title="O que guardamos">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Sem conta:</strong> os nomes digitados para os jogadores, os sorteios feitos (para o link de
            resultado funcionar) e, nas salas online, o nome que você usa na sala.
          </li>
          <li>
            <strong>Com conta:</strong> nome de usuário, e-mail e senha (guardada só como hash, nunca em texto), os
            precons que você marca como seus, os decks que você importa e o histórico de decks que você recebeu nos
            sorteios.
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
            As imagens das cartas vêm do Scryfall (scryfall.com): ao carregá-las, seu navegador se conecta aos
            servidores deles. Na importação de decks, nosso servidor consulta o Scryfall só com os nomes das cartas.
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
    </article>
  )
}
