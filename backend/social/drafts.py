"""
Rascunhos de post a partir do feed (social/feed.py): texto no tom do Upkeeper e as imagens como
especificação (`slides`: modelo + dados), que o painel desenha e exporta em PNG.

Fase 1: modelos de texto fixos (sem IA). Instagram leva o texto longo com hashtags e o carrossel;
X leva até 280 caracteres e só a primeira imagem, sem endereço de site no texto (no X, post com
link custa bem mais: o link fica no perfil).
"""

X_LIMIT = 280
KINDS = ("ranking", "precon", "numbers")

TAGS = {
    "instagram": "#MTG #MagicTheGathering #Commander #EDH #MTGCommander #Upkeeper",
    "x": "#MTG #Commander",
}

T = {
    "pt": {
        "ranking_title": "Ranking da semana",
        "ranking_sub": "Os comandantes que mais venceram nos últimos {days} dias",
        "ranking_list": "Comandantes que mais venceram",
        "wins": "{w} vitórias · {g} partidas",
        "ranking_ig": "🏆 Ranking da semana no Upkeeper!\n\nOs comandantes que mais venceram nos últimos {days} dias:\n{lines}\n\nSeu comandante está aqui? Bora jogar uma partida: link na bio.",
        "ranking_x": "🏆 Ranking da semana no Upkeeper:\n{lines}\n\nSeu comandante entra na próxima?",
        "precon_ig": "🃏 Precon em destaque: {name}\n\nComandante: {commander}\n{edition}{bracket}Valor estimado: US$ {price}\n\nCartas mais valiosas:\n{cards}\n\nJogue com ele de graça no Upkeeper: link na bio.",
        "precon_x": "🃏 Precon do dia: {name}, com {commander}. {bracket_short}US$ {price} em cartas. Você jogaria?",
        "numbers_title": "A semana em números",
        "numbers_ig": "📊 A semana no Upkeeper:\n\n• {games} partidas terminadas\n• {players} jogadores\n• {commanders} comandantes diferentes\n{most}\nObrigado a todo mundo que jogou! Link na bio.",
        "numbers_x": "📊 A semana no Upkeeper: {games} partidas, {players} jogadores e {commanders} comandantes diferentes.{most_short}",
        "most": "• Mais jogado: {name}\n",
        "most_short": " Mais jogado: {name}.",
        "games": "partidas",
        "players": "jogadores",
        "commanders": "comandantes",
        "bracket": "Bracket {b} · ",
        "featured": "Precon em destaque",
    },
    "en": {
        "ranking_title": "Weekly ranking",
        "ranking_sub": "The commanders with the most wins in the last {days} days",
        "ranking_list": "Commanders with the most wins",
        "wins": "{w} wins · {g} games",
        "ranking_ig": "🏆 This week's ranking on Upkeeper!\n\nThe commanders with the most wins in the last {days} days:\n{lines}\n\nIs yours on the list? Come play a game: link in bio.",
        "ranking_x": "🏆 This week's ranking on Upkeeper:\n{lines}\n\nWill your commander make it next week?",
        "precon_ig": "🃏 Featured precon: {name}\n\nCommander: {commander}\n{edition}{bracket}Estimated value: US$ {price}\n\nMost valuable cards:\n{cards}\n\nPlay it for free on Upkeeper: link in bio.",
        "precon_x": "🃏 Precon of the day: {name}, led by {commander}. {bracket_short}US$ {price} in cards. Would you play it?",
        "numbers_title": "The week in numbers",
        "numbers_ig": "📊 The week on Upkeeper:\n\n• {games} games finished\n• {players} players\n• {commanders} different commanders\n{most}\nThanks to everyone who played! Link in bio.",
        "numbers_x": "📊 The week on Upkeeper: {games} games, {players} players and {commanders} different commanders.{most_short}",
        "most": "• Most played: {name}\n",
        "most_short": " Most played: {name}.",
        "games": "games",
        "players": "players",
        "commanders": "commanders",
        "bracket": "Bracket {b} · ",
        "featured": "Featured precon",
    },
}


class NothingToPost(Exception):
    """O feed não tem dados para esse tipo de post (ex.: nenhuma partida na semana)."""


def _fit_x(text: str, tags: str) -> str:
    """Texto do X com as hashtags, cortado para caber nos 280 caracteres."""
    full = f"{text}\n\n{tags}"
    if len(full) <= X_LIMIT:
        return full
    room = X_LIMIT - len(tags) - 3
    return f"{text[: room - 1].rstrip()}…\n\n{tags}"


def build(kind: str, network: str, lang: str, feed: dict) -> tuple[str, list[dict]]:
    """(texto, slides) de um post. Levanta NothingToPost se faltar dado."""
    t = T["en" if lang == "en" else "pt"]
    tags = TAGS[network]
    if kind == "ranking":
        top = feed["top_commanders"]
        if not top:
            raise NothingToPost("ranking")
        lines = "\n".join(f"{i}. {c['name']} ({t['wins'].format(w=c['wins'], g=c['games'])})" for i, c in enumerate(top, 1))
        slides = [
            {"t": "cover", "kicker": "Upkeeper", "title": t["ranking_title"],
             "subtitle": t["ranking_sub"].format(days=feed["days"]), "art": top[0]["art"]},
            {"t": "list", "title": t["ranking_list"],
             "rows": [{"name": c["name"], "image": c["art"], "value": t["wins"].format(w=c["wins"], g=c["games"])} for c in top]},
        ]
        if network == "x":
            short = "\n".join(f"{i}. {c['name']}" for i, c in enumerate(top[:3], 1))
            return _fit_x(t["ranking_x"].format(lines=short), tags), slides[:1]
        return f"{t['ranking_ig'].format(days=feed['days'], lines=lines)}\n\n{tags}", slides
    if kind == "precon":
        p = feed.get("featured_precon")
        if not p:
            raise NothingToPost("precon")
        bracket = t["bracket"].format(b=p["bracket"]) if p.get("bracket") else ""
        edition = f"{p['edition']}{' (' + str(p['year']) + ')' if p.get('year') else ''}\n"
        cards = "\n".join(f"• {c['name']}" + (f" (US$ {c['usd']})" if c.get("usd") else "") for c in p["top_cards"])
        slides = [{"t": "precon", "kicker": t["featured"], **p}]
        if network == "x":
            text = t["precon_x"].format(name=p["name"], commander=p["commander"], bracket_short=bracket.replace(" · ", ". "),
                                        price=p["price_usd"])
            return _fit_x(text, tags), slides
        text = t["precon_ig"].format(name=p["name"], commander=p["commander"], edition=edition, bracket=bracket,
                                     price=p["price_usd"], cards=cards)
        return f"{text}\n\n{tags}", slides
    if kind == "numbers":
        n = feed["numbers"]
        if not n["games"]:
            raise NothingToPost("numbers")
        most = n.get("most_played")
        art = next((c["art"] for c in feed["top_commanders"] if c["name"] == most), "")
        slides = [{"t": "numbers", "kicker": "Upkeeper", "title": t["numbers_title"], "art": art, "highlight": most,
                   "stats": [{"value": n["games"], "label": t["games"]}, {"value": n["players"], "label": t["players"]},
                             {"value": n["commanders"], "label": t["commanders"]}]}]
        if network == "x":
            text = t["numbers_x"].format(**n, most_short=t["most_short"].format(name=most) if most else "")
            return _fit_x(text, tags), slides
        text = t["numbers_ig"].format(**n, most=t["most"].format(name=most) if most else "")
        return f"{text}\n\n{tags}", slides
    raise ValueError(kind)
