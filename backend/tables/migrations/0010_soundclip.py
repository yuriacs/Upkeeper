import uuid

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('tables', '0009_replay_share'),
    ]

    operations = [
        migrations.CreateModel(
            name='SoundClip',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('key', models.UUIDField(default=uuid.uuid4, unique=True)),
                ('name', models.CharField(max_length=32, verbose_name='nome')),
                ('emoji', models.CharField(blank=True, max_length=16, verbose_name='emoji')),
                ('audio', models.BinaryField(verbose_name='áudio')),
                ('content_type', models.CharField(max_length=32)),
                ('size', models.PositiveIntegerField(default=0)),
                ('position', models.PositiveIntegerField(default=0, verbose_name='ordem')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
            options={
                'verbose_name': 'som do soundboard',
                'verbose_name_plural': 'sons do soundboard',
            },
        ),
    ]
