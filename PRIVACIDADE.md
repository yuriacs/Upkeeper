# Privacidade dos jogadores

Regra do projeto: **nenhum dado pessoal de jogador fica legível no servidor**, nem para quem
administra o site, nem para quem tem acesso ao banco, aos backups ou aos logs. Isso vale para o que
existe hoje e para tudo que for adicionado ao perfil no futuro.

## O que acontece com cada dado

| Dado | Onde fica | Quem consegue ler |
| --- | --- | --- |
| Senha | Nunca sai do navegador. Vai uma chave derivada dela (`auth_key`); o servidor guarda só o hash dessa chave. | Ninguém |
| E-mail | Servidor: impressão digital HMAC-SHA256 com a chave `EMAIL_PEPPER` (`PrivateProfile.email_digest`). Cópia legível: dentro do cofre. | Só o jogador (no navegador dele) |
| Perfil privado (cofre) | `PrivateProfile.vault`: JSON cifrado com AES-256-GCM no navegador | Só o jogador |
| Nome de usuário, decks, sorteios, partidas, nome nas salas/mesas | Texto normal no banco | Todo mundo que precisa ver (é público por natureza) |
| Foto de perfil (opcional) | `accounts.Avatar`: imagem já tratada (quadrado de 256 px em WebP, sem EXIF/metadados), endereço com chave aleatória | Todo mundo (mesa e perfil público); o jogador remove quando quiser e ela some ao excluir a conta |
| Apoiador (opcional) | `accounts.Supporter`: até quando vale, quantas ativações, cor do sleeve, se aparece no mural e nos créditos, se é Fundador e o **total doado** (só a soma, digitada pelo admin, para o selo de Fundador). Nada de cada doação, nome no banco ou e-mail do Ko-fi | Selo, Fundador, sleeve, mural e créditos: todo mundo; a data e o total: o jogador e o admin |
| Aviso de doação (opcional) | `accounts.DonationClaim`: os centavos reservados para a conta, quando reservou, quando avisou "Já doei" e, se for presente, para qual conta. Nada do pagamento. Apagado ao ativar, ao recusar ou em 7 dias | O jogador e o admin |
| Sleeve com imagem (Fundador, opcional) | `accounts.SleeveArt`: imagem já tratada (formato de carta em WebP, sem metadados), endereço com chave aleatória, moderada como a foto. Título, foil e moldura ficam em `accounts.Supporter` (listas fixas, sem texto livre) | Todo mundo na mesa e no perfil; some ao remover ou excluir a conta |
| Fundo do campo (apoiador, opcional) | `accounts.Playmat`: imagem já tratada (1280 × 720 em WebP, sem metadados), endereço com chave aleatória, moderada como a foto | Todo mundo na mesa; some ao remover ou excluir a conta |
| Denúncia de imagem (foto ou arte de outro jogador) | `accounts.ImageReport`: qual imagem, de quem, quem denunciou e a decisão. Sem texto livre | Só o admin (o dono da imagem não sabe quem denunciou) |
| Frase do "Descreva seu deck" e lista do guia de jogo (gerador de decks, opcional) | Não fica: o servidor repassa ao Gemini (`pools/generator.py`) e devolve a resposta; nada vai para o banco nem para o log | O Google, que processa o texto para responder (sem nada da conta) |
| Histórico do gerador de decks | Só no navegador (`localStorage`, `precon-draft:generated`) | Quem usa aquele navegador |

## Como a criptografia funciona

Código: `frontend/src/lib/vault.ts` (navegador) e `backend/accounts/privacy.py` (servidor).

```
senha ──PBKDF2-SHA256, 600 mil rodadas, salt aleatório da conta──► chave-mestra
chave-mestra ──HKDF "upkeeper:auth"──────► auth_key  → servidor (guarda como se fosse a senha, com hash)
chave-mestra ──HKDF "upkeeper:vault-wrap"─► tranca a chave do cofre  (nunca sai do navegador)
código de recuperação (160 bits) ──HKDF───► tranca a mesma chave do cofre
chave do cofre (aleatória, 256 bits) ─────► AES-256-GCM no JSON do perfil
```

- O servidor guarda: o salt (público), a chave do cofre trancada duas vezes (pela senha e pelo
  código de recuperação) e o conteúdo cifrado. Sem a senha ou o código, nada disso abre.
- Antes do login, o navegador pede o salt (`POST /api/auth/prelogin/`). Para um login que não
  existe, o servidor devolve um salt falso, sempre o mesmo: a etapa não revela quem tem conta.
- A chave do cofre fica guardada no navegador (IndexedDB) como chave **não exportável** e é
  apagada ao sair da conta.
- Conta só do Google/Discord não tem senha: o cofre ganha uma "senha do cofre", que também nunca
  sai do navegador.

