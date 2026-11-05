import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type {
  CtlActivity,
  CtlAgent,
  CtlAlert,
  CtlLimit,
  CtlTokens,
  CtlUsage,
} from '../types'

const PANE = 'centro-control'
const SHAPE = 'cc-1'
const STORE_TOKENS = 'tokens'

const EMPTY_TOKENS: CtlTokens = {
  dayKey: '',
  dayTokens: 0,
  weekKey: '',
  weekTokens: 0,
  sessionTokens: 0,
  turns: 0,
}

const EMPTY_ACTIVITY: CtlActivity = {
  isRunning: false,
  turnId: '',
  prompt: '',
  startedAt: 0,
  endedAt: 0,
  tools: 0,
  lastTool: '',
  lastDetail: '',
  lastAt: 0,
}

const usage = atom({ plugin: 'centro-control', key: 'usage' } as const, null, { shape: SHAPE })
const tokens = atom({ plugin: 'centro-control', key: 'tokens' } as const, EMPTY_TOKENS, { shape: SHAPE })
const agents = atom({ plugin: 'centro-control', key: 'agents' } as const, [], { shape: SHAPE })
const activity = atom({ plugin: 'centro-control', key: 'activity' } as const, EMPTY_ACTIVITY, { shape: SHAPE })
const alerts = atom({ plugin: 'centro-control', key: 'alerts' } as const, [], { shape: SHAPE })
const tick = atom({ plugin: 'centro-control', key: 'tick' } as const, 0, { shape: SHAPE })

// ---------------------------------------------------------------- peligros

