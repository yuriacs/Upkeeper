// Baixa do Scryfall as imagens decorativas da página inicial (carrossel, fundo, passos, faixas,
// banner, login) e salva no próprio site, já otimizadas em WebP. Assim a capa não depende da API
// nem do Scryfall para aparecer. Gera também src/lib/homeArt.ts com a lista salva.
// Uso: node scripts/fetch-home-art.mjs   (rode de novo para trocar ou incluir comandantes)
import { mkdirSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'

// Comandantes de fantasia (sem crossovers). A ordem não importa: a capa sorteia.
const COMMANDERS = [
  'Lathliss, Dragon Queen',
  'Giada, Font of Hope',
  'Ashling, the Limitless',
  'Kardur, Doomscourge',
  'Sauron, Lord of the Rings',
  'Obuun, Mul Daya Ancestor',
  'Wilhelt, the Rotcleaver',
  'Ghalta, Primal Hunger',
  'Jace, Multiverse Architect',
  'Sefris of the Hidden Ways',
  'Jared Carthalion',
  'Firkraag, Cunning Instigator',
  'Aesi, Tyrant of Gyre Strait',
  'Atarka, World Render',
  'Galadriel, Elven-Queen',
  'Gisela, the Broken Blade',
  'Kalamax, the Stormsire',
  'Anowon, the Ruin Thief',
  'Sidar Jabari of Zhalfir',
  'Isperia, Supreme Judge',
  'Prosper, Tome-Bound',
  'Pantlaza, Sun-Favored',
  'Zhulodok, Void Gorger',
  'Kaust, Eyes of the Glade',
]

const OUT = 'public/img/cards'
mkdirSync(OUT, { recursive: true })

const slug = (name) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// O Scryfall pede um User-Agent e no máximo ~10 pedidos por segundo
const HEADERS = { 'User-Agent': 'Upkeeper/1.0 (home art)', Accept: 'application/json' }

async function download(url) {
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

const saved = []
for (const name of COMMANDERS) {
  try {
    const res = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`, { headers: HEADERS })
    if (!res.ok) throw new Error(`${res.status}`)
    const card = await res.json()
    const uris = card.image_uris ?? card.card_faces?.[0]?.image_uris
    if (!uris) throw new Error('sem imagem')
    const id = slug(name)
    await sleep(120)
    // Arte: até 800 px de largura (painel do login, banner, faixas, passos)
    await sharp(await download(uris.art_crop)).resize({ width: 800, withoutEnlargement: true }).webp({ quality: 76 }).toFile(`${OUT}/${id}-art.webp`)
    await sleep(120)
    // Carta inteira: 672 px (carrossel e fundo)
    await sharp(await download(uris.large)).resize({ width: 672, withoutEnlargement: true }).webp({ quality: 80 }).toFile(`${OUT}/${id}-card.webp`)
    saved.push({ name: card.name.split(' // ')[0], id })
    console.log('ok ', name)
    await sleep(120)
  } catch (err) {
    console.warn('erro', name, err.message)
  }
}

writeFileSync(
  'src/lib/homeArt.ts',
  `// Gerado por scripts/fetch-home-art.mjs — não edite à mão.
// Imagens decorativas da página inicial, salvas em public/img/cards (WebP, vindas do Scryfall).

export type HomeArt = { commander: string; art: string; card: string }

export const HOME_ART: HomeArt[] = ${JSON.stringify(
    saved.map(({ name, id }) => ({ commander: name, art: `/img/cards/${id}-art.webp`, card: `/img/cards/${id}-card.webp` })),
    null,
    2,
  ).replace(/"(\w+)":/g, '$1:')}
`,
)
console.log(`\n${saved.length}/${COMMANDERS.length} salvos em ${OUT}`)
