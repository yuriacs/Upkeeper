/*
 * Novidades do site, dia a dia (página /changelog). Escrito para quem joga, a partir dos commits:
 * a cada mudança que alguém percebe no site, acrescente um item no dia (o mais novo fica em cima).
 * Cada item tem o texto nos dois idiomas, porque a lista não passa pelo t() das traduções.
 */

export type ChangeTag = 'table' | 'deal' | 'site' | 'account' | 'privacy' | 'security' | 'speed' | 'fix'

export type Change = { tag: ChangeTag; en: string; pt: string }
export type ChangeDay = { date: string; changes: Change[] }

export const CHANGELOG: ChangeDay[] = [
  {
    date: '2026-10-22',
    changes: [
      {
        tag: 'table',
        en: 'Several cards selected: the right-click menu on one of them now acts on all of them (counters +1/−1, tap, invert, highlight, face down, other face, clone, symbols, note, give control, send to), and so do the card shortcuts (H, I, J, K, L, U). It all undoes in one step.',
        pt: 'Várias cartas selecionadas: o menu do botão direito numa delas agora vale para todas (marcadores +1/−1, virar, inverter, destacar, virar para baixo, outra face, clonar, símbolos, nota, dar o controle, enviar para), e os atalhos de carta também (H, I, J, K, L, U). Tudo se desfaz de uma vez.',
      },
      {
        tag: 'site',
        en: 'The deck page shows the price of each card (one copy, from Scryfall), in the list and on the images.',
        pt: 'A página do deck mostra o preço de cada carta (uma cópia, pelo Scryfall), na lista e nas imagens.',
      },
      {
        tag: 'table',
        en: 'At the table, a card hitting the battlefield (or a token being created) now makes a sound, like drawing and shuffling already did. The sound button in the left bar turns it off.',
        pt: 'Na mesa, carta entrando no campo (ou ficha criada) agora faz som, como já faziam comprar e embaralhar. O botão de som na barra da esquerda desliga.',
      },
      {
        tag: 'site',
        en: 'Page addresses are now in English (/table, /draw, /catalog, /my-pool, /history...). Old links, bookmarks and password e-mails keep working: they take you to the new address.',
        pt: 'Os endereços das páginas agora são em inglês (/table, /draw, /catalog, /my-pool, /history...). Links antigos, favoritos e e-mails de senha continuam funcionando: levam para o endereço novo. No menu, Meus sorteios virou Meu histórico.',
      },
      {
        tag: 'table',
        en: 'Replay your games: in My history, "Games to replay" opens a finished game on the table itself, exactly as you saw it while playing, action by action: the cards where they were, life, graveyard and exile, with the cards each action touched glowing. The replay controls sit in the table’s left bar (back and forward one action or one turn, play by itself, speed) and what happened takes the right side like the chat, turn after turn, scrolling down as the game goes. Jump to any turn from the list. Each action plays its sound as you go, including a card hitting the table. You can also download it as text. Only the players see it, for 6 months.',
        pt: 'Reveja suas partidas: em Meu histórico, "Partidas para rever" abre uma partida encerrada na própria mesa, do jeito que você via jogando, ação a ação: as cartas onde estavam, a vida, o cemitério e o exílio, com as cartas que cada ação mexeu brilhando. Os controles ficam na barra da esquerda da mesa (voltar e avançar uma ação ou um turno, tocar sozinho, velocidade) e o que aconteceu ocupa a lateral direita como o chat, turno após turno, rolando para baixo conforme a partida anda. Dá para pular para qualquer turno pela lista. Cada ação toca o seu som conforme avança, inclusive a carta batendo na mesa. Dá para baixar em texto também. Só quem jogou vê, por 6 meses.',
      },
    ],
  },
  {
    date: '2026-10-21',
    changes: [
      {
        tag: 'speed',
        en: 'Saving a deck is much faster: the cards are looked up all at once, and saving again only changes what you edited. Renaming a deck or changing categories no longer recalculates bracket and price.',
        pt: 'Salvar o deck ficou bem mais rápido: as cartas são buscadas de uma vez e salvar de novo só mexe no que você editou. Renomear o deck ou trocar categorias não recalcula mais o bracket e o preço.',
      },
      {
        tag: 'table',
        en: 'Closing the table now needs another player to confirm (just one is enough). Alone, or with everyone else offline, it closes right away; an idle table still closes by itself. The End game button moved to the left bar, next to the close button.',
        pt: 'Fechar a mesa agora pede a confirmação de outro jogador (basta um). Sozinho, ou com os outros desconectados, fecha na hora; mesa parada continua fechando sozinha. O botão Encerrar partida foi para a barra da esquerda, ao lado do botão de fechar.',
      },
      {
        tag: 'table',
        en: 'Smaller opponent boards (focus and same-size views): cards shrink in proportion to the board, so they no longer pile on top of each other.',
        pt: 'Campos pequenos dos oponentes (visões destaque e todos iguais): as cartas diminuem na proporção do campo e não ficam mais umas em cima das outras.',
      },
      {
        tag: 'table',
        en: 'New table view, like 1 vs 1: only one opponent at the top, the one whose turn it is. Click anywhere on a player’s card on the right to see another (this works in every view). Switch views with the layout button on the left.',
        pt: 'Nova visão da mesa, como um 1 contra 1: só um oponente em cima, o que está jogando. Clique em qualquer parte do card de um jogador à direita para ver outro (vale em todas as visões). Troque de visão pelo botão de layout à esquerda.',
      },
      {
        tag: 'account',
        en: 'Profile photo: before sending, adjust it. Drag to pick the part that shows and zoom in or out, with a preview of the circle used at the table.',
        pt: 'Foto de perfil: antes de enviar, ajuste a foto. Arraste para escolher a parte que aparece e aproxime ou afaste, vendo o círculo que fica na mesa.',
      },
      {
        tag: 'table',
        en: 'Turn timer: the table panel shows how long the current turn has been going, and the log says how long each turn took when it is passed.',
        pt: 'Tempo do turno: o painel da mesa mostra há quanto tempo o turno atual está rolando, e o registro diz quanto durou cada turno quando ele é passado.',
      },
      {
        tag: 'account',
        en: 'Hours played on your profile: the time of every game at the virtual table (from the first turn to the end, with 2 or more players with decks) adds up.',
        pt: 'Horas jogadas no perfil: o tempo de cada partida na mesa virtual (do primeiro turno até o fim, com 2 ou mais jogadores com deck) vai somando.',
      },
      {
        tag: 'account',
        en: 'Profile photo: in My account, upload a photo. It shows at the table in place of your seat icon and on your public profile. It is cropped square and its hidden data (like location) is removed.',
        pt: 'Foto de perfil: em Minha conta, envie uma foto. Ela aparece na mesa, no lugar do ícone da sua cadeira, e no seu perfil público. Ela é recortada em quadrado e os dados escondidos dela (como a localização) são apagados.',
      },
      {
        tag: 'deal',
        en: 'Deckbuilder: the power level and the bracket now update while you add cards, with the same details as the deck page (Game Changers, combos, ramp, draw…).',
        pt: 'Deckbuilder: o nível de poder e o bracket agora se atualizam enquanto você adiciona cartas, com os mesmos detalhes da página do deck (Game Changers, combos, ramp, compra…).',
      },
      {
        tag: 'fix',
        en: 'Brackets: double-faced cards (like Tergrid, God of Fright) now count. Before, a Game Changer with two faces did not push the deck to bracket 3. Decks that have one are recalculated.',
        pt: 'Brackets: cartas de duas faces (como Tergrid, God of Fright) agora contam. Antes, um Game Changer de duas faces não subia o deck para o bracket 3. Os decks que têm uma são recalculados.',
      },
      {
        tag: 'table',
        en: 'Hotkeys now work inside the graveyard, exile and library windows: hover a card and press R (hand), D (graveyard), S (exile), T/Y (top/bottom of library), P (face down) or Space (battlefield).',
        pt: 'Os atalhos agora funcionam dentro das janelas do cemitério, do exílio e do grimório: passe o mouse numa carta e aperte R (mão), D (cemitério), S (exílio), T/Y (topo/fundo do grimório), P (virada) ou Espaço (campo).',
      },
      {
        tag: 'fix',
        en: 'Cards no longer come in the Phyrexian-language printing (like Jace, the Perfected Mind from ONE), whose text cannot be read. Decks that already had one switch to the cheapest English printing.',
        pt: 'As cartas não vêm mais na edição em idioma phyrexiano (como Jace, the Perfected Mind de ONE), cujo texto não dá para ler. Os decks que já tinham uma passam para a edição em inglês mais barata.',
      },
    ],
  },
  {
    date: '2026-10-20',
    changes: [
      {
        tag: 'fix',
        en: 'Spectators: the board of the player you follow is no longer upside down (lands at the back, creatures in front, like the player sees it).',
        pt: 'Quem assiste: o campo do jogador que você segue não fica mais de cabeça para baixo (terrenos atrás e criaturas na frente, como o jogador vê).',
      },
      {
        tag: 'table',
        en: 'Custom token art, like on untap.in: in the token window, the image button on a token lets you upload a picture from your computer (or reuse one of your arts). That token then shows your art in every game, including tokens made by card shortcuts.',
        pt: 'Arte personalizada nas fichas, como no untap.in: na janela de fichas, o botão de imagem numa ficha deixa você enviar uma imagem do computador (ou reaproveitar uma das suas artes). Essa ficha passa a aparecer com a sua arte em toda partida, inclusive quando criada pelos atalhos de carta.',
      },
      {
        tag: 'deal',
        en: 'Custom card art now works on the commander too (button next to it in the deckbuilder).',
        pt: 'A arte personalizada agora vale também para o comandante (botão ao lado dele no deckbuilder).',
      },
    ],
  },
  {
    date: '2026-10-19',
    changes: [
      {
        tag: 'deal',
        en: 'Custom card art, like on untap.in: in the deckbuilder, upload an image from your computer for any card of a saved deck. It shows at the table and on the deck page for everyone.',
        pt: 'Artes personalizadas nas cartas, como no untap.in: no deckbuilder, envie uma imagem do computador para qualquer carta de um deck salvo. Ela aparece na mesa e na página do deck para todo mundo.',
      },
      {
        tag: 'deal',
        en: 'Deckbuilder: favorite cards. Star the cards you use the most (in the search, the suggestions or your deck) and find them in the new Favorites tab, with filters by name, type, function (ramp, card draw, removal…) and commander colors.',
        pt: 'Deckbuilder: cartas favoritas. Marque com a estrela as cartas que você mais usa (na busca, nas sugestões ou no deck) e ache tudo na nova aba Favoritas, com filtro por nome, tipo, função (ramp, compra, remoção…) e cores do comandante.',
      },
      {
        tag: 'account',
        en: 'My account: a new option lets your username show up in Upkeeper’s social media posts (weekly rankings and highlights). It is off by default.',
        pt: 'Minha conta: uma opção nova deixa seu nome de usuário aparecer nos posts do Upkeeper nas redes sociais (rankings da semana e destaques). Vem desligada.',
      },
    ],
  },
  {
    date: '2026-10-18',
    changes: [
      {
        tag: 'site',
        en: 'My history: the decks your opponents played are links now; open one to see the full list, the analysis and the export options.',
        pt: 'Meu histórico: os decks dos oponentes agora são links; abra um para ver a lista completa, a análise e as opções de exportar.',
      },
      {
        tag: 'fix',
        en: 'My history: games finished at open tables (without a deal) now show up in the list and count in your games, wins and best decks, as they already did in your profile.',
        pt: 'Meu histórico: as partidas terminadas em mesas abertas (sem sorteio) agora aparecem na lista e contam nas suas partidas, vitórias e melhores decks, como já contavam no perfil.',
      },
      {
        tag: 'account',
        en: 'Public profile for every player (open it from your name menu, the friends list or the ranking): games, wins, most played commanders, achievements and decks.',
        pt: 'Perfil público de cada jogador (abra pelo menu do seu nome, pela lista de amigos ou pelo ranking): partidas, vitórias, comandantes mais jogados, conquistas e decks.',
      },
      {
        tag: 'table',
        en: 'Friends: see who is online and at which table, and invite friends to your table; they get a notice anywhere on the site.',
        pt: 'Amigos: veja quem está online e em qual mesa, e convide amigos para a sua mesa; eles recebem um aviso em qualquer página do site.',
      },
      {
        tag: 'table',
        en: 'Table: the Chat tab lights up with the number of new messages when someone writes and you are on another tab.',
        pt: 'Mesa: a aba Chat acende com o número de mensagens novas quando alguém escreve e você está em outra aba.',
      },
      {
        tag: 'table',
        en: 'Table: spectators can now write in the chat. Their messages are marked as spectator and only show in the Chat tab, not in All.',
        pt: 'Mesa: quem está assistindo agora pode escrever no chat. As mensagens aparecem marcadas como de espectador e só na aba Chat, não no Tudo.',
      },
      {
        tag: 'deal',
        en: 'Deckbuilder: a Suggestions tab with cards that fit your commander, from EDHREC data: high synergy, most played and lists by type, with the synergy, how many decks play each card, its price and its role. Cards already in your deck are hidden.',
        pt: 'Deckbuilder: aba Sugestões com cartas que combinam com o seu comandante, pelos dados do EDHREC: alta sinergia, mais jogadas e listas por tipo, com a sinergia, em quantos decks cada carta aparece, o preço e a função. As cartas que já estão no deck não aparecem.',
      },
    ],
  },
  {
    date: '2026-10-17',
    changes: [
      {
        tag: 'fix',
        en: 'Deck values: the catalog and the lists now show the same value as the deck page, for precons and player decks.',
        pt: 'Valor dos decks: o catálogo e as listas agora mostram o mesmo valor da página do deck, nos precons e nos decks dos jogadores.',
      },
      {
        tag: 'deal',
        en: 'Deck values now use the cheapest printing of each card (in dollars and in euros), so a promo or special printing no longer inflates the price. The deckbuilder search also shows the cheapest printing.',
        pt: 'O valor dos decks agora usa a edição mais barata de cada carta (em dólar e em euro), então uma promo ou edição especial não infla mais o preço. A busca do deckbuilder também mostra a edição mais barata.',
      },
      {
        tag: 'site',
        en: 'New preview image when you share the site link, with the current look.',
        pt: 'Nova imagem de prévia ao compartilhar o link do site, com o visual atual.',
      },
      {
        tag: 'table',
        en: 'Table: back to the orange accent it had before (the rest of the site keeps the gold).',
        pt: 'Mesa: voltou ao laranja de antes nos destaques (o resto do site continua dourado).',
      },
      {
        tag: 'site',
        en: 'Deck cards (precons and player decks): the colored light that ran around the border on hover is gone.',
        pt: 'Cards de deck (precons e decks dos jogadores): saiu a luz colorida que girava na borda ao passar o mouse.',
      },
      {
        tag: 'fix',
        en: 'Top menu: My pool sits next to Play, Deal, Catalog and Ranking, and the rest of your account (My history, Friends, My account, Sign out) is in a menu under your name, so the bar fits and the logo no longer gets squeezed.',
        pt: 'Menu do topo: a Minha pool fica ao lado de Jogar, Sortear, Catálogo e Ranking, e o resto da conta (Meus sorteios, Amigos, Minha conta, Sair) fica num menu sob o seu nome, então a barra cabe e o logo não fica mais espremido.',
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