/** Comandos de shell que merecen una alerta antes de que el usuario los vea pasar. */
const DANGER: { re: RegExp; why: string }[] = [
  { re: /\brm\s+(-\w+\s+)*-\w*r\w*f|\brm\s+(-\w+\s+)*-\w*f\w*r/i, why: 'borrado recursivo forzado' },
  { re: /\bRemove-Item\b[\s\S]*-Recurse/i, why: 'borrado recursivo (PowerShell)' },
  { re: /\bdel\s+\/[sqf]|\brd\s+\/s|\brmdir\s+\/s/i, why: 'borrado recursivo (cmd)' },
  { re: /\bgit\s+push\b[^\n]*(--force\b|--force-with-lease\b|\s-f\b)/i, why: 'push forzado' },
  { re: /\bgit\s+reset\s+--hard\b/i, why: 'reset --hard: descarta cambios' },
  { re: /\bgit\s+clean\s+-\w*[fd]/i, why: 'git clean: borra archivos no rastreados' },
  { re: /\bgit\s+checkout\s+--\s|\bgit\s+restore\b[^\n]*--worktree/i, why: 'descarta cambios locales' },
  { re: /\bgit\s+branch\s+-D\b|\bgit\s+push\b[^\n]*--delete/i, why: 'borra una rama' },
  { re: /\bgit\s+commit\b[^\n]*--no-verify|--no-gpg-sign/i, why: 'salta hooks o firma del commit' },
  { re: /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b|\bTRUNCATE\s+TABLE\b/i, why: 'DDL destructivo en base de datos' },
  { re: /\bDELETE\s+FROM\b(?![\s\S]*\bWHERE\b)/i, why: 'DELETE sin WHERE' },
  { re: /\bUPDATE\b[\s\S]*\bSET\b(?![\s\S]*\bWHERE\b)/i, why: 'UPDATE sin WHERE' },
  { re: /\bchmod\s+(-R\s+)?777\b|\bicacls\b[^\n]*\/grant[^\n]*Everyone/i, why: 'permisos abiertos a todos' },
  { re: /\b(curl|wget|iwr|Invoke-WebRequest)\b[^\n|]*\|\s*(sudo\s+)?(ba|z|fi)?sh\b/i, why: 'descarga canalizada a shell' },
  { re: /\bInvoke-Expression\b|\biex\s*\(/i, why: 'ejecuta texto descargado (iex)' },
  { re: /\bdd\s+if=|\bmkfs(\.\w+)?\b|\bformat\s+[a-z]:/i, why: 'escribe o formatea un dispositivo' },
  { re: /\bshutdown\b|\bRestart-Computer\b|\breboot\b/i, why: 'apaga o reinicia la maquina' },
  { re: /\bnpm\s+publish\b|\btwine\s+upload\b|\bcargo\s+publish\b|\bgem\s+push\b/i, why: 'publica un paquete' },
  { re: /\bdocker\s+(system\s+prune|volume\s+rm|rmi\s+-f)|\bdocker\s+compose\s+down\b[^\n]*-v/i, why: 'borra datos de Docker' },
  { re: /\bkubectl\s+delete\b|\bhelm\s+(uninstall|delete)\b/i, why: 'borra recursos en Kubernetes' },
  { re: /\bterraform\s+(destroy|apply)\b|\bpulumi\s+destroy\b/i, why: 'cambia o destruye infraestructura' },
  { re: /\b(aws|gcloud|az)\b[^\n]*\b(delete|destroy|terminate|rm)\b/i, why: 'borra recursos en la nube' },
  { re: /\b(Stop-Process\b[^\n]*-Force|kill\s+-9\b|taskkill\b[^\n]*\/f)/i, why: 'mata procesos a la fuerza' },
  { re: /\bsudo\b|\bStart-Process\b[^\n]*-Verb\s+RunAs/i, why: 'eleva privilegios' },
  { re: /\bgit\s+filter-branch\b|\bgit\s+rebase\b[^\n]*(-i|--interactive)/i, why: 'reescribe historia de git' },
  { re: /\bcrontab\b|\bschtasks\b[^\n]*\/create/i, why: 'programa una tarea del sistema' },
  { re: /\bnetsh\s+advfirewall|\bufw\s+(disable|allow)\b|\biptables\b/i, why: 'cambia el firewall' },
]

/** Rutas donde una escritura merece aviso. */
const SENSITIVE: { re: RegExp; why: string }[] = [
  { re: /(^|[\\/])\.env(\.|$)/i, why: 'escribe un archivo .env' },
  { re: /(^|[\\/])\.ssh[\\/]|id_rsa|id_ed25519|\.pem$|\.ppk$/i, why: 'escribe una llave o credencial' },
  { re: /(^|[\\/])\.aws[\\/]|credentials$|\.netrc$|\.npmrc$|\.pypirc$/i, why: 'escribe credenciales de un servicio' },
  { re: /(^|[\\/])\.git[\\/](config|HEAD|hooks[\\/])/i, why: 'escribe dentro de .git' },
  { re: /(^|[\\/])\.claude[\\/]settings(\.local)?\.json$|(^|[\\/])settings\.json$/i, why: 'cambia la configuracion de Claude Code' },
  { re: /(^|[\\/])(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Cargo\.lock)$/i, why: 'reescribe un lockfile' },
  { re: /^[A-Za-z]:[\\/](Windows|Program Files)[\\/]|^\/(etc|usr|bin|sbin|boot)\//i, why: 'escribe fuera del proyecto, en el sistema' },
]

const SYSTEM_IMPROVER = [
  'Eres un reescritor de prompts para Claude Code.',
  'Recibes el borrador que una persona escribio y devuelves una version mejor.',
  'Reglas: conserva la intencion y el idioma original; vuelvelo especifico y accionable;',
  'nombra entregables, archivos y criterios de aceptacion cuando se deduzcan del borrador;',
  'no inventes datos, rutas, versiones ni requisitos que el borrador no tenga;',
  'si falta informacion clave, deja una linea al final que empiece con "Falta definir:".',
  'Responde SOLO con el prompt mejorado, sin comillas, sin preambulo y sin explicaciones.',
].join(' ')

// ---------------------------------------------------------------- utilidades

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n))

const dayOf = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

const weekOf = (ms: number): string => {
  const d = new Date(ms)
  const back = (d.getDay() + 6) % 7
  return dayOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime())
}

