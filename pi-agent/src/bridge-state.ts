export type RouteMode = 'steer' | 'followUp'

export type HistorySourceType = 'text' | 'image' | 'voice' | 'file' | 'video' | 'structured'

export type UIState =
  | { type: 'idle' }
  | { type: 'historyView' }
  | { type: 'historyEdit'; globalId: number; returnMode: RouteMode }

export interface HistoryEntry {
  globalId: number
  mode: RouteMode
  modeOrdinal: number
  fullText: string
  preview: string
  requestId?: string
  createdAt: number
  editable: boolean
  sourceType: HistorySourceType
}

export interface BridgeState {
  routeMode: RouteMode
  uiState: UIState
  historyLog: HistoryEntry[]
  modeCounters: Record<RouteMode, number>
}

export interface ApplyCommandResult {
  handled: boolean
  message: string
}

export interface CreateHistoryEntryOptions {
  createdAt?: number
  editable?: boolean
  preview?: string
  requestId?: string
  sourceType?: HistorySourceType
}

const PREVIEW_LIMIT = 60

export function createBridgeState(): BridgeState {
  return {
    routeMode: 'steer',
    uiState: { type: 'idle' },
    historyLog: [],
    modeCounters: {
      steer: 0,
      followUp: 0,
    },
  }
}

export function createHistoryEntry(
  state: BridgeState,
  mode: RouteMode,
  fullText: string,
  options: CreateHistoryEntryOptions = {},
): HistoryEntry {
  const modeOrdinal = state.modeCounters[mode] + 1
  state.modeCounters[mode] = modeOrdinal

  const entry: HistoryEntry = {
    globalId: state.historyLog.length + 1,
    mode,
    modeOrdinal,
    fullText,
    preview: options.preview ?? buildPreview(fullText),
    requestId: options.requestId,
    createdAt: options.createdAt ?? Date.now(),
    editable: options.editable ?? true,
    sourceType: options.sourceType ?? 'text',
  }

  state.historyLog.push(entry)
  return entry
}

export function getHistoryEntryByGlobalId(state: BridgeState, globalId: number): HistoryEntry | undefined {
  return state.historyLog.find((entry) => entry.globalId === globalId)
}

export function isEditableHistoryEntry(entry: HistoryEntry): boolean {
  return entry.editable && entry.sourceType === 'text'
}

export function getRouteLabel(mode: RouteMode, modeOrdinal: number): string {
  return `${mode === 'steer' ? 'S' : 'F'}#${modeOrdinal}`
}

export function renderHistory(state: BridgeState): string {
  if (state.historyLog.length === 0) {
    return '暂无历史记录。'
  }

  const lines = state.historyLog
    .slice()
    .reverse()
    .map((entry) => `${entry.globalId} [${getRouteLabel(entry.mode, entry.modeOrdinal)}] ${entry.preview}`)

  return ['历史记录：', ...lines].join('\n')
}

export function renderHelp(): string {
  return [
    '可用命令：',
    '/steer 切到 steer 模式',
    '/followup 切到 follow-up 模式',
    '/history 查看统一历史',
    '/open <id> 打开某条历史并等待修订',
    '/status 查看当前状态',
    '/cancel 退出 history / edit 辅助状态',
    '/help 查看帮助',
  ].join('\n')
}

export function renderStatus(state: BridgeState, requestCounts?: { queued: number; active: number }): string {
  const uiLabel = state.uiState.type === 'historyEdit'
    ? `historyEdit(#${state.uiState.globalId})`
    : state.uiState.type

  const queued = requestCounts?.queued ?? 0
  const active = requestCounts?.active ?? 0

  return [
    `当前模式：${state.routeMode === 'steer' ? 'steer' : 'follow-up'}`,
    `当前视图：${uiLabel}`,
    `历史数量：${state.historyLog.length}（S:${state.modeCounters.steer} / F:${state.modeCounters.followUp}）`,
    `请求状态：active ${active} / queued ${queued}`,
  ].join('\n')
}

export function applyCommand(
  state: BridgeState,
  rawInput: string,
  requestCounts?: { queued: number; active: number },
): ApplyCommandResult {
  const input = rawInput.trim()
  if (!input.startsWith('/')) {
    return {
      handled: false,
      message: '',
    }
  }

  const [rawCommand, ...args] = input.split(/\s+/)
  const command = rawCommand.toLowerCase()

  if (command === '/steer') {
    const already = state.routeMode === 'steer' && state.uiState.type === 'idle'
    state.routeMode = 'steer'
    state.uiState = { type: 'idle' }
    return {
      handled: true,
      message: already ? '当前已在 steer 模式。' : '已切换到 steer 模式。',
    }
  }

  if (command === '/followup') {
    const already = state.routeMode === 'followUp' && state.uiState.type === 'idle'
    state.routeMode = 'followUp'
    state.uiState = { type: 'idle' }
    return {
      handled: true,
      message: already ? '当前已在 follow-up 模式。' : '已切换到 follow-up 模式。',
    }
  }

  if (command === '/history') {
    state.uiState = { type: 'historyView' }
    return {
      handled: true,
      message: renderHistory(state),
    }
  }

  if (command === '/open') {
    const globalId = parsePositiveInt(args[0])
    if (globalId === undefined) {
      return {
        handled: true,
        message: '用法：/open <id>',
      }
    }

    const entry = getHistoryEntryByGlobalId(state, globalId)
    if (!entry) {
      return {
        handled: true,
        message: `未找到历史项 #${globalId}。`,
      }
    }

    if (!isEditableHistoryEntry(entry)) {
      state.uiState = { type: 'historyView' }
      return {
        handled: true,
        message: [
          `#${entry.globalId} [${getRouteLabel(entry.mode, entry.modeOrdinal)}]`,
          entry.fullText,
          '',
          '这条历史不是纯文本，当前版本只支持文本修订。',
        ].join('\n'),
      }
    }

    state.uiState = {
      type: 'historyEdit',
      globalId: entry.globalId,
      returnMode: state.routeMode,
    }
    return {
      handled: true,
      message: [
        `#${entry.globalId} [${getRouteLabel(entry.mode, entry.modeOrdinal)}]`,
        entry.fullText,
        '',
        '下一条文本将作为修订版重新发送；/cancel 可退出。',
      ].join('\n'),
    }
  }

  if (command === '/status') {
    return {
      handled: true,
      message: renderStatus(state, requestCounts),
    }
  }

  if (command === '/cancel') {
    if (state.uiState.type === 'historyEdit') {
      state.routeMode = state.uiState.returnMode
      state.uiState = { type: 'idle' }
      return {
        handled: true,
        message: '已取消当前编辑。',
      }
    }

    if (state.uiState.type === 'historyView') {
      state.uiState = { type: 'idle' }
      return {
        handled: true,
        message: '已退出 history 视图。',
      }
    }

    return {
      handled: true,
      message: '当前没有可取消的辅助状态。',
    }
  }

  if (command === '/help') {
    return {
      handled: true,
      message: renderHelp(),
    }
  }

  return {
    handled: true,
    message: `未知命令：${rawCommand}\n\n${renderHelp()}`,
  }
}

function buildPreview(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim() || '[empty]'
  if (normalized.length <= PREVIEW_LIMIT) return normalized
  return `${normalized.slice(0, PREVIEW_LIMIT - 1)}…`
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return parsed
}
