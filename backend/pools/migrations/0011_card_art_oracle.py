from django.db import migrations, models


def link_to_card(apps, schema_editor):
    """Artes já enviadas: ficam com a carta em que são usadas (se for uma só, em decks ou fichas)."""
    CardArt = apps.get_model("pools", "CardArt")
    DeckCardArt = apps.get_model("pools", "DeckCardArt")
    TokenArt = apps.get_model("pools", "TokenArt")
    cards: dict[int, set] = {}
    for model in (DeckCardArt, TokenArt):
        for art_id, oracle_id in model.objects.values_list("art_id", "oracle_id"):
            cards.setdefault(art_id, set()).add(oracle_id)
    for art_id, oracle_ids in cards.items():
        if len(oracle_ids) == 1:
            CardArt.objects.filter(pk=art_id).update(oracle_id=next(iter(oracle_ids)))


class Migration(migrations.Migration):

    dependencies = [
        ('pools', '0010_card_art_hidden'),
    ]

    operations = [
        migrations.AddField(
            model_name='cardart',
            name='oracle_id',
            field=models.UUIDField(blank=True, db_index=True, null=True),
        ),
        migrations.RunPython(link_to_card, migrations.RunPython.noop),
    ]
