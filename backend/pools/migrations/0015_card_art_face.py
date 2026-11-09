from django.db import migrations, models


class Migration(migrations.Migration):
    """
    Arte do verso das cartas de duas faces. A restrição nova entra antes de sair a antiga: no MySQL
    a chave estrangeira do deck precisa de um índice começando por ela o tempo todo.
    """

    dependencies = [
        ("pools", "0014_deck_card_art_copies"),
    ]

    operations = [
        migrations.AddField(
            model_name="cardart",
            name="face",
            field=models.PositiveSmallIntegerField(choices=[(0, "frente"), (1, "verso")], default=0, verbose_name="face"),
        ),
        migrations.AddField(
            model_name="deckcardart",
            name="face",
            field=models.PositiveSmallIntegerField(choices=[(0, "frente"), (1, "verso")], default=0, verbose_name="face"),
        ),
        migrations.AddConstraint(
            model_name="deckcardart",
            constraint=models.UniqueConstraint(
                fields=("deck", "oracle_id", "face", "position"),
                name="unique_deck_card_art_face",
            ),
        ),
        migrations.RemoveConstraint(
            model_name="deckcardart",
            name="unique_deck_card_art_position",
        ),
    ]
