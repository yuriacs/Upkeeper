# Escala da mesa virtual

Como a mesa virtual roda hoje, quanto uma instância aguenta e o que fazer quando não der mais.
Para medir de novo (no seu computador ou no shell do Render): `python manage.py table_capacity`.
Para um teste de carga de ponta a ponta (conexões de verdade), num banco de teste:
`python manage.py stress_setup` e `backend/stress/loadtest.py`.

## Como funciona hoje

- **Um processo só** (`Procfile`: um `uvicorn`). Cada mesa aberta vive na memória desse processo
  (`tables/state.py`, `TABLES`), e o banco guarda uma cópia de tempos em tempos para a mesa voltar
  se o servidor reiniciar.
- As conexões (WebSocket) da mesma mesa conversam pelo `InMemoryChannelLayer`, também na memória.
- Limites de requisição e caches usam o `LocMemCache` (memória do processo).

Tudo isso só funciona porque existe um processo. **Ligar uma segunda instância (ou mais workers)
quebra a mesa**: dois jogadores da mesma mesa podem cair em processos diferentes e ver duas mesas
diferentes. Trocar só o channel layer por Redis não resolve isso, porque o estado da mesa continua
na memória de cada processo.

## Quanto uma instância aguenta

Medido com `table_capacity` (mesas de 4 jogadores com precons, 10 cartas no campo de cada um):

| | Medido |
| --- | --- |
| Memória por mesa | ~350 KB |
| CPU por jogada (ação + atualização para os 4) | 1 a 3,5 ms num PC; conte 10× mais numa CPU compartilhada do Render |
| Atualização enviada por jogador | ~140 bytes (só a diferença) |

Contas para uma instância de 512 MB e meia CPU (Render Starter), pelo pior caso:

- **Memória:** o Django ocupa uns 150–200 MB; sobram ~300 MB → **~800 mesas abertas**.
- **CPU:** uma mesa ativa faz ~1 jogada a cada 2 s; a 35 ms por jogada, são ~17 ms de CPU por
  segundo por mesa → meia CPU dá conta de **~25–30 mesas jogando ao mesmo tempo** (100–120
  jogadores), com folga para o resto do site.

Ou seja: **a CPU acaba antes da memória**. O plano grátis do Render (0,1 CPU) fica em torno de 5
mesas jogando ao mesmo tempo.

## Sinais de que está chegando no limite

- No painel do Render, CPU perto de 100% nos horários de pico.
- Jogadores relatando atraso entre a jogada e a atualização na tela dos outros.
- O banco (Neon) tem limite próprio: 1 GB e 100 horas de CPU por mês no plano grátis.

## O caminho para crescer (em ordem)

1. **Instância maior** (mais CPU no mesmo processo). Não muda código e cobre muito crescimento.
2. **Várias instâncias com a mesa "presa" a uma delas.** Cada mesa passa a ter dono: as conexões
   de uma mesa vão sempre para a mesma instância (pelo código da mesa). Precisa de:
   - Redis (Render Key Value) para o channel layer (`channels-redis`) e para o cache e os limites
     de requisição (`django.core.cache.backends.redis.RedisCache`), que precisam ser
     compartilhados;
   - um jeito de mandar cada código de mesa para a instância certa (um registro "mesa → instância"
     no Redis e um redirecionamento na entrada da mesa, ou um proxy que roteia pelo código);
   - a varredura de mesas paradas (`tables/closer.py`) rodando em cada instância só para as suas.
3. **Estado da mesa fora da memória** (Redis, com uma trava por mesa). É o mais flexível e o mais
   trabalhoso: cada jogada lê e grava a mesa no Redis, então custa mais por jogada.

Antes de qualquer um desses passos, rode `table_capacity` de novo: os números mudam quando a mesa
ganha funções novas.
