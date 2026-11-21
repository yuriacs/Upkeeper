from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0013_deck_playmat'),
    ]

    operations = [
        migrations.CreateModel(
            name='DbAwakeDay',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('day', models.DateField(unique=True)),
                ('seconds', models.FloatField(default=0)),
            ],
            options={
                'verbose_name': 'dia de banco acordado',
                'verbose_name_plural': 'dias de banco acordado',
            },
        ),
    ]
