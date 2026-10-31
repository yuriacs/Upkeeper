import time

from django.core.management.base import BaseCommand

from social import curation, drafts
from social.clients import ServiceError


class Command(BaseCommand):
    help = (
        "Rodada da curadoria do Instagram (social/curation.py): coleta os perfis monitorados, põe o "
        "post que furou a bolha na fila (ou pede autorização ao autor) e publica o repost aprovado mais "
        "antigo. O servidor chama nos horários de SOCIAL_SLOTS (social/scheduler.py)."
    )

    def add_arguments(self, parser):
        parser.add_argument("--no-collect", action="store_true", help="usa só os posts já coletados")
        parser.add_argument("--no-publish", action="store_true", help="não publica nada nesta rodada")

    def handle(self, *args, **opts):
        steps = []
        if not opts["no_collect"]:
            steps.append(("coleta", lambda: self.stdout.write(f"   {curation.collect()} posts coletados")))
        steps.append(("curadoria", lambda: curation.curate(log_line=self.stdout.write)))
        steps.append(("campeão do mês", self._champion))
        if not opts["no_publish"]:
            steps.append(("publicação", self._publish))
        for name, step in steps:
            self.stdout.write(f"== {name}")
            start = time.monotonic()
            try:
                step()
            except ServiceError as exc:  # um serviço fora do ar não pode parar as demais etapas
                self.stdout.write(self.style.WARNING(f"   {name} falhou: {exc}"))
            self.stdout.write(f"   {name}: {time.monotonic() - start:.0f} s")

    def _champion(self):
        made = drafts.champion_drafts()
        self.stdout.write(f"   {len(made)} rascunhos do campeão do mês" if made else "   nada novo")

    def _publish(self):
        post = curation.publish_next()
        if post is None:
            self.stdout.write("   nenhum repost aprovado")
        elif post.error:
            self.stdout.write(self.style.WARNING(f"   post {post.pk} não saiu: {post.error}"))
        else:
            self.stdout.write(f"   post {post.pk} publicado ({post.external_id})")
