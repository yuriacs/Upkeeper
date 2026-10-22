import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AtSign, Camera, Check, Copy, Download, ExternalLink, RotateCcw, Send, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AuthGate } from '../components/RequireAuth'
import { useTitle } from '../hooks/useTitle'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { CHANGELOG } from '../lib/changelog'
import { useI18n, useT } from '../lib/i18n'
import { renderSlide, slidePng, type Slide } from '../lib/socialCanvas'
import type { SocialCreator, SocialKind, SocialNetwork, SocialPost, SocialRequest, SocialStatus } from '../lib/types'

const X_LIMIT = 280
/** Marca do backend (social/curation.py) enquanto o repost sobe para o Instagram */
const PUBLISHING = 'publicando…'
/** Modelo de legenda quando o repost entra sem editor (IA): o post não sai enquanto ele estiver no texto */
const PLACEHOLDERS = ['✍️ Escreva aqui a legenda do post.', '✍️ Write the post caption here.']
const TAGS = { instagram: '#MTG #MagicTheGathering #Commander #EDH #MTGCommander #Upkeeper', x: '#MTG #Commander' }

/**
 * Painel das redes sociais (fase 1): gera rascunhos de post a partir dos dados do site, mostra as
 * imagens prontas (PNG), deixa editar o texto, aprovar, baixar e marcar como publicado. Publicar
 * nas redes ainda é à mão (copiar o texto e subir as imagens). Repost da curadoria
 * (backend/social/curation.py) mostra a mídia e, aprovado, sai sozinho pela API do Instagram;
 * os perfis monitorados e os pedidos de autorização ficam na seção de curadoria.
 */
export default function SocialPage() {
  const t = useT()
  useTitle(t('Social media'))
  const { user, ready } = useAuth()
  if (!ready) return null
  if (!user) return <AuthGate />
  if (!user.is_admin)
    return (
      <div className="space-y-3 py-10 text-center">
        <p className="text-parchment/70">{t('This page is only for the site’s admins.')}</p>
        <Link to="/" className="text-gold hover:underline">
          {t('Back to home')}
        </Link>
      </div>
    )
  return <Panel />
}

/** Post de novidades: o dia mais recente do changelog (lib/changelog.ts), no idioma escolhido */
function newsPost(network: SocialNetwork, lang: 'pt' | 'en'): Partial<SocialPost> {
  const day = CHANGELOG[0]
  const items = day.changes.map((c) => c[lang])
  const heading = lang === 'pt' ? 'Novidades no Upkeeper' : "What's new on Upkeeper"
  const slides: Slide[] = [{ t: 'news', kicker: day.date.split('-').reverse().join('/'), title: heading, items: items.slice(0, 5) }]
  if (network === 'x') {
    const first = `✨ ${heading}: ${items[0] ?? ''}`
    const room = X_LIMIT - TAGS.x.length - 3
    const text = `${first.length > room ? `${first.slice(0, room - 1).trimEnd()}…` : first}\n\n${TAGS.x}`
    return { network, kind: 'news', lang, text, slides }
  }
  const outro = lang === 'pt' ? 'Teste tudo no site: link na bio.' : 'Try it all on the site: link in bio.'
  const text = `✨ ${heading}!\n\n${items.map((i) => `• ${i}`).join('\n')}\n\n${outro}\n\n${TAGS.instagram}`
  return { network, kind: 'news', lang, text, slides }
}

