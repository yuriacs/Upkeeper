"""
Rascunhos de post a partir do feed (social/feed.py): texto no tom do Upkeeper e as imagens como
especificação (`slides`: modelo + dados), que o painel desenha e exporta em PNG.

Fase 1: modelos de texto fixos (sem IA). Instagram leva o texto longo com hashtags e o carrossel;
X leva até 280 caracteres e só a primeira imagem, sem endereço de site no texto (no X, post com
link custa bem mais: o link fica no perfil).
"""

X_LIMIT = 280
KINDS = ("ranking", "precon", "numbers", "champion")

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
        "months": ("janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro",
                   "outubro", "novembro", "dezembro"),
        "champion_kicker": "Temporada",
        "champion_title": "Campeão de {month}",
        "champion_sub": "{name} · {w} vitórias em {g} partidas",
        "champion_list": "Quem mais ganhou em {month}",
        "champion_with": ", quase sempre com {commander}",
        "champion_ig": "👑 {name} é o campeão de {month} no Upkeeper!\n\n{w} vitórias em {g} partidas{with_}.\n\n{lines}A temporada de {next} já começou: quem leva o título? Link na bio.",
        "champion_x": "👑 {name} é o campeão de {month} no Upkeeper: {w} vitórias em {g} partidas. A temporada de {next} já começou!",
        "champion_lines": "Quem mais ganhou no mês:\n{rows}\n\n",
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
        "months": ("January", "February", "March", "April", "May", "June", "July", "August", "September",
                   "October", "November", "December"),
        "champion_kicker": "Season",
        "champion_title": "{month} champion",
        "champion_sub": "{name} · {w} wins in {g} games",
        "champion_list": "Most wins in {month}",
        "champion_with": ", mostly with {commander}",
        "champion_ig": "👑 {name} is the {month} champion on Upkeeper!\n\n{w} wins in {g} games{with_}.\n\n{lines}The {next} season has already started: who takes the title? Link in bio.",
        "champion_x": "👑 {name} is the {month} champion on Upkeeper: {w} wins in {g} games. The {next} season has already started!",
        "champion_lines": "Most wins this month:\n{rows}\n\n",
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
    if kind == "champion":
        data = feed.get("champion")
        if not data:
            raise NothingToPost("champion")

        def month_name(iso: str) -> str:
            return t["months"][int(iso[5:7]) - 1]

        month, nxt, c = month_name(data["month"]), month_name(data["next"]), data["champion"]
        wins = t["wins"]
        slides = [
            {"t": "cover", "kicker": t["champion_kicker"], "title": t["champion_title"].format(month=month),
             "subtitle": t["champion_sub"].format(name=c["username"], w=c["wins"], g=c["games"]), "art": c["art"]},
        ]
        if len(data["top"]) > 1:
            slides.append({"t": "list", "title": t["champion_list"].format(month=month), "rows": [
                {"name": r["username"], "image": r["art"], "value": wins.format(w=r["wins"], g=r["games"])}
                for r in data["top"]
            ]})
        if network == "x":
            text = t["champion_x"].format(name=c["username"], month=month, w=c["wins"], g=c["games"], next=nxt)
            return _fit_x(text, tags), slides[:1]
        rows = "\n".join(f"{i}. {r['username']} ({wins.format(w=r['wins'], g=r['games'])})"
                         for i, r in enumerate(data["top"], 1))
        text = t["champion_ig"].format(
            name=c["username"], month=month, w=c["wins"], g=c["games"], next=nxt,
            with_=t["champion_with"].format(commander=c["commander"]) if c.get("commander") else "",
            lines=t["champion_lines"].format(rows=rows) if len(data["top"]) > 1 else "",
        )
        return f"{text}\n\n{tags}", slides
    raise ValueError(kind)


def champion_drafts() -> list:
    """
    No começo do mês, os rascunhos do post do campeão do mês que acabou (Instagram e X, em
    português), uma vez só por mês: entram no painel como os outros rascunhos, para aprovar. Nada
    quando o campeão não autorizou o nome nos posts (social/feed.py, month_champion).
    """
    from django.utils import timezone

    from decks.services import seasons

    from .feed import month_champion
    from .models import SocialPost

    start = seasons._start(seasons.month_of(timezone.localdate()))
    if SocialPost.objects.filter(kind="champion", created_at__gte=start).exists():
        return []
    data = month_champion()
    if not data:
        return []
    created = []
    for net in ("instagram", "x"):
        text, slides = build("champion", net, "pt", {"champion": data})
        created.append(SocialPost.objects.create(network=net, kind="champion", lang="pt", text=text, slides=slides))
    return created
