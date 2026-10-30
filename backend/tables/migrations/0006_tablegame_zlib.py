from django.db import migrations

import tables.fields


def pack(apps, schema_editor):
    TableGame = apps.get_model("tables", "TableGame")
    for row in TableGame.objects.only("code", "data").iterator():
        TableGame.objects.filter(code=row.code).update(packed=row.data)


def unpack(apps, schema_editor):
    TableGame = apps.get_model("tables", "TableGame")
    for row in TableGame.objects.only("code", "packed").iterator():
        TableGame.objects.filter(code=row.code).update(data=row.packed)


class Migration(migrations.Migration):
    """Estado da mesa: de JSON para JSON compactado (as mesas abertas são convertidas)."""

    dependencies = [
        ("tables", "0005_replay_resume"),
    ]

    operations = [
        migrations.AddField(
            model_name="tablegame",
            name="packed",
            field=tables.fields.ZlibJSONField(null=True, verbose_name="estado (zlib)"),
        ),
        migrations.RunPython(pack, unpack),
        migrations.RemoveField(model_name="tablegame", name="data"),
        migrations.RenameField(model_name="tablegame", old_name="packed", new_name="data"),
        migrations.AlterField(
            model_name="tablegame",
            name="data",
            field=tables.fields.ZlibJSONField(verbose_name="estado (zlib)"),
        ),
    ]
