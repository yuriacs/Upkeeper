# Upkeeper

Sorteador de decks pré-construídos (precons) de Magic: The Gathering para mesas casuais de Commander (2 a 4 jogadores).

- `backend/` — Django REST Framework + MySQL (API e painel admin)
- `frontend/` — React + TypeScript + Vite + Tailwind (deploy na Vercel)

## Pré-requisitos

- Python 3.12+
- Node.js 20.19+ (ou 22+)
- Docker Desktop (para o MySQL local)

## Rodando localmente (Windows / PowerShell)

### 1. Banco de dados

```powershell
docker compose up -d
```

### 2. Backend (porta 8000)

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
copy .env.example .env
python manage.py migrate
python manage.py createsuperuser
uvicorn config.asgi:application --reload --port 8000
```

Use o uvicorn (e não o `runserver`): ele serve a API e também o WebSocket da mesa virtual.

Teste: http://localhost:8000/api/health/ deve responder `{"status": "ok", ...}`.

### 3. Frontend (porta 5173)

Em outro terminal:

```powershell
cd frontend
npm install
npm run dev
```

Abra http://localhost:5173 — o selo verde "API conectada" confirma que front e back estão conversando.

## Carregando os precons (Fase 1)

Com o backend rodando contra o MySQL:

```powershell
python manage.py import_mtgjson   # ~1–2 min: baixa os ~200 precons de Commander do MTGJSON
python manage.py sync_scryfall    # ~2 min: busca as imagens das cartas no Scryfall
python manage.py check_decks      # confere 100 cartas e 1–2 comandantes por deck
```

Os três são idempotentes: rodar de novo só adiciona o que falta. Quando sair uma coleção nova, é só repetir.
Para reimportar tudo: `import_mtgjson --update`. Para testar com poucos decks: `import_mtgjson --limit 5`.

Versões de colecionador (Collector's Edition) entram com "entra no sorteio" desmarcado, porque repetem a lista do deck normal. Dá para mudar isso no admin: http://localhost:8000/admin/

## API (Fase 2)

| Método | Endpoint | O que faz |
| --- | --- | --- |
| GET | `/api/editions/` | Edições que têm precons, com contagem de decks |
| GET | `/api/decks/` | Catálogo paginado (24 por página, `page_size` até 200) |
| GET | `/api/decks/{slug}/` | Deck com comandantes e cartas agrupadas por categoria |
| POST | `/api/draw/` | Sorteia decks distintos e salva o resultado (ver abaixo) |
| GET | `/api/draw/{code}/` | Resultado salvo de um sorteio (link `/sorteio/{code}` no site) |

Filtros do catálogo: `?edition=C21,CMR`, `?year=2024`, `?colors=WUB` (identidade exata; `C` = incolor), `?search=atraxa` (nome do deck ou comandante), `?active=true`, `?ordering=name` ou `-release_date`.

Corpo do sorteio:

```json
{
  "names": ["Ana", "Beto", "Caio"],
  "filters": {
    "year_from": 2020,
    "color_rule": "distinct",
    "same_edition": false,
    "editions": ["C21"],
    "deck_slugs": ["reign-of-dragons-fdc"]
  }
}
```

`names` (2 a 4; vazio vira "Jogador N") ou `players` (número). `color_rule`: `any`, `distinct` (identidades de cor diferentes) ou `no_overlap` (nenhuma cor em comum). `deck_slugs` limita o sorteio a esses decks ("meus decks"). `no_repeat: true` impede que um jogador receba um deck que já recebeu antes: com conta, vale o histórico de todos os sorteios dele; sem conta, o histórico da sala (ou dos sorteios criados pela mesma conta, pelo nome do jogador).

Com `DEBUG=True`, abrir os endpoints no navegador mostra a API navegável do DRF.

## Contas e deckpool

Login por usuário/e-mail e senha, ou Google/Discord. A API devolve um token, que o frontend envia em `Authorization: Token <chave>`.

**Dados pessoais criptografados:** ninguém do site lê e-mail, senha ou perfil dos jogadores, nem o admin. A senha nunca sai do navegador (vai uma chave derivada dela), o e-mail vira uma impressão digital (HMAC) e o perfil fica num cofre cifrado no navegador. Detalhes, limites e como adicionar campos novos ao perfil: [PRIVACIDADE.md](PRIVACIDADE.md).

| Método | Endpoint | O que faz |
| --- | --- | --- |
| POST | `/api/auth/prelogin/` | `{"login"}` → salt da conta para derivar a chave da senha (falso, se não existir) |
| POST | `/api/auth/register/` | Cria conta: `{"username", "email", "auth_key", "salt", "vault"}` |
| POST | `/api/auth/login/` | `{"login": "usuário ou e-mail", "auth_key"}` (conta antiga: `password` + `upgrade` uma vez) |
| POST | `/api/auth/logout/` | Invalida o token |
| GET | `/api/auth/me/` | Usuário logado (sem e-mail) |
| DELETE | `/api/auth/me/` | Exclui a conta: `{"auth_key"}` (LGPD) |
| GET | `/api/auth/me/export/` | Baixa todos os dados da conta em JSON (LGPD; o perfil privado vai aberto se estiver destrancado no navegador) |
| PUT | `/api/auth/me/email/` | Troca o e-mail (o servidor guarda só a impressão digital) |
| GET/PATCH/PUT | `/api/auth/me/vault/` | Cofre cifrado: ler, salvar conteúdo (`{data, version}`) ou trancar de novo |
| POST | `/api/auth/password/forgot/` | `{"email"}` → manda o link de nova senha (sempre a mesma resposta) |
| POST | `/api/auth/password/reset/check/` | O link vale? Devolve o cofre cifrado para abrir com o código de recuperação |
| POST | `/api/auth/password/reset/` | Nova senha (`auth_key`, `salt`, `vault`) |
| GET/POST | `/api/me/precons/` | Precons que o usuário tem (POST `{"slugs": [...]}` adiciona vários) |
| PUT/DELETE | `/api/me/precons/{slug}/` | Marca/desmarca um precon |
| GET/POST | `/api/me/decks/` | Decks montados; POST `{"name", "decklist", "commanders"?}` importa uma lista colada |
| GET/PUT/DELETE | `/api/me/decks/{id}/` | Ver, reimportar ou apagar um deck próprio |
| GET | `/api/user-decks/{id}/` | Visualização pública de um deck de usuário |

Sorteio por deckpool: só nas salas online (`/api/rooms/` com `"mode": "pool"`), onde cada jogador entra com a própria conta. Assim ninguém coloca outra pessoa na mesa nem mexe no histórico dela sem ela participar. A pool é a soma dos precons marcados e dos decks montados de todos os jogadores, e ninguém recebe um deck que é seu.

## Salas online

Cada jogador abre `/sala/{código}` no próprio navegador. O anfitrião sorteia e todos veem a mesma roleta ao mesmo tempo (o servidor define `reveal_at`; os navegadores consultam a sala a cada 2 s). Cada jogador vê o próprio deck destacado e pode copiar a lista.

| Método | Endpoint | O que faz |
| --- | --- | --- |
| POST | `/api/rooms/` | Cria a sala: `{"name", "mode", "filters"}`; devolve `token` do anfitrião |
| GET/PATCH | `/api/rooms/{code}/` | Estado da sala; PATCH (anfitrião) muda `mode`/`filters` |
| POST | `/api/rooms/{code}/join/` | Entra com `{"name"}`; devolve `token` |
| POST | `/api/rooms/{code}/leave/` | Sai da sala (o anfitrião passa para o próximo) |
| POST | `/api/rooms/{code}/kick/` | Anfitrião remove `{"player_id"}` |
| POST | `/api/rooms/{code}/draw/` | Anfitrião sorteia para os jogadores da sala |

O `token` identifica o navegador do jogador e vai no header `X-Room-Token`. Salas de deckpool exigem conta para entrar.

## Brackets

Cada deck recebe um **bracket estimado** (sistema oficial de brackets de Commander). As cartas são classificadas
pelo [Commander Spellbook](https://commanderspellbook.com) (Game Changers, destruição de terrenos em massa,
turnos extras, combos de 2 cartas) e a regra oficial é aplicada em `decks/services/brackets.py`.

- Precons: o `run_syncs` (ver "Sincronizações" no Deploy) roda `estimate_brackets --older-than 30` (calcula os
  que faltam e revisa os com mais de 30 dias; se o Spellbook estiver fora, para depois de 3 falhas e tenta na próxima).
- Quando a Wizards mudar a lista de Game Changers: `python manage.py estimate_brackets --all`.
- Decks importados: calculados ao salvar; se falhar, de novo quando alguém abrir o deck.
- `BRACKETS_ENABLED=false` desliga as consultas (já vem desligado nos testes).

### Análise e nível de poder

A página do deck mostra o que tem nele (ramp, mana rápida, compra, tutores, remoção, board wipes,
contramágicas, proteção) e um **nível de poder estimado de 1 a 10** (`decks/services/analysis.py`).

- A função de cada carta vem das tags do Scryfall: `python manage.py sync_card_tags` (~1 minuto; o
  `run_syncs` roda uma vez por mês) grava na tabela `OracleTag` e recalcula o nível de todos os decks.
- `python manage.py analyze_decks` recalcula só o nível de poder (rápido, sem internet).
- A fórmula é aberta: cada fator vira uma nota de 0 a 1, com pesos, numa escala de 1,5 a 8, mais um
  bônus pequeno pelo bracket. A página mostra o cálculo em "Como chegamos nesse número".

## Idiomas (inglês e português)

O site é em inglês por padrão, com botão EN/PT no cabeçalho (a escolha fica salva no navegador).

- **Frontend:** o texto em inglês no código é a chave: `const t = useT(); t('Deal decks')`.
  O português fica em `frontend/src/i18n/pt/*.ts`. Para ver o que falta traduzir:
  `cd frontend && node scripts/check-i18n.mjs`.
- **Backend:** mensagens em inglês com `gettext`, português em `backend/locale/pt_BR/LC_MESSAGES/django.po`.
  O site manda `Accept-Language` e o Django responde no idioma certo. Depois de mudar textos:
  `python manage.py makemessages -l pt_BR --ignore=.venv`, traduzir no `.po` e
  `python manage.py compilemessages --ignore=.venv` (precisa do gettext instalado). O `.mo` compilado
  vai junto no git, porque o servidor do deploy não tem o gettext.

## Deploy

### Banco de dados

O código funciona com **PostgreSQL ou MySQL** (os testes passam nos dois); basta trocar o `DATABASE_URL`.
Para começar sem custo, o PostgreSQL tem mais opções gratuitas (Neon, Supabase); para MySQL, Railway ou Aiven.

### Backend (Render, Railway, Fly…)

- **Build:** `bash build.sh` (instala dependências, `collectstatic` e `migrate`)
- **Start:** `uvicorn config.asgi:application --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips="*" --lifespan off --ws-ping-interval 20 --ws-ping-timeout 20 --ws-max-size 65536` (também no `Procfile`). Um processo só: as mesas virtuais ficam na memória dele; o HTTP roda num pool de threads (`HTTP_THREADS`, padrão 8).
- **Health check:** `/api/health/`
- **Sincronizações** (Commander Spellbook e Scryfall: brackets, tags, nível de poder, força/resistência, preços):
  `python manage.py run_syncs`. Ficam fora do build para o deploy ser rápido: o servidor roda o comando sozinho,
  num processo à parte, 2 minutos depois de subir e a cada 24 horas (`config/syncs.py`; liga com `DEBUG=False`,
  `SYNCS_ENABLED=false` desliga; `SYNCS_DELAY` e `SYNCS_INTERVAL` em segundos). O progresso aparece nos logs do serviço.
- **Variáveis:** veja a seção "Produção" do `backend/.env.example`
- **Primeira carga dos dados:** no shell do host, `python manage.py import_mtgjson` e depois `python manage.py sync_scryfall`
- **Admin:** `python manage.py createsuperuser` no shell do host

Com `DEBUG=False`, o site força HTTPS, usa cookies seguros e HSTS (começa em 1 dia; suba `SECURE_HSTS_SECONDS` para 1 ano depois que tudo estiver estável). Os arquivos do admin são servidos pelo WhiteNoise. `python manage.py check --deploy` deve passar sem avisos.

Limites por usuário (ou IP): importação de decks, criação de salas, entrada em salas, sorteios e login. Os valores ficam em `config/settings.py` e podem ser ajustados por variável de ambiente.

Segurança em produção (variáveis no Render):

- `ADMIN_PATH`: caminho do admin do Django (padrão `admin/`); use um que ninguém adivinhe.
- `TRUSTED_PROXIES`: quantos proxies escrevem no `X-Forwarded-For` (para os limites por IP não aceitarem IP inventado). Logado como admin, abra `/api/admin/request-info/` e veja em que posição, contando do fim, aparece o seu IP.
- `LOGIN_MAX_FAILURES` / `LOGIN_LOCK_MINUTES`: senhas erradas seguidas numa conta antes de bloquear o login dela (padrão 10 em 15 min).
- `EMAIL_PEPPER` (**obrigatória**): chave da impressão digital dos e-mails. Gere com `python -c "import secrets; print(secrets.token_urlsafe(48))"` e **nunca troque** depois que houver contas. Sem ela o deploy falha de propósito (o Render mantém a versão anterior no ar).
- Recuperação de senha por e-mail (Resend): `RESEND_API_KEY` (chave de API do Resend) e `DEFAULT_FROM_EMAIL` (ex.: `Upkeeper <nao-responda@upkeeper.online>`). Sem a chave, o link "Esqueceu a senha?" não aparece. Passo a passo abaixo.
- Login com Google e Discord: `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET` e `FRONTEND_URL` (ex.: `https://www.upkeeper.online`). O endereço de retorno a cadastrar em cada serviço é `FRONTEND_URL/entrar/social/google` e `FRONTEND_URL/entrar/social/discord`. Sem as chaves, o botão do serviço não aparece.
- Mesa virtual: `TABLE_MAX` (mesas abertas no servidor, padrão 40) e `TABLES_PER_USER` (mesas novas por conta, padrão 3); cada conexão aceita até 15 ações/s e mensagens de até 64 KB.

### E-mail de recuperação de senha (Resend)

O envio é pela API HTTPS do Resend, e não por SMTP, porque o plano gratuito do Render bloqueia as portas de e-mail.

1. Crie a conta em https://resend.com (grátis até 3.000 e-mails/mês) e, em **Domains → Add Domain**, adicione `upkeeper.online`.
2. O Resend mostra os registros DNS: um MX e um TXT (SPF) em `send`, e um TXT (DKIM) em `resend._domainkey`. Cadastre cada um onde o DNS do domínio é administrado: na **Vercel** (Domains → upkeeper.online → DNS Records) se os nameservers do domínio são os da Vercel, ou na **HostGator** (cPanel → Zone Editor) se continuam os da HostGator. Depois clique em **Verify** no Resend.
3. Em **API Keys**, crie uma chave com permissão **Sending access**, só para esse domínio.
4. No Render: `RESEND_API_KEY=<a chave>` e `DEFAULT_FROM_EMAIL=Upkeeper <nao-responda@upkeeper.online>`.

Em desenvolvimento, sem a chave, o e-mail aparece no terminal do backend.

### Curadoria do Instagram (repost com autorização)

Nos horários de `SOCIAL_SLOTS` o servidor roda `manage.py social_run` (código em `backend/social/curation.py`):

1. **Coleta** dos perfis monitorados pelo Apify, na nuvem dele. A conta do Upkeeper nunca entra no Instagram para isso.
2. **Ranking**: engajamento = (curtidas + comentários) / seguidores, só dos posts das últimas `SOCIAL_WINDOW_HOURS` horas. Passa o post com pelo menos `SOCIAL_MIN_OUTLIER` vezes a mediana do próprio perfil. Post já coletado não volta (o shortcode é único).
3. **Editor (Claude Haiku)**: recusa propaganda e tom fora da linha e escreve a legenda (gancho, resumo, CTA). O sistema acrescenta `Créditos/Via: @autor` e as hashtags.
4. **Autorização**: só se reposta de perfil marcado como "autorizou repost" no admin. Se o perfil ainda não autorizou, o post vira um **pedido**, com a mensagem pronta para mandar por DM (`/painel/social`, seção "Pedidos de autorização"). Quando o autor disser sim, clique em "Autor autorizou". Pedido sem resposta expira em 7 dias.
5. **Fila**: a mídia sobe para o Cloudinary e o repost aparece em `/painel/social` como rascunho. Aprovado, ele sai no próximo horário pela API oficial (Graph API: `/media` e depois `/media_publish`), um por horário. Com `SOCIAL_AUTO_APPROVE=true`, repost de perfil autorizado já entra aprovado.

Carrossel ainda não é publicado (fica descartado). Os perfis monitorados se cadastram em `/painel/social` (vários de uma vez, separados por vírgula), onde também se marca quem autorizou repost. Teste sem publicar com `python manage.py social_run --no-publish`.

Variáveis no Render:

- `SOCIAL_CURATION_ENABLED=true` liga os horários. `SOCIAL_SLOTS` usa o padrão `12:00,19:00`, no horário de Brasília. Também dá para ajustar `SOCIAL_AUTO_APPROVE`, `SOCIAL_WINDOW_HOURS` (padrão 48), `SOCIAL_MIN_OUTLIER` (padrão 1.5) e `SOCIAL_LANG` (`pt` ou `en`).
- `APIFY_TOKEN`: Apify → Settings → API & Integrations. O ator padrão é `apify~instagram-profile-scraper` (`APIFY_ACTOR`) e é cobrado por resultado.
- `ANTHROPIC_API_KEY`: em https://console.anthropic.com → API Keys (a conta precisa de créditos em Billing). O modelo vem de `EDITOR_MODEL` (padrão `claude-haiku-5-5`).
- `CLOUDINARY_URL`: o "API environment variable" do painel do Cloudinary (`cloudinary://chave:segredo@nuvem`).
- `INSTAGRAM_USER_ID` e `INSTAGRAM_ACCESS_TOKEN`: a conta do Instagram precisa ser profissional e estar ligada a uma Página do Facebook. Crie um app em developers.facebook.com com as permissões `instagram_basic` e `instagram_content_publish`. Use um token de **usuário do sistema** (Business Manager), que não expira. O token comum dura 60 dias e, vencido, o post fica com erro no painel. A versão da API vem de `INSTAGRAM_GRAPH_URL` (padrão `https://graph.facebook.com/v23.0`).

### Frontend (Vercel)

- Root Directory: `frontend`
- Variáveis: `VITE_API_URL` (URL da API) e `VITE_CONTACT_EMAIL` (contato da política de privacidade)
- O `vercel.json` já redireciona todas as rotas para o app.

## Comandos úteis

| Onde | Comando | Para quê |
| --- | --- | --- |
| backend | `python manage.py test` | Rodar os testes |
| frontend | `npm run build` | Build de produção (checa os tipos) |
| frontend | `npm run lint` | Lint com oxlint |

## Aviso legal

Upkeeper é conteúdo de fã não oficial, permitido pela Fan Content Policy. Não é aprovado nem endossado pela Wizards of the Coast. Dados e imagens de cartas fornecidos pelo [Scryfall](https://scryfall.com).
