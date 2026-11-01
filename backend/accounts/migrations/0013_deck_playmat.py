import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0012_founder_perks'),
        ('pools', '0013_generator_usage'),
    ]

    operations = [
        migrations.CreateModel(
            name='DeckPlaymat',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('key', models.UUIDField(default=uuid.uuid4, unique=True)),
                ('image', models.BinaryField()),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('hidden_at', models.DateTimeField(blank=True, null=True)),
                ('deck', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='playmat', to='pools.userdeck')),
            ],
        ),
    ]
