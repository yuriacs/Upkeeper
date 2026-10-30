from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('tables', '0004_game_replay'),
    ]

    operations = [
        migrations.AddField(
            model_name='gamereplay',
            name='resume',
            field=models.BinaryField(editable=False, null=True, verbose_name='mesa para restaurar (zlib)'),
        ),
        migrations.AddField(
            model_name='gamereplay',
            name='restored_code',
            field=models.CharField(blank=True, default='', max_length=12, verbose_name='restaurada na mesa'),
        ),
    ]