## Esqueci a senha

1. O jogador digita o e-mail. O servidor calcula a impressão digital, acha a conta e manda o link
   **para o endereço que acabou de receber**, sem gravar (`accounts/mail.py`). A resposta é sempre
   a mesma, com ou sem conta, e o envio roda em segundo plano para o tempo de resposta também não
   revelar nada.
2. O link (válido por 1 hora, uma vez só) traz `uid` e `token` depois do `#`, que o navegador não
   envia para servidor nenhum.
3. Com o código de recuperação, o cofre é trancado de novo com a senha nova. Sem ele, o cofre
   recomeça vazio (conta, decks e histórico não mudam).

## Limites (honestos)

- **O que outros jogadores veem não é criptografado**: nome de usuário, foto de perfil, decks,
  sorteios, partidas. A foto é escolha do jogador (opcional) e o servidor nunca guarda o arquivo
  original: só a versão recortada, sem os metadados (EXIF pode ter a localização da foto).
- **O e-mail passa pelo servidor por um instante** no cadastro, no login por e-mail, na troca de
  e-mail e no "esqueci a senha", para calcular a impressão digital ou mandar a mensagem. Ele não é
  gravado nem registrado em log, mas o código que roda no servidor tem acesso naquele momento.
- **Quem tem a `EMAIL_PEPPER` consegue testar um palpite** ("fulano@x.com tem conta?"), mas não
  consegue listar nem ler os e-mails. Não guarde essa chave em lugar nenhum além do painel do host.
- **Criptografia no navegador depende do código servido pelo site.** Uma versão maliciosa do
  frontend poderia capturar a senha. Isso vale para qualquer serviço web com criptografia de ponta a
  ponta (Bitwarden, Proton); a proteção aqui é contra vazamento do banco, backups, logs, painel de
  admin e acesso de quem opera o site.
- O site não manda e-mails por iniciativa própria (avisos, novidades): o servidor não sabe os
  endereços.
- **A frase do gerador de decks sai do site.** Com a IA ligada (`GEMINI_API_KEY`), o "Descreva seu
  deck" manda o texto digitado, e o guia de jogo manda a lista de cartas, ao Gemini, sem nome, conta
  ou e-mail. O texto é livre, então a política de privacidade pede para não pôr dados pessoais nele.
  Sem a chave, a frase é lida no próprio navegador, e só as palavras que podem ser o nome do
  comandante vão para a busca do Scryfall (`frontend/src/lib/describeDeck.ts`).

## Adicionando um dado novo ao perfil

1. Dado **pessoal** (nome real, cidade, aniversário, pronomes, redes sociais, bio, telefone...):
   - acrescente o campo no tipo `VaultData` em `frontend/src/lib/vault.ts`;
   - leia e grave com o `useVault()` (`data` e `save(...)`), como o e-mail em
     `frontend/src/components/PrivateProfileCard.tsx`;
   - **não** crie coluna no banco e **não** mande o valor legível para a API.
2. Dado que **outros jogadores precisam ver** (aparece em salas, mesas, ranking): pode ser coluna
   normal, mas pense duas vezes se ele é mesmo pessoal.
3. O teste `accounts/tests/test_privacy.py::SchemaGuardTests` falha quando aparece coluna de texto
   nova no banco. Se a coluna é pública ou técnica, adicione em `SNAPSHOT` com um comentário
   explicando por quê. Se é pessoal, ela vai para o cofre.
4. Busca, filtro ou ordenação pelo servidor não funcionam em dado do cofre (o servidor não lê). Se
   precisar disso, o dado não é privado; discuta antes.

## Configuração (produção)

- `EMAIL_PEPPER`: obrigatória. Gere com
  `python -c "import secrets; print(secrets.token_urlsafe(48))"`. **Nunca troque** depois que houver
  contas (o login por e-mail e o "esqueci a senha" param de reconhecer os e-mails antigos).
- `RESEND_API_KEY`: chave de API do Resend (sem ela, o link "Esqueceu a senha?" não aparece).
- `DEFAULT_FROM_EMAIL`: remetente, ex.: `Upkeeper <nao-responda@upkeeper.online>`.

## Contas antigas (criadas antes desta mudança)

- A migração `accounts/0003_private_profile` troca todos os e-mails pela impressão digital e
  apaga o texto legível no deploy. O login por e-mail continua funcionando.
- No primeiro login depois disso, a conta manda a senha uma última vez, passa para a chave
  derivada e ganha o cofre (com código de recuperação). Se entrou pelo e-mail, ele já vai para o
  cofre; senão, o jogador adiciona em "Minha conta".
- Quem continua logado desde antes vê "Saia e entre de novo para ativar seu perfil privado".
