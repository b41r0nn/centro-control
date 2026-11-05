import { expect, test } from 'claude-code/testing'

const SHAPE = 'cc-1'

const PANE = {
  plugin: 'centro-control',
  component: 'Pane',
  requestId: 'centro-control',
  props: {
    title: 'Centro de control',
    isFocused: false,
    bodyColumns: 56,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 28 },
    view: {},
  },
} as const

test('el panel dibuja en todas las superficies', async ($, on) => {
  on('ui.open', () => ({ value: { isPlaced: true } }))

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect((await ui.find({ type: 'Text', text: /Contexto/ }))?.text).toContain('Contexto')
    expect(await ui.find({ type: 'Text', text: /sin agentes lanzados/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /nada peligroso visto/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /Mejorar prompt/ })).toBeDefined()
    // La cabecera y los encabezados de seccion llevan icono; en reposo nada se mueve.
    expect(await ui.find({ type: 'Text', text: /◆ Centro de control/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /◌ en reposo/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Actividad/ })).toBeDefined()
    await ui.unmount()
  }
})

test('una orden peligrosa deja una alerta en el panel', async ($, on) => {
  on('clock.now', () => ({ value: 1_700_000_000_000 }))
  on('tool.call', () => ({ result: {} }))
  on('ui.notify', () => ({ value: { isSent: false, reason: 'no-surface' } }))

  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: /Alertas/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /borrado recursivo forzado/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /rm -rf build/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /nada peligroso visto/ })).toBeUndefined()
  await ui.unmount()
})

test('una orden corriente no deja alerta', async ($, on) => {
  on('clock.now', () => ({ value: 1_700_000_000_000 }))
  on('tool.call', () => ({ result: {} }))

  await $.tool.call({ tool: 'Bash', command: 'npm test' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: /nada peligroso visto/ })).toBeDefined()
  await ui.unmount()
})

test('el panel muestra los porcentajes que midio el motor', async ($, on) => {
  const seed: Record<string, unknown> = {
    usage: {
      shape: SHAPE,
      value: {
        at: 1_700_000_000_000,
        ctxTokens: 82_000,
        ctxWindow: 200_000,
        ctxPercent: 41,
        limits: [
          { kind: 'five_hour', percentUsed: 18 },
          { kind: 'seven_day', percentUsed: 92 },
        ],
        costUsd: 0.4231,
      },
    },
    tokens: {
      shape: SHAPE,
      value: {
        dayKey: '2026-11-05',
        dayTokens: 1_240_000,
        weekKey: '2026-11-02',
        weekTokens: 7_800_000,
        sessionTokens: 240_000,
        turns: 12,
      },
    },
  }
  on('state.get', (_, e) => ({
    value: { value: seed[e.key], version: seed[e.key] === undefined ? 0 : 1 },
  }))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.find({ type: 'Text', text: /82k\/200k/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /41%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /92%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /hoy/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^1\.2M$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^7\.8M$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\$0\.4231/ })).toBeDefined()
  // La barra de 92% va en rojo y la de 18% en verde: la jerarquia de estados.
  expect(await ui.find({ type: 'Text', text: /█/ })).toBeDefined()
  await ui.unmount()
})

test('el mejorador reescribe el borrador y lo deja en la caja', async ($, on) => {
  let filled = ''
  on('clock.now', () => ({ value: 1_700_000_000_000 }))
  on('ui.status', () => ({ value: undefined }))
  on('prompt.read', () => ({ value: { text: 'arregla el login', cursor: 0 } }))
  on('model.complete', () => ({
    value: {
      isAnswered: true,
      text: 'Arregla el inicio de sesion: reproduce el fallo, corrige la causa y agrega una prueba.',
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
  }))
  on('prompt.fill', (_, e) => {
    filled = e.text

    return { isFilled: true, text: e.text, cursor: e.text.length }
  })

  const ran = await $.command.run({ command: 'mejora', args: '' })

  expect(filled).toContain('inicio de sesion')
  expect(ran.text).toContain('Prompt mejorado')
})