function Panel() {
  const t = useT()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<SocialStatus | 'all'>('draft')
  const [kind, setKind] = useState<SocialKind>('ranking')
  const [network, setNetwork] = useState<SocialNetwork | 'both'>('both')
  const [lang, setLang] = useState<'pt' | 'en'>('pt')
  const feed = useQuery({ queryKey: ['social', 'feed'], queryFn: api.socialFeed })
  const posts = useQuery({
    queryKey: ['social', 'posts', tab],
    queryFn: () => api.socialPosts(tab === 'all' ? undefined : tab),
    refetchInterval: (q) => (q.state.data?.some((p) => p.error === PUBLISHING) ? 10_000 : false),
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['social', 'posts'] })
  const generate = useMutation({
    mutationFn: async () => {
      if (kind !== 'news') return api.generateSocialPosts(kind, network, lang)
      const nets: SocialNetwork[] = network === 'both' ? ['instagram', 'x'] : [network]
      return Promise.all(nets.map((n) => api.createSocialPost(newsPost(n, lang))))
    },
    onSuccess: () => {
      setTab('draft')
      refresh()
    },
  })
  const n = feed.data?.numbers
  const select = 'rounded-lg border border-line bg-ink px-2 py-1.5 text-sm'
  const tabs: [SocialStatus | 'all', string][] = [
    ['draft', t('Drafts')],
    ['approved', t('Approved')],
    ['published', t('Published')],
    ['all', t('All')],
  ]

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link to="/painel" className="text-sm text-parchment/50 hover:text-gold">
          ← {t('Admin')}
        </Link>
        <h1 className="font-display text-3xl text-parchment">{t('Social media')}</h1>
        <p className="text-sm text-parchment/60">
          {t('Drafts for Instagram and X made from the site’s data. Edit, approve, download the images and post by hand.')}
        </p>
      </div>

      {n && (
        <p className="text-sm text-parchment/70">
          {t('Last {d} days: {g} games, {p} players, {c} commanders.', { d: feed.data!.days, g: n.games, p: n.players, c: n.commanders })}{' '}
          {feed.data!.featured_precon && t('Precon of the day: {name}.', { name: feed.data!.featured_precon.name })}{' '}
          <span className="text-parchment/45">
            {t('{n} of this week’s players allow their name in posts.', { n: feed.data!.top_players.length })}
          </span>
        </p>
      )}

      <section className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface/60 p-3">
        <select value={kind} onChange={(e) => setKind(e.target.value as SocialKind)} className={select} aria-label={t('Post type')}>
          <option value="ranking">{t('Weekly ranking')}</option>
          <option value="precon">{t('Precon of the day')}</option>
          <option value="numbers">{t('The week in numbers')}</option>
          <option value="news">{t('What’s new (changelog)')}</option>
        </select>
        <select value={network} onChange={(e) => setNetwork(e.target.value as SocialNetwork | 'both')} className={select} aria-label={t('Network')}>
          <option value="both">Instagram + X</option>
          <option value="instagram">Instagram</option>
          <option value="x">X</option>
        </select>
        <select value={lang} onChange={(e) => setLang(e.target.value as 'pt' | 'en')} className={select} aria-label={t('Language')}>
          <option value="pt">Português</option>
          <option value="en">English</option>
        </select>
        <button
          onClick={() => generate.mutate()}
          disabled={generate.isPending}
          className="rounded-lg bg-gold px-4 py-1.5 text-sm font-semibold text-ink hover:brightness-110 disabled:opacity-50"
        >
          {generate.isPending ? t('Generating…') : t('Generate draft')}
        </button>
        {generate.isError && (
          <span className="text-sm text-red-400">
            {generate.error.message === 'nothing_to_post' ? t('Not enough data for this post yet.') : generate.error.message}
          </span>
        )}
      </section>

      <Curation
        onQueued={() => {
          setTab('draft')
          refresh()
        }}
      />

      <div className="flex gap-4 border-b border-line text-sm">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`pb-2 ${tab === key ? 'border-b-2 border-gold text-parchment' : 'text-parchment/50 hover:text-parchment'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {posts.isPending && <p className="text-parchment/50">{t('Loading…')}</p>}
      {posts.data?.length === 0 && <p className="text-parchment/50">{t('No posts here.')}</p>}
      <ul className="space-y-4">
        {posts.data?.map((p) => (
          <PostCard key={p.id} post={p} onChange={refresh} />
        ))}
      </ul>
    </div>
  )
}

/**
 * Curadoria do Instagram (backend/social/curation.py): perfis monitorados e os pedidos de
 * autorização. Só se reposta de perfil que autorizou; o pedido aceito vira repost na fila abaixo.
 */
function Curation({ onQueued }: { onQueued: () => void }) {
  const t = useT()
  const queryClient = useQueryClient()
  const [handles, setHandles] = useState('')
  const creators = useQuery({ queryKey: ['social', 'creators'], queryFn: api.socialCreators })
  const requests = useQuery({ queryKey: ['social', 'requests'], queryFn: api.socialRequests })
  const reload = () => queryClient.invalidateQueries({ queryKey: ['social', 'creators'] })
  const add = useMutation({
    mutationFn: () => api.addSocialCreators(handles),
    onSuccess: () => {
      setHandles('')
      reload()
    },
  })
  const update = useMutation({
    mutationFn: ({ id, ...data }: Partial<SocialCreator> & { id: number }) => api.updateSocialCreator(id, data),
    onSuccess: reload,
  })
  const remove = useMutation({ mutationFn: (id: number) => api.deleteSocialCreator(id), onSuccess: reload })
  const answer = useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'grant' | 'skip' }) => api.socialRequestAction(id, action),
    onSuccess: (_, { action }) => {
      queryClient.invalidateQueries({ queryKey: ['social', 'requests'] })
      if (action === 'grant') onQueued()
    },
  })
  const [link, setLink] = useState('')
  const repost = useMutation({
    mutationFn: () => api.repostSocialLink(link.trim()),
    onSuccess: () => {
      setLink('')
      onQueued()
    },
  })
  const box = 'space-y-3 rounded-lg border border-line bg-surface/60 p-4'
  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <div className={box}>
        <div>
          <h2 className="font-semibold text-parchment">{t('Monitored Instagram profiles')}</h2>
          <p className="text-xs text-parchment/55">
            {t('Reposts only come from profiles that allowed it; posts from the others become permission requests.')}
          </p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (handles.trim()) add.mutate()
          }}
          className="flex gap-2"
        >
          <input
            value={handles}
            onChange={(e) => setHandles(e.target.value)}
            placeholder="@perfil1, @perfil2"
            className="min-w-0 flex-1 rounded-lg border border-line bg-ink px-3 py-1.5 text-sm focus:border-gold focus:outline-none"
            aria-label={t('Profiles to add')}
          />
          <button
            disabled={add.isPending || !handles.trim()}
            className="rounded-lg bg-gold px-4 py-1.5 text-sm font-semibold text-ink hover:brightness-110 disabled:opacity-50"
          >
            {t('Add')}
          </button>
        </form>
        {add.isError && <p className="text-sm text-red-400">{t('Use Instagram usernames, separated by commas.')}</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (link.trim()) repost.mutate()
          }}
          className="flex gap-2"
        >
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://www.instagram.com/p/…"
            className="min-w-0 flex-1 rounded-lg border border-line bg-ink px-3 py-1.5 text-sm focus:border-gold focus:outline-none"
            aria-label={t('Post link to repost')}
          />
          <button
            disabled={repost.isPending || !link.trim()}
            className="rounded-lg border border-gold/60 px-4 py-1.5 text-sm font-semibold text-gold hover:bg-gold/10 disabled:opacity-50"
          >
            {repost.isPending ? t('Preparing…') : t('Repost')}
          </button>
        </form>
        <p className="text-xs text-parchment/50">
          {t('Paste a post from a profile that allowed reposts: the caption is written and the repost goes to Drafts.')}
        </p>
        {repost.isError && <p className="text-sm text-red-400">{repost.error.message}</p>}
        <ul className="divide-y divide-line text-sm">
          {creators.data?.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <a href={`https://www.instagram.com/${c.handle}/`} target="_blank" rel="noreferrer" className="font-medium hover:text-gold">
                @{c.handle}
              </a>
              {c.followers > 0 && (
                <span className="text-xs text-parchment/50">{t('{n} followers', { n: c.followers.toLocaleString() })}</span>
              )}
              <span className="ml-auto flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={c.active} onChange={(e) => update.mutate({ id: c.id, active: e.target.checked })} />
                  {t('Monitor')}
                </label>
                <label className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={c.authorized}
                    onChange={(e) => update.mutate({ id: c.id, authorized: e.target.checked })}
                  />
                  {t('Allowed reposts')}
                </label>
                <button
                  onClick={() => remove.mutate(c.id)}
                  className="text-parchment/50 hover:text-red-300"
                  aria-label={t('Remove @{handle}', { handle: c.handle })}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </span>
            </li>
          ))}
          {creators.data?.length === 0 && <li className="py-2 text-parchment/50">{t('No profiles yet.')}</li>}
        </ul>
      </div>

      <div className={box}>
        <div>
          <h2 className="font-semibold text-parchment">{t('Permission requests')}</h2>
          <p className="text-xs text-parchment/55">
            {t('Send the message by DM. When the author says yes, mark it as allowed and the repost goes to the queue.')}
          </p>
        </div>
        {requests.data?.length === 0 && <p className="text-sm text-parchment/50">{t('No pending requests.')}</p>}
        <ul className="space-y-3">
          {requests.data?.map((r) => (
            <RequestItem key={r.id} req={r} busy={answer.isPending} onAnswer={(action) => answer.mutate({ id: r.id, action })} />
          ))}
        </ul>
        {answer.isError && <p className="text-sm text-red-400">{answer.error.message}</p>}
      </div>
    </section>
  )
}

