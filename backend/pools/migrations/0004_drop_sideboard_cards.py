"""
Decks da pool salvos antes de a leitura da lista reconhecer sideboard/maybeboard em mais formatos
(categoria do Archidekt, "//Sideboard", "SB:", bloco final do MTGO): tira essas cartas do deck.

Só sai a carta cujo nome aparece numa linha da lista que agora fica de fora e em nenhuma linha
que continua no deck (cartas com nome corrigido pelo Scryfall ficam como estão).
"""

from django.db import migrations


def _matches(card_name: str, names: set[str]) -> bool:
    name = card_name.casefold()
    return name in names or name.split(" // ")[0] in names


def drop_sideboard(apps, schema_editor):
    from pools.services.decklist import LINE_RE, DecklistError, parse_decklist

    UserDeck = apps.get_model("pools", "UserDeck")
    for deck in UserDeck.objects.exclude(decklist_text=""):
        try:
            kept = {line.name.casefold() for line in parse_decklist(deck.decklist_text)}
        except DecklistError:
            continue
        raw = set()
        for text in deck.decklist_text.splitlines():
            m = LINE_RE.match(text.strip().removeprefix("SB:").removeprefix("sb:").strip())
            if m and m.group("name"):
                raw.add(m.group("name").strip().casefold())
        dropped = raw - kept
        if not dropped:
            continue
        for dc in deck.deck_cards.select_related("card"):
            if not dc.is_commander and _matches(dc.card.name, dropped) and not _matches(dc.card.name, kept):
                dc.delete()


class Migration(migrations.Migration):
    dependencies = [("pools", "0003_deck_analysis")]

    operations = [migrations.RunPython(drop_sideboard, migrations.RunPython.noop)]
