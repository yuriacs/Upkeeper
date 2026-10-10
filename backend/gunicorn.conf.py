"""
Configuração do gunicorn, lida automaticamente quando ele roda nesta pasta.
Opções passadas na linha de comando (como --workers e --timeout no Render) têm prioridade.
"""

# Cada processo atende várias requisições ao mesmo tempo com threads. A maior parte do tempo
# de uma requisição é esperando o banco (Neon) responder, então threads rendem bem mesmo
# na máquina gratuita, e as consultas das salas (a cada 2 s por jogador) não fazem fila.
worker_class = "gthread"
threads = 4
workers = 2
timeout = 120
# Mantém a conexão com o proxy do Render aberta entre requisições
keepalive = 5