function RequestItem({ req, busy, onAnswer }: { req: SocialRequest; busy: boolean; onAnswer: (a: 'grant' | 'skip') => void }) {
  const { t, locale } = useI18n()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(req.permission_message)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* sem permissão de área de transferência */
    }
  }
  const btn = 'inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm hover:border-parchment/40 disabled:opacity-40'
  return (
    <li className="space-y-2 rounded-md border border-line p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <a href={req.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium hover:text-gold">
          @{req.handle}
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
        <span className="text-xs text-parchment/50">
          {t('{x}× the profile’s usual engagement', { x: req.outlier.toFixed(1) })} ·{' '}
          {new Date(req.posted_at).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })}
        </span>
      </div>
      {req.note && <p className="text-xs text-parchment/60">{req.note}</p>}
      <p className="whitespace-pre-line rounded bg-ink p-2 text-xs text-parchment/80">{req.permission_message}</p>
      <div className="flex flex-wrap gap-2">
        <button onClick={copy} className={btn}>
          <Copy className="h-4 w-4" aria-hidden />
          {copied ? t('Copied!') : t('Copy message')}
        </button>
        <button onClick={() => onAnswer('grant')} disabled={busy} className={`${btn} bg-gold font-semibold text-ink hover:brightness-110`}>
          <Check className="h-4 w-4" aria-hidden />
          {t('Author allowed')}
        </button>
        <button onClick={() => onAnswer('skip')} disabled={busy} className={btn}>
          <X className="h-4 w-4" aria-hidden />
          {t('Discard request')}
        </button>
      </div>
    </li>
  )
}

