# Choose at random

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
python manage.py runserver
```

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

Login por usuário/e-mail e senha. A API devolve um token, que o frontend envia em `Authorization: Token <chave>`.

| Método | Endpoint | O que faz |
| --- | --- | --- |
| POST | `/api/auth/register/` | Cria conta: `{"username", "email", "password"}` |
| POST | `/api/auth/login/` | `{"login": "usuário ou e-mail", "password"}` |
| POST | `/api/auth/logout/` | Invalida o token |
| GET | `/api/auth/me/` | Usuário logado |
| DELETE | `/api/auth/me/` | Exclui a conta: `{"password"}` (LGPD) |
| GET | `/api/auth/me/export/` | Baixa todos os dados da conta em JSON (LGPD) |
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

- Precons: o `build.sh` roda `python manage.py estimate_brackets --older-than 30` a cada deploy (calcula os que
  faltam e revisa os com mais de 30 dias; se o Spellbook estiver fora, o deploy segue).
- Quando a Wizards mudar a lista de Game Changers: `python manage.py estimate_brackets --all`.
- Decks importados: calculados ao salvar; se falhar, de novo quando alguém abrir o deck.
- `BRACKETS_ENABLED=false` desliga as consultas (já vem desligado nos testes).

### Análise e nível de poder

A página do deck mostra o que tem nele (ramp, mana rápida, compra, tutores, remoção, board wipes,
contramágicas, proteção) e um **nível de poder estimado de 1 a 10** (`decks/services/analysis.py`).

- A função de cada carta vem das tags do Scryfall: `python manage.py sync_card_tags` (~1 minuto; o
  `build.sh` roda uma vez por mês) grava na tabela `OracleTag` e recalcula o nível de todos os decks.
- `python manage.py analyze_decks` recalcula só o nível de poder (rápido, sem internet).
- A fórmula é aberta: cada fator vira uma nota de 0 a 1, com pesos, numa escala de 1,5 a 8, mais um
  bônus pequeno pelo bracket. A página mostra o cálculo em "Como chegamos nesse número".

## Deploy

### Banco de dados

O código funciona com **PostgreSQL ou MySQL** (os testes passam nos dois); basta trocar o `DATABASE_URL`.
Para começar sem custo, o PostgreSQL tem mais opções gratuitas (Neon, Supabase); para MySQL, Railway ou Aiven.

### Backend (Render, Railway, Fly…)

- **Build:** `bash build.sh` (instala dependências, `collectstatic` e `migrate`)
- **Start:** `gunicorn config.wsgi --bind 0.0.0.0:$PORT --workers 2 --timeout 120` (também no `Procfile`)
- **Health check:** `/api/health/`
- **Variáveis:** veja a seção "Produção" do `backend/.env.example`
- **Primeira carga dos dados:** no shell do host, `python manage.py import_mtgjson` e depois `python manage.py sync_scryfall`
- **Admin:** `python manage.py createsuperuser` no shell do host

Com `DEBUG=False`, o site força HTTPS, usa cookies seguros e HSTS (começa em 1 dia; suba `SECURE_HSTS_SECONDS` para 1 ano depois que tudo estiver estável). Os arquivos do admin são servidos pelo WhiteNoise. `python manage.py check --deploy` deve passar sem avisos.

Limites por usuário (ou IP): importação de decks, criação de salas, entrada em salas, sorteios e login. Os valores ficam em `config/settings.py` e podem ser ajustados por variável de ambiente.

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

Choose at random é conteúdo de fã não oficial, permitido pela Fan Content Policy. Não é aprovado nem endossado pela Wizards of the Coast. Dados e imagens de cartas fornecidos pelo [Scryfall](https://scryfall.com).
