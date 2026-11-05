/**
 * Contrato de estado del mod `centro-control`.
 *
 * Cada valor que el mod guarda en `$.state` queda declarado aqui, bajo el
 * nombre del mod, para que `claude plugin validate` lo pueda verificar.
 */

/** Una ventana de limite de uso tal como la reporta la ultima respuesta de la API. */
export type CtlLimit = {
  /** `five_hour`, `seven_day`, o `spend_limit` en un gateway. */
  kind: string
  /** Porcentaje usado de la ventana, 0 a 100 (puede pasar de 100 en un limite de gasto). */
  percentUsed: number
  /** Cuando se reinicia la ventana, en ISO 8601. */
  resetsAt?: string
}

/** Lo que el centro de control sabe del uso en vivo de la sesion. */
export type CtlUsage = {
  /** Cuando se tomo la medida, en ms desde epoch. */
  at: number
  /** Tokens de entrada de la ultima respuesta; null antes de la primera. */
  ctxTokens: number | null
  /** Ventana de contexto del modelo, en tokens. */
  ctxWindow: number
  /** `ctxTokens` sobre `ctxWindow` en porcentaje entero; null antes de la primera respuesta. */
  ctxPercent: number | null
  /** Las ventanas de limite que reporto la ultima respuesta; vacio sin suscripcion. */
  limits: CtlLimit[]
  /** Costo acumulado de la sesion en dolares; null donde el host no lleva cuenta. */
  costUsd: number | null
}

/** Contador propio de tokens, acumulado entre sesiones en `$.store`. */
export type CtlTokens = {
  /** Dia al que corresponde `dayTokens`, como `AAAA-MM-DD` local. */
  dayKey: string
  /** Tokens del dia (entrada + salida + cache). */
  dayTokens: number
  /** Lunes de la semana a la que corresponde `weekTokens`, como `AAAA-MM-DD`. */
  weekKey: string
  /** Tokens de la semana. */
  weekTokens: number
  /** Tokens de esta sesion. */
  sessionTokens: number
  /** Turnos contados. */
  turns: number
}

/** Un agente o tarea de la sesion, como lo ve el panel. */
export type CtlAgent = {
  /** Id del agente, el de `$.agent.list()`. */
  id: string
  /** Como lo direcciona SendMessage, cuando tiene nombre. */
  name: string
  /** Tipo con el que se lanzo (`Explore`, `general-purpose`, `teammate`). */
  type: string
  /** Donde esta su loop: pending, running, waiting, idle, completed, failed, killed. */
  status: string
  /** La descripcion corta de la tarea. */
  description: string
  /** Llamadas a herramientas que se le han contado en esta carga del mod. */
  tools: number
  /** Ultima herramienta que uso. */
  lastTool: string
  /** Cuando se le vio por primera vez, en ms. */
  startedAt: number
  /** Cuando termino, en ms; 0 mientras sigue. */
  endedAt: number
}

/** Lo que se esta haciendo ahora en el hilo principal. */
export type CtlActivity = {
  /** Si hay un turno en curso. */
  isRunning: boolean
  /** Id del turno en curso o del ultimo. */
  turnId: string
  /** Comienzo del prompt que arranco el turno. */
  prompt: string
  /** Cuando arranco el turno, en ms. */
  startedAt: number
  /** Cuando termino, en ms; 0 mientras corre. */
  endedAt: number
  /** Herramientas usadas en el turno. */
  tools: number
  /** Ultima herramienta usada. */
  lastTool: string
  /** Detalle corto de esa herramienta (comando, archivo). */
  lastDetail: string
  /** Cuando fue esa herramienta, en ms. */
  lastAt: number
}

/** Un cambio potencialmente peligroso que paso por el motor. */
export type CtlAlert = {
  /** Id de la llamada que la provoco. */
  id: string
  /** Cuando, en ms. */
  at: number
  /** Herramienta (`Bash`, `Write`, `Edit`). */
  tool: string
  /** Por que se marco, en una frase. */
  why: string
  /** El fragmento que la disparo, recortado. */
  detail: string
  /** Agente en cuyo loop paso; vacio en el hilo principal. */
  agentId: string
}

declare module 'claude-code' {
  interface PluginState {
    'centro-control': {
      usage: Shaped<CtlUsage | null>
      tokens: Shaped<CtlTokens>
      agents: Shaped<CtlAgent[]>
      activity: Shaped<CtlActivity>
      alerts: Shaped<CtlAlert[]>
      tick: Shaped<number>
    }
  }
}
