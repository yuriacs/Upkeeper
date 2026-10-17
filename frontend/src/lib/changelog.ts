/*
 * Novidades do site, dia a dia (página /novidades). Escrito para quem joga, a partir dos commits:
 * a cada mudança que alguém percebe no site, acrescente um item no dia (o mais novo fica em cima).
 * Cada item tem o texto nos dois idiomas, porque a lista não passa pelo t() das traduções.
 */

export type ChangeTag = 'table' | 'deal' | 'site' | 'account' | 'privacy' | 'security' | 'speed' | 'fix'

export type Change = { tag: ChangeTag; en: string; pt: string }
export type ChangeDay = { date: string; changes: Change[] }

export const CHANGELOG: ChangeDay[] = [
  {
    date: '2026-10-17',
    changes: [
      {
        tag: 'fix',
        en: 'Top menu: your account links (My pool, My history, Friends, My account, Sign out) are now in a menu under your name, so the bar fits and the logo no longer gets squeezed.',
        pt: 'Menu do topo: os links da sua conta (Minha pool, Meus sorteios, Amigos, Minha conta, Sair) agora ficam num menu sob o seu nome, então a barra cabe e o logo não fica mais espremido.',
      },
      {
        tag: 'account',
        en: 'My account: you can change your username (once a week). Friends, rankings and decks follow along; past games keep the name you had then.',
        pt: 'Minha conta: dá para trocar o nome de usuário (uma vez por semana). Amigos, rankings e decks acompanham; partidas antigas guardam o nome da época.',
      },
      {
        tag: 'table',
        en: 'Table chat and log: card names are links. Hover one to see the card and to highlight it on the battlefield. In chat, names of cards on the table become links on their own, and [[Card name]] links any card.',
        pt: 'Chat e log da mesa: os nomes de carta viram links. Passe o mouse para ver a carta e destacá-la no campo. No chat, os nomes das cartas que estão na mesa viram links sozinhos, e [[Nome da carta]] linka qualquer carta.',
      },
      {
        tag: 'table',
        en: 'Table: the action bar is grouped into menus, like untap.in (Library, Add to the battlefield, Dice and Game), and has two quick signals for everyone: Alert (wait, I have a response) and No response.',
        pt: 'Mesa: a barra de ações ficou agrupada em menus, como no untap.in (Grimório, Adicionar ao campo, Dados e Jogo), e ganhou dois avisos rápidos para todos: Alerta (espera, tenho uma resposta) e Sem resposta.',
      },
      {
        tag: 'fix',
        en: 'Card shortcuts: they work on a spell you dragged to the battlefield (or from the graveyard or exile), on a card that is already tapped, and on an opponent’s card you control. When a shortcut can’t be used, the message now says why.',
        pt: 'Atalhos de carta: funcionam na mágica arrastada para o campo (ou no cemitério e no exílio), na carta que já estava virada e na carta de um oponente que você controla. Quando um atalho não dá para usar, a mensagem agora diz o porquê.',
      },
      {
        tag: 'fix',
        en: 'Deckbuilder: the deck list no longer shifts while you move the mouse over it; groups stay in fixed columns.',
        pt: 'Deckbuilder: a lista do deck não balança mais ao passar o mouse; os grupos ficam em colunas fixas.',
      },
      {
        tag: 'deal',
        en: 'Deckbuilder: more categories when grouping by function, so fewer cards land in “Other”: token makers, sacrifice outlets, drain, anthems, blink, self-mill, graveyard hate, discard and lifegain.',
        pt: 'Deckbuilder: mais categorias ao agrupar por função, para menos cartas caírem em “Outro”: geram fichas, sacrifício, drenar vida, bônus para o time, blink, encher o cemitério, contra cemitério, descarte e ganho de vida.',
      },
      {
        tag: 'deal',
        en: 'Deckbuilder: choose where the search looks (name, card text or type), with clickable examples of the Scryfall syntax. The deck list shows the full card names; the buttons appear when you hover over a card.',
        pt: 'Deckbuilder: escolha onde a busca procura (nome, texto da carta ou tipo), com exemplos clicáveis da sintaxe do Scryfall. A lista do deck mostra o nome inteiro das cartas; os botões aparecem ao passar o mouse na carta.',
      },
      {
        tag: 'deal',
        en: 'Deckbuilder, inspired by Archidekt: group the deck by function (ramp, draw, tutors, removal, board wipes, counterspells, protection, recursion), by type or by mana value, as a list or as card images. You can change a card’s category by hand, keep cards in a maybeboard, add a card by typing its name, compare color costs with color sources and draw a sample hand.',
        pt: 'Deckbuilder, inspirado no Archidekt: agrupe o deck por função (ramp, compra, tutores, remoção, board wipes, contramágicas, proteção, recursão), por tipo ou por valor de mana, em lista ou em imagens das cartas. Dá para trocar a categoria de uma carta à mão, guardar cartas num maybeboard, adicionar uma carta digitando o nome, comparar o custo de cada cor com as fontes dela e tirar uma mão de teste.',
      },
      {
        tag: 'deal',
        en: 'Deckbuilder: color filter. For commanders, it finds exactly the colors you pick; for the other cards, any of them.',
        pt: 'Deckbuilder: filtro por cor. Nos comandantes, acha exatamente as cores escolhidas; nas outras cartas, qualquer uma delas.',
      },
      {
        tag: 'deal',
        en: 'Deckbuilder: each card in the search shows its price before you add it.',
        pt: 'Deckbuilder: cada carta da busca mostra o preço antes de você adicionar.',
      },
    ],
  },
  {
    date: '2026-10-16',
    changes: [
      {
        tag: 'deal',
        en: 'Deckbuilder: build Commander decks on the site. Search cards (by name, type, mana value, inside your commander’s colors), pick one or two commanders, see the curve and the value, and get warned about 100 cards, colors, singleton and banned cards. Unsaved work stays as a draft.',
        pt: 'Deckbuilder: monte decks de Commander no site. Busque cartas (por nome, tipo, valor de mana, dentro das cores do comandante), escolha um ou dois comandantes, veja a curva e o valor, e receba avisos sobre 100 cartas, cores, singleton e cartas proibidas. O que não foi salvo fica como rascunho.',
      },
      {
        tag: 'table',
        en: 'Compact hand, like untap.in: only the top of your cards shows and a card rises fully on hover, leaving more room for the battlefield. The arrow next to your graveyard switches between the compact and the whole hand.',
        pt: 'Mão compacta, como no untap.in: aparece só o topo das cartas e a carta sobe inteira ao passar o mouse, sobrando mais espaço para o campo. A seta ao lado do cemitério alterna entre a mão compacta e a inteira.',
      },
      {
        tag: 'table',
        en: 'Ending a game now needs another player to confirm the winner; once confirmed, the win counts in the ranking and the table closes.',
        pt: 'Encerrar a partida agora precisa da confirmação de outro jogador; confirmado, a vitória conta no ranking e a mesa fecha.',
      },
      {
        tag: 'fix',
        en: 'The ranking now shows pool decks too (before, wins with them counted in the total but did not appear in the deck boards).',
        pt: 'O ranking agora mostra também os decks da pool (antes, as vitórias com eles contavam no total mas não apareciam nos quadros de decks).',
      },
      {
        tag: 'table',
        en: 'Deck rules when opening a table: maximum bracket, number of tutors and deck value (up to $150 or $300). Decks outside the rules can’t be loaded.',
        pt: 'Regras dos decks ao abrir a mesa: bracket máximo, quantidade de tutores e valor do deck (até US$ 150 ou US$ 300). Decks fora das regras não podem ser carregados.',
      },
      {
        tag: 'deal',
        en: 'Estimated value of precons and your own decks (sum of the card prices on Scryfall, in dollars and euros), with the most expensive cards. The catalog can sort by price.',
        pt: 'Valor estimado dos precons e dos seus decks (soma dos preços das cartas no Scryfall, em dólar e euro), com as cartas mais caras. O catálogo ordena por preço.',
      },
      {
        tag: 'table',
        en: 'More room for the opponents: their battlefields are now as tall as yours, and the action buttons sit in one row above your zones.',
        pt: 'Mais espaço para os oponentes: o campo deles agora tem a mesma altura que o seu, e os botões de ação ficam numa linha só acima das suas zonas.',
      },
      {
        tag: 'table',
        en: 'Hovering a card on the battlefield brings it to the front of the cards covering it.',
        pt: 'Passar o mouse numa carta do campo traz ela para a frente das que estão por cima.',
      },
      {
        tag: 'deal',
        en: 'Two rankings: one for games with dealt decks and one for games at tables opened without a deal. Ending a game at the table now counts for the second one.',
        pt: 'Dois rankings: um para partidas com decks sorteados e outro para partidas em mesas abertas sem sorteio. Encerrar a partida na mesa agora conta para o segundo.',
      },
      {
        tag: 'table',
        en: 'New table window: name, playstyle (beginner to competitive), 1 vs 1 or 3+ players, friends only and spectators on or off. With 3+, the game starts with whoever is seated; after the first turn, newcomers can only watch.',
        pt: 'Janela de nova mesa: nome, estilo de jogo (de iniciante a competitivo), 1 contra 1 ou 3+ jogadores, só amigos e espectadores ligados ou não. Com 3+, a partida começa com quem estiver sentado; depois do primeiro turno, quem chegar só assiste.',
      },
      {
        tag: 'account',
        en: 'Friends: add someone by username; they accept and can join your "friends only" tables.',
        pt: 'Amigos: adicione alguém pelo nome de usuário; a pessoa aceita e pode entrar nas suas mesas "só amigos".',
      },
      {
        tag: 'table',
        en: 'Card shortcuts: the card menu reads the card text and does it in one click. Fetch lands and ramp spells search your library and shuffle; token makers create the right tokens; plus draw, mill, scry, +1/+1 counters on your creatures, life drain and board wipes. Ctrl+Z undoes it.',
        pt: 'Atalhos de carta: o menu da carta lê o texto dela e faz com um clique. Terrenos de busca e mágicas de rampa buscam no grimório e embaralham; cartas que criam fichas criam as fichas certas; e ainda comprar, moer, vidência, marcadores +1/+1 nas suas criaturas, drenar vida e limpar o campo. Ctrl+Z desfaz.',
      },
    ],
  },
  {
    date: '2026-10-15',
    changes: [
      {
        tag: 'table',
        en: 'Mana pool on the battlefield, by color: tapping a land or another mana source adds its mana, untapping takes it back. Spend it with − on each color; it empties when the turn passes. Turn it on in the table settings.',
        pt: 'Mana em aberto no campo, por cor: virar um terreno ou outra fonte de mana soma a mana dela, desvirar tira. Gaste com o − de cada cor; ela zera quando o turno passa. Ative nas configurações da mesa.',
      },
      {
        tag: 'site',
        en: 'New "What\'s new" page: every change to the site, day by day.',
        pt: 'Nova página de novidades: todas as mudanças do site, dia a dia.',
      },
      {
        tag: 'table',
        en: 'Spectators can follow a player: their battlefield becomes the main one, with their zones below.',
        pt: 'Quem assiste pode seguir um jogador: o campo dele vira o principal, com as zonas embaixo.',
      },
      {
        tag: 'table',
        en: 'Show your hand to spectators, live, until you hide it. They see it below your battlefield while following you.',
        pt: 'Mostre sua mão para quem está assistindo, ao vivo, até esconder. Quem segue você vê a mão embaixo do seu campo.',
      },
      {
        tag: 'table',
        en: 'Abandon a table for good and free your seat. Just leaving still keeps your seat saved.',
        pt: 'Abandone uma mesa de vez e libere o seu lugar. Só sair continua guardando o lugar.',
      },
      {
        tag: 'table',
        en: 'Favorite and recently used tokens and board helpers at the top of the token window.',
        pt: 'Fichas e ajudantes favoritos e usados por último no topo da janela de fichas.',
      },
      {
        tag: 'table',
        en: 'Pressing Enter in the chat sends the message and gives the keyboard back to the hotkeys.',
        pt: 'Enter no chat envia a mensagem e devolve o teclado para os atalhos.',
      },
      {
        tag: 'privacy',
        en: 'Your email is kept only as a fingerprint: nobody can read it on the server, not even us.',
        pt: 'Seu e-mail fica guardado só como uma impressão digital: ninguém consegue lê-lo no servidor, nem nós.',
      },
      {
        tag: 'privacy',
        en: 'Your password never leaves your browser; only a key derived from it is sent.',
        pt: 'Sua senha nunca sai do navegador; só vai uma chave derivada dela.',
      },
      {
        tag: 'privacy',
        en: 'Private profile in an encrypted vault in your browser, with a recovery code.',
        pt: 'Perfil privado num cofre criptografado no seu navegador, com código de recuperação.',
      },
      {
        tag: 'account',
        en: 'Forgot your password? You can now reset it by email.',
        pt: 'Esqueceu a senha? Agora dá para criar uma nova pelo e-mail.',
      },
    ],
  },
  {
    date: '2026-10-14',
    changes: [
      {
        tag: 'site',
        en: 'The site is now called Upkeeper, at upkeeper.online.',
        pt: 'O site agora se chama Upkeeper, em upkeeper.online.',
      },
      {
        tag: 'site',
        en: 'The virtual table is the new home page; the deck dealer moved to its own page.',
        pt: 'A mesa virtual virou a página inicial; o sorteio de decks ganhou uma página própria.',
      },
      {
        tag: 'site',
        en: 'New preview image when you share a link.',
        pt: 'Nova imagem de prévia ao compartilhar um link.',
      },
      {
        tag: 'table',
        en: 'Commander zone: a frame with one slot per commander, partners side by side.',
        pt: 'Zona do comandante: um quadro com uma vaga por comandante, parceiros lado a lado.',
      },
      {
        tag: 'table',
        en: 'Arrange puts creatures on the top row and other permanents in the middle, centered, without moving your commander.',
        pt: 'Organizar põe as criaturas na fileira de cima e as outras permanentes no meio, centralizadas, sem mexer no comandante.',
      },
      {
        tag: 'table',
        en: 'Filter by card type in the graveyard, exile and library (search and look at the top).',
        pt: 'Filtro por tipo de carta no cemitério, no exílio e no grimório (buscar e olhar o topo).',
      },
      {
        tag: 'table',
        en: 'More symbols and counters; power/toughness now sits below the printed one, without covering the card text.',
        pt: 'Mais símbolos e marcadores; a força/resistência agora fica abaixo da impressa, sem cobrir o texto da carta.',
      },
      {
        tag: 'speed',
        en: 'Actions no longer wait for the database: the table answers faster when it is busy.',
        pt: 'As ações não esperam mais o banco de dados: a mesa responde mais rápido quando está cheia.',
      },
      {
        tag: 'security',
        en: 'Protection against abuse: action limits, a cap on tables per account, a notice when the server is full and sign-in lock after wrong passwords.',
        pt: 'Proteção contra abuso: limite de ações, de mesas por conta, aviso de servidor cheio e bloqueio do login depois de senhas erradas.',
      },
      {
        tag: 'account',
        en: 'Sign in with Google or Discord.',
        pt: 'Entrar com Google ou Discord.',
      },
      {
        tag: 'site',
        en: 'Support page: donate by Pix (QR Code or copy and paste) or Ko-fi, and share the site with your group.',
        pt: 'Página Apoie: doação por Pix (QR Code ou copia e cola) ou Ko-fi, e compartilhar o site com o seu grupo.',
      },
    ],
  },
  {
    date: '2026-10-13',
    changes: [
      {
        tag: 'table',
        en: 'Show your hand to one player or to everyone, live, until you hide it.',
        pt: 'Mostre sua mão para um jogador ou para todos, ao vivo, até esconder.',
      },
      {
        tag: 'table',
        en: 'Watch full tables as a spectator.',
        pt: 'Assista às mesas cheias como espectador.',
      },
      {
        tag: 'table',
        en: 'Public list of open tables: join if there is a free seat, watch if it is full.',
        pt: 'Lista pública de mesas abertas: entre se tiver lugar, assista se estiver cheia.',
      },
      {
        tag: 'table',
        en: 'Named counters with − and + in the card menu, saved to reuse on other cards.',
        pt: 'Marcadores com nome próprio, com − e + no menu da carta, salvos para usar em outras cartas.',
      },
      {
        tag: 'table',
        en: 'The enlarged card shows its counters, current power/toughness and state on the battlefield.',
        pt: 'A carta ampliada mostra os marcadores, a força/resistência atual e a situação dela no campo.',
      },
      {
        tag: 'table',
        en: 'Play with the top of your library revealed: everyone sees the top card until you turn it back.',
        pt: 'Jogue com o topo do grimório revelado: todos veem a carta de cima até você desvirar.',
      },
      {
        tag: 'speed',
        en: 'More stable tables: time limits on the database, automatic recovery and reconnection when the table stops answering.',
        pt: 'Mesas mais estáveis: tempo-limite no banco de dados, recuperação automática e reconexão quando a mesa para de responder.',
      },
      {
        tag: 'fix',
        en: 'A full table now says so (it used to stay on "Connecting…"), and players with a seat join as players even from a watch link.',
        pt: 'Mesa cheia agora avisa (antes ficava em "Conectando…"), e quem tem lugar entra como jogador mesmo vindo do link de assistir.',
      },
      {
        tag: 'fix',
        en: 'Fixed a blank screen when changing pages in Chrome; browsers in Portuguese get the site in Portuguese automatically.',
        pt: 'Corrigida a tela branca ao trocar de página no Chrome; navegadores em português já abrem o site em português.',
      },
    ],
  },
  {
    date: '2026-10-12',
    changes: [
      {
        tag: 'table',
        en: 'Ask for control of a card; whoever controls it accepts or declines.',
        pt: 'Peça o controle de uma carta; quem controla aceita ou recusa.',
      },
      {
        tag: 'table',
        en: 'Away players have their turn skipped, and anyone can pass the turn of someone who disconnected.',
        pt: 'Jogador ausente tem o turno pulado, e qualquer um pode passar o turno de quem caiu.',
      },
      {
        tag: 'table',
        en: "Board helpers: the Monarch, the Initiative, The Ring, Day/Night, City's Blessing, energy, radiation, experience, speed and dungeons.",
        pt: 'Ajudantes da mesa: Monarca, Iniciativa, O Anel, Dia/Noite, Bênção da Cidade, energia, radiação, experiência, velocidade e masmorras.',
      },
      {
        tag: 'table',
        en: 'Full-screen table: a side bar with leave and options, and the turn in the right column.',
        pt: 'Mesa em tela cheia: barra lateral com sair e opções, e o turno na coluna da direita.',
      },
      {
        tag: 'table',
        en: "Opponents' graveyard and exile piles on their battlefield, new cards placed in free space and an Arrange button.",
        pt: 'Pilhas de cemitério e exílio no campo dos oponentes, cartas novas em espaço livre e botão Organizar.',
      },
      {
        tag: 'table',
        en: 'Only whoever controls a card changes its power/toughness and counters.',
        pt: 'Só quem controla a carta muda a força/resistência e os marcadores dela.',
      },
      {
        tag: 'speed',
        en: 'Smaller images on the table and much less server work for each action.',
        pt: 'Imagens menores na mesa e muito menos trabalho do servidor a cada ação.',
      },
      {
        tag: 'deal',
        en: 'Imported decks: the sideboard no longer goes into the deck.',
        pt: 'Decks importados: o sideboard não entra mais no deck.',
      },
    ],
  },
  {
    date: '2026-10-11',
    changes: [
      {
        tag: 'table',
        en: 'Virtual table: play Commander online with your deck, hand, battlefield, zones and a game log.',
        pt: 'Mesa virtual: jogue Commander online com seu deck, mão, campo, zonas e registro da partida.',
      },
      {
        tag: 'table',
        en: 'Play now, commander on the battlefield, tokens, counters, dice and chat.',
        pt: 'Jogar agora, comandante no campo, fichas, marcadores, dados e chat.',
      },
      {
        tag: 'table',
        en: 'Keyboard shortcuts and sounds.',
        pt: 'Atalhos de teclado e sons.',
      },
      {
        tag: 'table',
        en: 'Turns (E key), with untap and draw when your turn starts, or done for you automatically.',
        pt: 'Turnos (tecla E), com desvirar e comprar quando o seu turno começa, ou automático.',
      },
      {
        tag: 'table',
        en: 'End the game with a winner, and play again with the same decks.',
        pt: 'Encerre a partida com um vencedor e jogue de novo com os mesmos decks.',
      },
      {
        tag: 'table',
        en: 'Power/toughness and loyalty counters added automatically.',
        pt: 'Força/resistência e lealdade colocadas automaticamente.',
      },
      {
        tag: 'table',
        en: 'List of your active tables; tables close after 10 minutes without changes.',
        pt: 'Lista das suas mesas ativas; a mesa fecha depois de 10 minutos sem alteração.',
      },
      {
        tag: 'table',
        en: "Full card menu on any player's cards, and shake a card to get the table's attention.",
        pt: 'Menu completo nas cartas de qualquer jogador, e sacudir uma carta para chamar a atenção da mesa.',
      },
      {
        tag: 'table',
        en: 'Library menu: draw, mill, exile or play from the top or bottom, scry with reordering, reveal and scoop.',
        pt: 'Menu do grimório: comprar, moer, exilar ou jogar do topo ou do fundo, vidência com reordenar, revelar e recolher.',
      },
      {
        tag: 'table',
        en: 'Notes on cards, select several cards at once, equip when playing and a custom die.',
        pt: 'Notas nas cartas, selecionar várias cartas de uma vez, equipar ao jogar e dado personalizado.',
      },
      {
        tag: 'table',
        en: 'Table settings: card size, enlarged card, automatic turn, sounds and motion.',
        pt: 'Configurações da mesa: tamanho das cartas, carta ampliada, turno automático, sons e movimento.',
      },
      {
        tag: 'table',
        en: "Undo (Ctrl+Z) and go back to a moment of the game, with the other players' approval.",
        pt: 'Desfazer (Ctrl+Z) e voltar a um momento da partida, com a aprovação dos outros jogadores.',
      },
      {
        tag: 'speed',
        en: 'Faster table updates: only what changed is sent.',
        pt: 'Mesa mais rápida: só o que mudou é enviado.',
      },
      {
        tag: 'deal',
        en: 'Online rooms: each player can re-deal their own deck once per deal.',
        pt: 'Salas online: cada jogador pode resortear o próprio deck uma vez por sorteio.',
      },
    ],
  },
  {
    date: '2026-10-10',
    changes: [
      {
        tag: 'site',
        en: 'Site in English, with a Portuguese option.',
        pt: 'Site em inglês, com opção de português.',
      },
      {
        tag: 'site',
        en: "New look with the commander's art in the spotlight.",
        pt: 'Visual novo com a arte do comandante em destaque.',
      },
      {
        tag: 'deal',
        en: 'Estimated bracket for every deck, a bracket filter in the catalog and a bracket rule for the deal.',
        pt: 'Bracket estimado de cada deck, filtro por bracket no catálogo e regra de bracket no sorteio.',
      },
      {
        tag: 'deal',
        en: 'Deck analysis and a power level from 1 to 10.',
        pt: 'Análise do deck e nível de poder de 1 a 10.',
      },
      {
        tag: 'site',
        en: 'Admin panel to look after the site.',
        pt: 'Painel de administração para cuidar do site.',
      },
    ],
  },
  {
    date: '2026-10-09',
    changes: [
      {
        tag: 'deal',
        en: 'Winners, ranking, "My deals" and statistics for each deck.',
        pt: 'Vencedores, ranking, "Meus sorteios" e estatísticas de cada deck.',
      },
      {
        tag: 'deal',
        en: 'Room QR code, link preview image and an option to clear your history.',
        pt: 'QR Code da sala, imagem de prévia do link e opção de zerar o histórico.',
      },
      {
        tag: 'site',
        en: 'A notice while the server is waking up.',
        pt: 'Aviso enquanto o servidor está acordando.',
      },
      {
        tag: 'site',
        en: 'Donation page (Ko-fi).',
        pt: 'Página de doação (Ko-fi).',
      },
      {
        tag: 'speed',
        en: 'Faster site: retries, kept-alive connections, compression and pages loaded only when opened.',
        pt: 'Site mais rápido: novas tentativas, conexão mantida, compressão e páginas carregadas só quando abertas.',
      },
    ],
  },
  {
    date: '2026-10-08',
    changes: [
      {
        tag: 'deal',
        en: 'First version online: catalog of the official Commander precons with filters, a page for each deck with its card list, and a random deal of precons for 2 to 4 players.',
        pt: 'Primeira versão no ar: catálogo dos precons oficiais de Commander com filtros, página de cada deck com a lista de cartas e sorteio de precons para 2 a 4 jogadores.',
      },
    ],
  },
  {
    date: '2026-10-07',
    changes: [
      {
        tag: 'site',
        en: 'The project begins: importing the official Commander precons and their card images.',
        pt: 'Começo do projeto: importação dos precons oficiais de Commander e das imagens das cartas.',
      },
    ],
  },
]
