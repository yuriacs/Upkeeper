"""
Conquistas guardadas no banco: as que dependem do que acontece na mesa virtual, no sorteio e nas
salas (as contadas na hora, como partidas e vitórias, ficam em accounts/profile.py). Aqui só a
chave e quanto precisa; nome, descrição e ícone ficam no frontend (src/lib/achievements.ts).

Onde cada uma é conquistada:
  first_upkeep        sentar numa mesa pela primeira vez (tables/consumers.py, authenticate)
  shuffle_up          primeiro sorteio (signals.py, Draw criado)
  deckbuilders_pride  primeiro deck na deckpool (signals.py, UserDeck criado)
  host                abrir mesas virtuais ou salas de sorteio (consumers.get_table, rooms/services.py)
  counter_hoarder     20 marcadores numa permanente só           ┐
  timmy               10 criaturas no campo ao mesmo tempo        │ durante a partida
  library_empty       grimório vazio com a partida rolando        │ (tables/state.py, Table.track_achievements
  snake_eyes          três 1 seguidos no d20                      ┘  e Table.roll)
  voyeur              horas assistindo mesas (Table.unwatch)
  o resto             no fim da partida (services.record_game, com o resumo de Table.game_summary)
"""

HOUR = 3600

# chave → quanto precisa (progress chega a esse número e a conquista é ganha)
GOALS: dict[str, int] = {
    "first_upkeep": 1,
    "shuffle_up": 1,
    "deckbuilders_pride": 1,
    "mulligan_survivor": 1,
    "counter_hoarder": 1,
    "snake_eyes": 1,
    "marathon": 1,
    "speedrun": 1,
    "comeback_kid": 1,
    "color_pie": 5,  # as 5 cores mono
    "wubrg": 1,
    "not_my_deck": 1,
    "stolen_thunder": 1,
    "playgroup": 10,  # partidas com as mesmas 3 pessoas
    "open_table": 20,  # pessoas diferentes
    "host": 25,  # mesas ou salas abertas
    "upkeeper": 100,  # turnos comprando carta no próprio turno
    "timmy": 1,
    "library_empty": 1,
    "voyeur": 40 * HOUR,  # em segundos (o perfil mostra em horas)
}

# Números das regras (usados na mesa e no fim da partida)
COUNTERS_NEEDED = 20
CREATURES_NEEDED = 10
SNAKE_EYES_ROLLS = 3
MARATHON_SECONDS = 2 * HOUR
SPEEDRUN_TURNS = 5  # vencer até o 5º turno próprio ("antes do turno 6")
COMEBACK_LIFE = 5
PLAYGROUP_SIZE = 4  # você e as mesmas 3 pessoas
MAX_PODS = 60  # grupos guardados por conta para o Playgroup (os que menos jogaram saem primeiro)
MAX_WATCH_SESSION = 12 * HOUR  # uma sessão assistindo não conta mais que isso

# Conquistas que a mesa confere a cada ação (para pular quem já tem todas)
BOARD_KEYS = ("counter_hoarder", "timmy", "library_empty")