function SlidePreview({ slide, format }: { slide: Slide; format: SocialNetwork }) {
  const [src, setSrc] = useState<string | null>(null)
  const key = JSON.stringify(slide)
  useEffect(() => {
    let alive = true
    renderSlide(JSON.parse(key), format).then((c) => alive && setSrc(c.toDataURL('image/png')))
    return () => {
      alive = false
    }
  }, [key, format])
  return src ? (
    <img src={src} alt="" className={`rounded-md border border-line ${format === 'x' ? 'h-40' : 'h-56'} w-auto`} />
  ) : (
    <div className={`animate-pulse rounded-md bg-parchment/5 ${format === 'x' ? 'h-40 w-72' : 'h-56 w-44'}`} />
  )
}

function PostCard({ post, onChange }: { post: SocialPost; onChange: () => void }) {
  const { t, locale } = useI18n()
  const [text, setText] = useState(post.text)
  const [copied, setCopied] = useState(false)
  const update = useMutation({
    mutationFn: (data: Partial<SocialPost>) => api.updateSocialPost(post.id, data),
    onSuccess: onChange,
  })
  const remove = useMutation({ mutationFn: () => api.deleteSocialPost(post.id), onSuccess: onChange })
  const dirty = text !== post.text
  const publish = useMutation({
    mutationFn: () => api.publishSocialPost(post.id, dirty ? text : undefined),
    onSuccess: onChange,
  })
  const needsCaption = PLACEHOLDERS.some((p) => text.includes(p))
  // Post gerado com os dados do site: desenha as imagens aqui, sobe uma por vez e publica (carrossel se forem várias)
  const [sending, setSending] = useState('')
  const publishSite = useMutation({
    mutationFn: async () => {
      const urls: string[] = []
      for (const [i, s] of post.slides.entries()) {
        setSending(t('Sending image {n} of {total}…', { n: i + 1, total: post.slides.length }))
        const canvas = await renderSlide(s as Slide, 'instagram')
        const { url } = await api.uploadSocialImage(post.id, i, canvas.toDataURL('image/jpeg', 0.92))
        urls.push(url)
      }
      setSending(t('Publishing on Instagram… (videos take a few minutes)'))
      await api.publishSocialPost(post.id, dirty ? text : undefined, urls)
    },
    onSettled: () => setSending(''),
    onSuccess: onChange,
  })
  const canPublishSite =
    post.network === 'instagram' &&
    post.kind !== 'repost' &&
    post.slides.length > 0 &&
    ['draft', 'approved'].includes(post.status) &&
    post.error !== PUBLISHING
  const errorText = (e: Error) => (e.message === 'write_caption' ? t('Write the caption before publishing.') : e.message)
  const over = post.network === 'x' && text.length > X_LIMIT
  const Icon = post.network === 'x' ? AtSign : Camera
  const kindLabel: Record<string, string> = {
    ranking: t('Weekly ranking'),
    precon: t('Precon of the day'),
    numbers: t('The week in numbers'),
    news: t('What’s new (changelog)'),
    repost: t('Repost (curation)'),
    custom: t('Custom'),
  }
  const download = async () => {
    for (const [i, s] of post.slides.entries()) {
      const blob = await slidePng(s as Slide, post.network)
      if (!blob) continue
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `upkeeper-${post.network}-${post.id}-${i + 1}.png`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    }
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* sem permissão de área de transferência */
    }
  }
  const btn = 'inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm hover:border-parchment/40 disabled:opacity-40'
  return (
    <li className="space-y-3 rounded-lg border border-line bg-surface/60 p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Icon className="h-4 w-4 text-gold" aria-hidden />
        <span className="font-semibold">{post.network === 'x' ? 'X' : 'Instagram'}</span>
        <span className="text-parchment/50">
          · {kindLabel[post.kind] ?? post.kind} · {post.lang.toUpperCase()} ·{' '}
          {new Date(post.created_at).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })}
        </span>
        <span className="ml-auto rounded-full border border-line px-2 py-0.5 text-xs text-parchment/70">
          {({ draft: t('Draft'), approved: t('Approved'), published: t('Published'), error: t('Error') } as Record<string, string>)[post.status]}
        </span>
      </div>
      {post.media_url && (
        <div className="flex flex-wrap items-end gap-3">
          {post.media_type === 'video' ? (
            <video src={post.media_url} controls className="max-h-80 rounded-lg border border-line" />
          ) : (
            <img src={post.media_url} alt="" className="max-h-80 rounded-lg border border-line" />
          )}
          {post.source_url && (
            <a href={post.source_url} target="_blank" rel="noreferrer" className="text-sm text-gold hover:underline">
              {t('Original post by @{handle}', { handle: post.source_handle })}
            </a>
          )}
        </div>
      )}
      {post.source_caption && (
        <details className="text-sm">
          <summary className="cursor-pointer text-parchment/60 hover:text-parchment">{t('Original caption (for reference)')}</summary>
          <p className="mt-1 whitespace-pre-line rounded bg-ink p-2 text-xs text-parchment/70">{post.source_caption}</p>
        </details>
      )}
      {needsCaption && <p className="text-sm text-gold">{t('Replace the ✍️ line with your caption before publishing.')}</p>}
      {post.error === PUBLISHING ? (
        <p className="text-sm text-gold">{t('Publishing on Instagram… (videos take a few minutes)')}</p>
      ) : (
        post.error && <p className="text-sm text-red-400">{post.error}</p>
      )}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {post.slides.map((s, i) => (
          <SlidePreview key={i} slide={s as Slide} format={post.network} />
        ))}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={post.network === 'x' ? 4 : 8}
        className="w-full rounded-lg border border-line bg-ink p-3 text-sm focus:border-gold focus:outline-none"
        aria-label={t('Post text')}
      />
      <div className="flex flex-wrap items-center gap-2">
        {post.network === 'x' && (
          <span className={`text-xs tabular-nums ${over ? 'text-red-400' : 'text-parchment/50'}`}>
            {text.length}/{X_LIMIT}
          </span>
        )}
        {dirty && (
          <button onClick={() => update.mutate({ text })} disabled={update.isPending} className={`${btn} border-gold/60 text-gold`}>
            <Check className="h-4 w-4" aria-hidden />
            {t('Save text')}
          </button>
        )}
        <button onClick={copy} className={btn}>
          <Copy className="h-4 w-4" aria-hidden />
          {copied ? t('Copied!') : t('Copy text')}
        </button>
        <button onClick={download} className={btn} disabled={!post.slides.length}>
          <Download className="h-4 w-4" aria-hidden />
          {t('Download images')}
        </button>
        <span className="ml-auto flex flex-wrap gap-2">
          {post.status === 'draft' && (
            <button
              onClick={() => update.mutate({ status: 'approved', ...(dirty ? { text } : {}) })}
              disabled={over || needsCaption}
              className={`${btn} bg-gold font-semibold text-ink hover:brightness-110`}
            >
              <Check className="h-4 w-4" aria-hidden />
              {t('Approve')}
            </button>
          )}
          {post.status === 'approved' && post.kind === 'repost' && post.error !== PUBLISHING && (
            <span className="self-center text-xs text-parchment/60">{t('Goes out automatically at the next scheduled time')}</span>
          )}
          {post.kind === 'repost' && ['draft', 'approved'].includes(post.status) && post.error !== PUBLISHING && (
            <>
              <button
                onClick={() => publish.mutate()}
                disabled={publish.isPending || needsCaption || !text.trim()}
                className={`${btn} bg-gold font-semibold text-ink hover:brightness-110`}
              >
                <Send className="h-4 w-4" aria-hidden />
                {t('Publish now')}
              </button>
            </>
          )}
          {canPublishSite && (
            <button
              onClick={() => publishSite.mutate()}
              disabled={publishSite.isPending || !text.trim()}
              className={`${btn} bg-gold font-semibold text-ink hover:brightness-110`}
            >
              <Send className="h-4 w-4" aria-hidden />
              {sending || t('Publish on Instagram')}
            </button>
          )}
          {post.status === 'approved' && post.kind !== 'repost' && (
            <button onClick={() => update.mutate({ status: 'published' })} className={btn}>
              <Send className="h-4 w-4" aria-hidden />
              {t('Mark as posted')}
            </button>
          )}
          {post.status !== 'draft' && (
            <button onClick={() => update.mutate({ status: 'draft' })} className={btn}>
              <RotateCcw className="h-4 w-4" aria-hidden />
              {t('Back to draft')}
            </button>
          )}
          <button onClick={() => remove.mutate()} className={`${btn} hover:text-red-300`} aria-label={t('Delete')}>
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        </span>
      </div>
      {update.isError && <p className="text-sm text-red-400">{errorText(update.error)}</p>}
      {publish.isError && <p className="text-sm text-red-400">{errorText(publish.error)}</p>}
      {publishSite.isError && <p className="text-sm text-red-400">{errorText(publishSite.error)}</p>}
    </li>
  )
}
