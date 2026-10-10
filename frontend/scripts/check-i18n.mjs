// Lista os textos usados com t('...') que ainda não têm tradução em português.
// Uso: node scripts/check-i18n.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const files = []
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(tsx?|ts)$/.test(f) && !p.includes('/i18n/') && !p.endsWith('i18n.ts')) files.push(p)
  }
}
walk('src')

const pt = {}
for (const f of readdirSync('src/i18n/pt')) {
  const src = readFileSync(join('src/i18n/pt', f), 'utf8')
  for (const m of src.matchAll(/^\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*:/gm)) pt[(m[1] ?? m[2]).replace(/\\(.)/g, '$1')] = 1
}

const missing = new Map()
const re = /\bt\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`([^`$]*)`)/g
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(re)) {
    const key = (m[1] ?? m[2] ?? m[3]).replace(/\\(.)/g, '$1')
    if (!(key in pt)) missing.set(key, f)
  }
}
for (const [k, f] of missing) console.log(`${f}: ${JSON.stringify(k)}`)
console.log(missing.size ? `\n${missing.size} sem tradução` : 'Tudo traduzido.')
process.exit(missing.size ? 1 : 0)