const clock = (ms: number): string => {
  const d = new Date(ms)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

const resetsIn = (iso: string | undefined, now: number): string => {
  if (iso === undefined) return ''
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return ''
  const mins = Math.max(0, Math.round((at - now) / 60000))
  if (mins < 60) return `en ${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `en ${hours}h ${mins % 60}m (${clock(at)})`
  return `en ${Math.floor(hours / 24)}d ${hours % 24}h`
}

const num = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}k`
  return String(n)
}

const since = (from: number, now: number): string => {
  if (from <= 0) return '-'
  const s = Math.max(0, Math.round((now - from) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

/**
 * La paleta: claves del tema del motor, no colores crudos, para que el panel
 * siga el tema claro u oscuro de la persona y mantenga el contraste.
 * Acento principal, acento secundario, y los tres estados.
 */
const ACCENT = 'claude'
const ACCENT_2 = 'permission'
const MUTED = 'inactive'

/** Un solo conjunto de iconos: geometrias de ancho simple, del mismo trazo. */
const ICON: Record<string, string> = {
  pending: '○',
  running: '●',
  waiting: '◐',
  idle: '◌',
  completed: '✓',
  failed: '✗',
  killed: '✗',
}

const MARK = {
  head: '◆',
  section: '◆',
  row: '▸',
  alert: '▲',
  empty: '◌',
  ok: '✓',
  clear: '✗',
  copy: '▸',
  compact: '◇',
} as const

/** Cuatro cuadrantes: la animacion solo corre mientras hay trabajo en vuelo. */
const SPIN = ['◐', '◓', '◑', '◒'] as const

const spinner = (beat: number): string => SPIN[Math.floor(beat / 220) % SPIN.length] ?? SPIN[0]

/** Barra con cabezal: el ultimo bloque lleno va en medio tono, para dar avance. */
const bar = (percent: number | null, width: number): string => {
  if (percent === null) return '·'.repeat(width)
  const full = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))
  if (full === 0) return '░'.repeat(width)
  if (full >= width) return '█'.repeat(width)
  return `${'█'.repeat(full - 1)}▓${'░'.repeat(width - full)}`
}

const tone = (percent: number | null): 'success' | 'warning' | 'error' | 'inactive' => {
  if (percent === null) return MUTED
  if (percent >= 90) return 'error'
  if (percent >= 75) return 'warning'
  return 'success'
}

const statusTone = (status: string): string => {
  if (status === 'failed' || status === 'killed') return 'error'
  if (status === 'running') return 'success'
  if (status === 'waiting' || status === 'pending') return 'warning'
  if (status === 'completed') return ACCENT_2
  return MUTED
}

const isOver = (status: string): boolean =>
  status === 'completed' || status === 'failed' || status === 'killed'

const field = (e: unknown, key: string): string => {
  const value = (e as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : ''
}

const detailOf = (e: unknown): string => {
  for (const key of ['command', 'file_path', 'notebook_path', 'path', 'url', 'description', 'pattern', 'prompt']) {
    const value = field(e, key)
    if (value.length > 0) return value.replace(/\s+/g, ' ').trim()
  }
  return ''
}

const dangerOf = (tool: string, e: unknown): string => {
  const command = field(e, 'command')
  if (command.length > 0) {
    for (const one of DANGER) {
      if (one.re.test(command)) return one.why
    }
  }
  const writes = tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit'
  if (writes) {
    const path = field(e, 'file_path') || field(e, 'notebook_path') || field(e, 'path')
    if (path.length > 0) {
      for (const one of SENSITIVE) {
        if (one.re.test(path)) return one.why
      }
    }
  }
  return ''
}

const limitOf = (list: CtlLimit[], kind: string): CtlLimit | undefined =>
  list.find(one => one.kind === kind)

const statusText = (held: CtlUsage | null, counted: CtlTokens): string => {
  const parts: string[] = []
  if (held?.ctxPercent !== null && held?.ctxPercent !== undefined) {
    parts.push(`ctx ${held.ctxPercent}%`)
  }
  const five = held === null ? undefined : limitOf(held.limits, 'five_hour')
  const seven = held === null ? undefined : limitOf(held.limits, 'seven_day')
  if (five !== undefined) parts.push(`5h ${Math.round(five.percentUsed)}%`)
  if (seven !== undefined) parts.push(`7d ${Math.round(seven.percentUsed)}%`)
  if (counted.dayTokens > 0) parts.push(`hoy ${num(counted.dayTokens)}`)
  if (held?.costUsd !== null && held?.costUsd !== undefined && held.costUsd > 0) {
    parts.push(`$${held.costUsd.toFixed(2)}`)
  }
  return parts.length === 0 ? 'centro de control listo' : parts.join(' · ')
}

const summaryText = (
  held: CtlUsage | null,
  counted: CtlTokens,
  act: CtlActivity,
  list: CtlAgent[],
  warnings: CtlAlert[],
  now: number,
): string => {
  const lines: string[] = []
  lines.push(
    act.isRunning
      ? `En curso: ${since(act.startedAt, now)}, ${act.tools} herramientas, ultima ${act.lastTool || '-'}${act.lastDetail ? ` (${act.lastDetail.slice(0, 60)})` : ''}.`
      : act.turnId === ''
        ? 'Sin turnos todavia en esta sesion.'
        : `Ultimo turno: ${since(act.startedAt, act.endedAt || now)}, ${act.tools} herramientas.`,
  )
  if (act.prompt !== '') lines.push(`Pedido: ${act.prompt.slice(0, 160)}`)
  const live = list.filter(one => !isOver(one.status))
  if (list.length > 0) {
    lines.push(
      `Agentes: ${list.length - live.length}/${list.length} terminados${live.length > 0 ? `; activos ${live.map(one => `${one.name || one.type} (${one.status})`).join(', ')}` : ''}.`,
    )
  }
  if (held !== null) {
    const five = limitOf(held.limits, 'five_hour')
    const seven = limitOf(held.limits, 'seven_day')
    lines.push(
      `Contexto ${held.ctxPercent ?? '-'}% de ${num(held.ctxWindow)}; limite 5h ${five === undefined ? '-' : `${five.percentUsed}%`}, 7d ${seven === undefined ? '-' : `${seven.percentUsed}%`}.`,
    )
  }
  lines.push(
    `Tokens: hoy ${num(counted.dayTokens)}, semana ${num(counted.weekTokens)}, sesion ${num(counted.sessionTokens)} en ${counted.turns} turnos.`,
  )
  if (warnings.length > 0) {
    const last = warnings[warnings.length - 1]
    lines.push(`Alertas: ${warnings.length}; la ultima ${last === undefined ? '' : `${last.tool}: ${last.why}`}.`)
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------- memoria del modulo

const perAgent = new Map<string, { tools: number; lastTool: string; seenAt: number }>()
const warned = new Map<string, number>()
let agentsKey = ''
let isTicking = false
let isRunning = false
let hasLiveAgents = false
let beats = 0

const refreshStatus = async ($: EngineInterface): Promise<void> => {
  $.ui.status(statusText(await read($, usage), await read($, tokens)))
}

const restore = async ($: EngineInterface): Promise<void> => {
  const raw = (await $.store.get(STORE_TOKENS)) as Partial<CtlTokens> | undefined
  const now = await $.clock.now()
  const dayKey = dayOf(now)
  const weekKey = weekOf(now)
  await update($, tokens, held => ({
    dayKey,
    dayTokens: raw?.dayKey === dayKey ? Number(raw.dayTokens ?? 0) : 0,
    weekKey,
    weekTokens: raw?.weekKey === weekKey ? Number(raw.weekTokens ?? 0) : 0,
    sessionTokens: held.sessionTokens,
    turns: held.turns,
  }))
}

const addTokens = async ($: EngineInterface, spent: number): Promise<void> => {
  const now = await $.clock.now()
  const dayKey = dayOf(now)
  const weekKey = weekOf(now)
  const held = await update($, tokens, old => ({
    dayKey,
    dayTokens: (old.dayKey === dayKey ? old.dayTokens : 0) + spent,
    weekKey,
    weekTokens: (old.weekKey === weekKey ? old.weekTokens : 0) + spent,
    sessionTokens: old.sessionTokens + spent,
    turns: old.turns + 1,
  }))
  await $.store.set(STORE_TOKENS, {
    dayKey: held.dayKey,
    dayTokens: held.dayTokens,
    weekKey: held.weekKey,
    weekTokens: held.weekTokens,
  })
}

const warnOnLimits = async ($: EngineInterface, held: CtlUsage): Promise<void> => {
  for (const one of held.limits) {
    const step = one.percentUsed >= 95 ? 95 : one.percentUsed >= 85 ? 85 : one.percentUsed >= 75 ? 75 : 0
    if (step === 0) {
      warned.delete(one.kind)
      continue
    }
    if ((warned.get(one.kind) ?? 0) >= step) continue
    warned.set(one.kind, step)
    const name = one.kind === 'five_hour' ? 'limite de 5 horas' : one.kind === 'seven_day' ? 'limite de 7 dias' : one.kind
    const reset = resetsIn(one.resetsAt, held.at)
    $.ui.toast(`${name} al ${one.percentUsed}%${reset === '' ? '' : `, se reinicia ${reset}`}`)
    if (step >= 95) {
      void $.ui.notify(`${name} al ${one.percentUsed}%`, { title: 'Centro de control' })
    }
  }
  const ctx = held.ctxPercent
  if (ctx !== null && ctx >= 85) {
    const step = ctx >= 95 ? 95 : 85
    if ((warned.get('context') ?? 0) < step) {
      warned.set('context', step)
      $.ui.toast(`Ventana de contexto al ${ctx}%: considera /compact`)
    }
  } else {
    warned.delete('context')
  }
}

const pollAgents = async ($: EngineInterface): Promise<void> => {
  const now = await $.clock.now()
  const list = await $.agent.list()
  const rows: CtlAgent[] = list.map(one => {
    const seen = perAgent.get(one.id) ?? { tools: 0, lastTool: '', seenAt: now }
    if (!perAgent.has(one.id)) perAgent.set(one.id, seen)
    return {
      id: one.id,
      name: one.name ?? '',
      type: one.type,
      status: one.status,
      description: one.description,
      tools: seen.tools,
      lastTool: seen.lastTool,
      startedAt: seen.seenAt,
      endedAt: isOver(one.status) ? now : 0,
    }
  })
  hasLiveAgents = rows.some(one => !isOver(one.status))
  const key = rows.map(one => `${one.id}:${one.status}:${one.tools}:${one.lastTool}`).join('|')
  if (key !== agentsKey) {
    agentsKey = key
    await update($, agents, () => rows)
  }
}

/**
 * Un latido del panel: mueve el spinner y los cabezales mientras hay trabajo en
 * vuelo, y relee la lista de agentes cada once latidos (unos 2,4 s).
 *
 * Con la sesion quieta no escribe nada, asi que nada se redibuja ni se mueve.
 */
const beat = async ($: EngineInterface): Promise<void> => {
  beats += 1
  if (beats % 11 === 1) await pollAgents($)
  if (isRunning || hasLiveAgents) {
    const now = await $.clock.now()
    await update($, tick, () => now)
  }
}

const improve = async ($: EngineInterface): Promise<string> => {
  const box = await $.prompt.read()
  const draft = box.text.trim()
  if (draft.length === 0) return 'La caja del prompt esta vacia: escribe el borrador y vuelve a pedirlo.'
  $.ui.status('mejorando el prompt...')
  const answer = await $.model.complete({
    model: 'haiku',
    system: SYSTEM_IMPROVER,
    prompt: draft,
    maxTokens: 1500,
    effort: 'low',
    timeoutMs: 45000,
  })
  await refreshStatus($)
  if (!answer.isAnswered) return `No se pudo mejorar el prompt: ${answer.reason}.`
  const better = answer.text.trim()
  if (better.length === 0) return 'El modelo no devolvio texto.'
  const filled = await $.prompt.fill({ text: better, mode: 'replace' })
  if (!filled.isFilled) {
    return `No se pudo escribir en la caja${filled.refusal === undefined ? '' : ` (${filled.refusal})`}. El prompt mejorado:\n\n${better}`
  }
  return 'Prompt mejorado en la caja. Revisalo antes de enviarlo.'
}

// ---------------------------------------------------------------- hooks

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await restore($)
    await $.command.register({
      name: 'centro',
      description: 'Abre el panel del centro de control',
    })
    await $.command.register({
      name: 'mejora',
      description: 'Reescribe el borrador del prompt y lo deja en la caja',
    })
    await $.command.register({
      name: 'estado',
      description: 'Resumen de uso, agentes, actividad y alertas',
    })
    void $.ui.open({ id: PANE, title: 'Centro de control' })
    await refreshStatus($)
    if (!isTicking) {
      isTicking = true
      $.clock.every(220, () => {
        void beat($)
      })
    }

    return next(e)
  })

  on('command.run', { command: 'centro' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: 'Centro de control' })

    return {
      text: opened.isPlaced
        ? 'Panel del centro de control abierto.'
        : `El panel quedo abierto pero sin dibujar: ${opened.reason}`,
    }
  })

  on('command.run', { command: 'mejora' }, async $ => ({ text: await improve($) }))

  on('command.run', { command: 'estado' }, async $ => ({
    text: summaryText(
      await read($, usage),
      await read($, tokens),
      await read($, activity),
      await read($, agents),
      await read($, alerts),
      await $.clock.now(),
    ),
  }))

  on('session.measure', async ($, e, next) => {
    const held: CtlUsage = {
      at: await $.clock.now(),
      ctxTokens: e.context.tokens ?? null,
      ctxWindow: e.context.window,
      ctxPercent: e.context.percent ?? null,
      limits: e.rateLimits.map(one =>
        one.resetsAt === undefined
          ? { kind: one.kind, percentUsed: one.percentUsed }
          : { kind: one.kind, percentUsed: one.percentUsed, resetsAt: one.resetsAt },
      ),
      costUsd: e.cost?.usd ?? null,
    }
    await update($, usage, () => held)
    $.ui.status(statusText(held, await read($, tokens)))
    await warnOnLimits($, held)

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    isRunning = true
    const now = await $.clock.now()
    await update($, activity, () => ({
      isRunning: true,
      turnId: e.turnId,
      prompt: e.text.replace(/\s+/g, ' ').trim(),
      startedAt: now,
      endedAt: 0,
      tools: 0,
      lastTool: '',
      lastDetail: '',
      lastAt: now,
    }))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const spent =
      e.usage === undefined
        ? 0
        : e.usage.input_tokens +
          e.usage.output_tokens +
          e.usage.cache_read_input_tokens +
          e.usage.cache_creation_input_tokens
    if (spent > 0) await addTokens($, spent)
    if (e.agentId === undefined) {
      isRunning = false
      const now = await $.clock.now()
      await update($, activity, held => ({ ...held, isRunning: false, endedAt: now }))
      await refreshStatus($)
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const now = await $.clock.now()
    const detail = detailOf(e)
    const why = dangerOf(tool, e)

    if (e.agentId === undefined) {
      await update($, activity, held => ({
        ...held,
        tools: held.tools + 1,
        lastTool: tool,
        lastDetail: detail,
        lastAt: now,
      }))
    } else {
      const seen = perAgent.get(e.agentId) ?? { tools: 0, lastTool: '', seenAt: now }
      perAgent.set(e.agentId, { tools: seen.tools + 1, lastTool: tool, seenAt: seen.seenAt })
    }

    if (why !== '') {
      const alert: CtlAlert = {
        id: e.tool_use_id,
        at: now,
        tool,
        why,
        detail: detail.slice(0, 160),
        agentId: e.agentId ?? '',
      }
      await update($, alerts, list => [...list.filter(one => one.id !== alert.id), alert].slice(-40))
      $.ui.toast(`Ojo: ${why} — ${detail.slice(0, 70)}`)
      void $.ui.notify(`Cambio peligroso: ${why}`, { title: 'Centro de control' })
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const held = await read($, usage)
    const counted = await read($, tokens)
    const act = await read($, activity)
    const list = await read($, agents)
    const warnings = await read($, alerts)
    const beatAt = await read($, tick)
    const now = Math.max(beatAt, act.lastAt, act.endedAt, held?.at ?? 0)

    const room = Math.max(24, e.props.bodyColumns)
    const width = Math.max(8, Math.min(22, room - 26))
    const five = held === null ? undefined : limitOf(held.limits, 'five_hour')
    const seven = held === null ? undefined : limitOf(held.limits, 'seven_day')
    const others = held === null ? [] : held.limits.filter(one => one.kind !== 'five_hour' && one.kind !== 'seven_day')
    const live = list.filter(one => !isOver(one.status))
    const done = list.length - live.length
    const taskPercent = list.length === 0 ? null : Math.round((done / list.length) * 100)
    const rows = Math.max(6, (e.props.scroll.bodyRows || 24) - 2)
    const roomForAgents = Math.max(2, Math.min(live.length + 2, Math.floor(rows / 3)))
    const roomForAlerts = Math.max(1, Math.min(4, Math.floor(rows / 6)))
    const isBusy = act.isRunning || live.length > 0
    const pulse = spinner(beatAt)

    /** Un medidor: etiqueta, barra con cabezal, porcentaje en acento y la cola en dim. */
    const gauge = (name: string, label: string, percent: number | null, tail: string) => (
      <Box key={name} paddingLeft={1}>
        <Text dimColor>{label.padEnd(11)}</Text>
        <Text color={tone(percent)} hover={{ scope: name, bold: true }}>
          {bar(percent, width)}
        </Text>
        <Text color={tone(percent)} bold hover={{ scope: name, underline: true }}>
          {` ${percent === null ? '  -' : `${Math.round(percent)}`.padStart(3)}%`}
        </Text>
        {tail !== '' && <Text dimColor>{` ${tail}`}</Text>}
      </Box>
    )

    /** Un encabezado de seccion: icono en acento, titulo en negrita, nota en dim. */
    const head = (name: string, words: string, note: string) => (
      <Box key={name} marginTop={1}>
        <Text color={ACCENT}>{`${MARK.section} `}</Text>
        <Text bold>{words}</Text>
        {note !== '' && <Text dimColor>{`  ${note}`}</Text>}
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Box
          key="cabecera"
          borderStyle="round"
          borderColor={ACCENT}
          borderDimColor={!isBusy}
          paddingX={1}
          justifyContent="space-between"
        >
          <Text color={ACCENT} bold>{`${MARK.head} Centro de control`}</Text>
          <Text color={isBusy ? 'success' : MUTED}>
            {isBusy ? `${pulse} activo` : `${MARK.empty} en reposo`}
          </Text>
        </Box>

        {head('uso', 'Uso', '')}
        {gauge(
          'ctx',
          'Contexto',
          held?.ctxPercent ?? null,
          held === null || held.ctxTokens === null
            ? 'sin medir aun'
            : `${num(held.ctxTokens)}/${num(held.ctxWindow)}`,
        )}
        {gauge(
          'v5h',
          'Ventana 5h',
          five?.percentUsed ?? null,
          five === undefined ? 'sin lectura' : resetsIn(five.resetsAt, now),
        )}
        {gauge(
          'v7d',
          'Ventana 7d',
          seven?.percentUsed ?? null,
          seven === undefined ? 'sin lectura' : resetsIn(seven.resetsAt, now),
        )}
        {others.map(one =>
          gauge(`v-${one.kind}`, one.kind.slice(0, 11), one.percentUsed, resetsIn(one.resetsAt, now)),
        )}

        {head('tokens', 'Tokens', `${counted.turns} turnos`)}
        <Box key="tokens-fila" paddingLeft={1} flexWrap="wrap">
          <Text color={ACCENT_2}>{`${MARK.row} hoy `}</Text>
          <Text bold>{num(counted.dayTokens)}</Text>
          <Text color={ACCENT_2}>{`  ${MARK.row} semana `}</Text>
          <Text bold>{num(counted.weekTokens)}</Text>
          <Text color={ACCENT_2}>{`  ${MARK.row} sesion `}</Text>
          <Text bold>{num(counted.sessionTokens)}</Text>
        </Box>
        <Box key="costo-fila" paddingLeft={1}>
          <Text color={ACCENT_2}>{`${MARK.row} costo `}</Text>
          <Text bold>
            {held?.costUsd === null || held?.costUsd === undefined
              ? 'sin dato'
              : `$${held.costUsd.toFixed(4)}`}
          </Text>
        </Box>

        {head('actividad', 'Actividad', '')}
        <Box key="actividad-fila" paddingLeft={1}>
          <Text color={act.isRunning ? 'success' : MUTED} bold>
            {act.isRunning
              ? `${pulse} en curso `
              : act.turnId === ''
                ? `${MARK.empty} sin turnos todavia`
                : `${MARK.ok} ultimo turno `}
          </Text>
          {act.turnId !== '' && (
            <Text bold>{since(act.startedAt, act.isRunning ? now : act.endedAt || now)}</Text>
          )}
          {act.turnId !== '' && <Text dimColor>{` · ${act.tools} herramientas`}</Text>}
        </Box>
        {act.lastTool !== '' && (
          <Box key="ultima-herramienta" paddingLeft={2}>
            <Text color={ACCENT_2}>{`${MARK.row} `}</Text>
            <Text>{act.lastTool}</Text>
            <Text dimColor>{`: ${act.lastDetail.slice(0, Math.max(10, room - 12))}`}</Text>
          </Box>
        )}
        {act.prompt !== '' && (
          <Box key="pedido" paddingLeft={2}>
            <Text color={ACCENT_2}>{`${MARK.row} `}</Text>
            <Text italic dimColor>{`"${act.prompt.slice(0, Math.max(10, room - 12))}"`}</Text>
          </Box>
        )}

        {head('tareas', 'Tareas', `${done}/${list.length}`)}
        {gauge(
          'tareas-progreso',
          'Progreso',
          taskPercent,
          list.length === 0 ? 'nada lanzado' : `${live.length} activos`,
        )}
        {list.length === 0 && (
          <Box key="sin-agentes" paddingLeft={1}>
            <Text color={MUTED}>{`${MARK.empty} sin agentes lanzados`}</Text>
          </Box>
        )}
        {[...live, ...list.filter(one => isOver(one.status)).slice(-2)]
          .slice(0, roomForAgents)
          .map(one => (
            <Box key={one.id} paddingLeft={1}>
              <Text
                color={statusTone(one.status)}
                bold
                hover={{ scope: `agente-${one.id}`, underline: true }}
              >
                {`${ICON[one.status] ?? '·'} `}
              </Text>
              <Text hover={{ scope: `agente-${one.id}`, bold: true }}>
                {(one.name || one.type).slice(0, 14).padEnd(15)}
              </Text>
              <Text color={statusTone(one.status)} hover={{ scope: `agente-${one.id}`, bold: true }}>
                {one.status.padEnd(10)}
              </Text>
              <Text dimColor hover={{ scope: `agente-${one.id}`, dimColor: false }}>
                {`${one.tools > 0 ? `${one.tools}t ` : ''}${one.description.slice(0, Math.max(6, room - 36))}`}
              </Text>
            </Box>
          ))}

        {head('alertas', 'Alertas', warnings.length === 0 ? '' : `${warnings.length}`)}
        {warnings.length === 0 && (
          <Box key="sin-alertas" paddingLeft={1}>
            <Text color="success">{`${MARK.ok} nada peligroso visto`}</Text>
          </Box>
        )}
        {warnings.length > 0 && (
          <Box
            key="tarjeta-alertas"
            flexDirection="column"
            borderStyle="round"
            borderColor="warning"
            borderDimColor
            paddingX={1}
            marginLeft={1}
          >
            {warnings
              .slice(-roomForAlerts)
              .reverse()
              .map(one => (
                <Box key={one.id} flexDirection="column">
                  <Box>
                    <Text color="warning" bold hover={{ scope: `alerta-${one.id}`, underline: true }}>
                      {`${MARK.alert} `}
                    </Text>
                    <Text color="warning" bold>{one.tool}</Text>
                    <Text color="warning">{`: ${one.why}`}</Text>
                  </Box>
                  <Text dimColor hover={{ scope: `alerta-${one.id}`, dimColor: false }}>
                    {`  ${one.detail.slice(0, Math.max(10, room - 10))}`}
                  </Text>
                </Box>
              ))}
          </Box>
        )}

        <Box key="botones" marginTop={1} flexWrap="wrap" gap={1}>
          <Button
            key="mejorar"
            label={`${MARK.head} Mejorar prompt`}
            hotkey="m"
            variant="primary"
            hover={{ bold: true, underline: true }}
            onPress={() => {
              void improve($).then(said => $.ui.toast(said))
            }}
          />
          <Button
            key="copiar"
            label={`${MARK.copy} Copiar resumen`}
            hotkey="c"
            hover={{ bold: true, color: ACCENT_2 }}
            onPress={press => {
              void (async () => {
                const said = summaryText(
                  await read($, usage),
                  await read($, tokens),
                  await read($, activity),
                  await read($, agents),
                  await read($, alerts),
                  await $.clock.now(),
                )
                const copied = await $.ui.copy({ text: said, surface: press.surface })
                $.ui.toast(copied.isCopied ? 'Resumen copiado.' : `No se pudo copiar: ${copied.reason}`)
              })()
            }}
          />
          <Button
            key="limpiar"
            label={`${MARK.clear} Limpiar alertas`}
            hotkey="l"
            hover={{ bold: true, color: 'warning' }}
            onPress={() => {
              void update($, alerts, () => [])
            }}
          />
          {(held?.ctxPercent ?? 0) >= 70 && (
            <Button
              key="compactar"
              label={`${MARK.compact} Compactar`}
              hotkey="k"
              hover={{ bold: true, color: ACCENT }}
              onPress={() => {
                void $.session.compact().then(() => $.ui.toast('Conversacion compactada.'))
              }}
            />
          )}
        </Box>
      </Box>
    )
  })
}
