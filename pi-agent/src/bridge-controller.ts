import {
  applyCommand,
  createBridgeState,
  createHistoryEntry,
  getHistoryEntryByGlobalId,
  isEditableHistoryEntry,
  type BridgeState,
  type HistorySourceType,
  type RouteMode,
} from './bridge-state.js'
import {
  activateNextQueuedRequest,
  createRequestLedger,
  enqueueRequest,
  finishActiveRequest,
  getActiveRequest,
  getQueuedRequestCount,
  markActiveRequestReplying,
  setAssistantText,
  type RequestLedger,
  type RequestRecord,
} from './request-ledger.js'

export type PiContent = string | Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>

export interface PreparedWechatMessage {
  content: PiContent
  fullText: string
  preview: string
  editable: boolean
  sourceType: HistorySourceType
}

export interface IncomingWechatEnvelope<TSource> {
  sourceMessage: TSource
  userId: string
  rawText?: string
  prepared: PreparedWechatMessage
}

export type IncomingWechatResult<TSource> =
  | { type: 'reply'; text: string }
  | { type: 'dispatch'; mode: RouteMode; content: PiContent; request: RequestRecord<TSource> }

export class WechatBridgeController<TSource = unknown> {
  readonly state: BridgeState
  readonly ledger: RequestLedger<TSource>
  activeUserId: string | null

  constructor() {
    this.state = createBridgeState()
    this.ledger = createRequestLedger<TSource>()
    this.activeUserId = null
  }

  reset(): void {
    this.state.routeMode = 'steer'
    this.state.uiState = { type: 'idle' }
    this.state.historyLog.length = 0
    this.state.modeCounters.steer = 0
    this.state.modeCounters.followUp = 0
    this.ledger.requests.length = 0
    this.ledger.nextId = 1
    this.activeUserId = null
  }

  handleIncoming(envelope: IncomingWechatEnvelope<TSource>): IncomingWechatResult<TSource> {
    if (this.activeUserId && this.activeUserId !== envelope.userId) {
      return {
        type: 'reply',
        text: '当前 WeChat 连接正由另一位用户使用，请先断开并重新连接。',
      }
    }

    if (!this.activeUserId) {
      this.activeUserId = envelope.userId
    }

    const commandText = envelope.rawText?.trim()
    if (this.state.uiState.type === 'historyEdit' && commandText?.startsWith('/')) {
      if (commandText.toLowerCase() === '/cancel') {
        const result = applyCommand(this.state, commandText, this.getRequestCounts())
        return {
          type: 'reply',
          text: result.message,
        }
      }

      return {
        type: 'reply',
        text: '当前正在编辑历史项，请发送修订后的完整文本，或用 /cancel 退出。',
      }
    }

    if (commandText?.startsWith('/')) {
      const result = applyCommand(this.state, commandText, this.getRequestCounts())
      return {
        type: 'reply',
        text: result.message,
      }
    }

    if (this.state.uiState.type === 'historyView') {
      return {
        type: 'reply',
        text: '当前在 history 视图，请先 /open 某条历史，或用 /cancel 退出。',
      }
    }

    if (this.state.uiState.type === 'historyEdit') {
      if (!envelope.rawText?.trim() || envelope.prepared.sourceType !== 'text') {
        return {
          type: 'reply',
          text: '编辑态只接受文本修订。',
        }
      }

      const original = getHistoryEntryByGlobalId(this.state, this.state.uiState.globalId)
      if (!original) {
        this.state.uiState = { type: 'idle' }
        return {
          type: 'reply',
          text: '找不到正在编辑的历史项，已退出编辑态。',
        }
      }

      if (!isEditableHistoryEntry(original)) {
        this.state.uiState = { type: 'idle' }
        return {
          type: 'reply',
          text: '这条历史当前不可编辑，已退出编辑态。',
        }
      }

      this.state.routeMode = original.mode
      this.state.uiState = { type: 'idle' }
      return this.enqueueDispatch({
        sourceMessage: envelope.sourceMessage,
        userId: envelope.userId,
        mode: original.mode,
        prepared: {
          ...envelope.prepared,
          content: envelope.rawText,
          fullText: envelope.rawText,
          preview: envelope.rawText,
          editable: true,
          sourceType: 'text',
        },
      })
    }

    return this.enqueueDispatch({
      sourceMessage: envelope.sourceMessage,
      userId: envelope.userId,
      mode: this.state.routeMode,
      prepared: envelope.prepared,
    })
  }

  activateNextRequest(): RequestRecord<TSource> | undefined {
    return activateNextQueuedRequest(this.ledger)
  }

  getActiveRequest(): RequestRecord<TSource> | undefined {
    return getActiveRequest(this.ledger)
  }

  setActiveAssistantText(text: string): void {
    setAssistantText(this.ledger, text)
  }

  markActiveRequestReplying(): RequestRecord<TSource> | undefined {
    return markActiveRequestReplying(this.ledger)
  }

  finishActiveRequest(): RequestRecord<TSource> | undefined {
    return finishActiveRequest(this.ledger)
  }

  getRequestCounts(): { queued: number; active: number } {
    return {
      queued: getQueuedRequestCount(this.ledger),
      active: getActiveRequest(this.ledger) ? 1 : 0,
    }
  }

  private enqueueDispatch(input: {
    sourceMessage: TSource
    userId: string
    mode: RouteMode
    prepared: PreparedWechatMessage
  }): IncomingWechatResult<TSource> {
    const historyEntry = createHistoryEntry(this.state, input.mode, input.prepared.fullText, {
      preview: input.prepared.preview,
      editable: input.prepared.editable,
      sourceType: input.prepared.sourceType,
    })

    const request = enqueueRequest(this.ledger, {
      sourceUserId: input.userId,
      sourceMessage: input.sourceMessage,
      mode: input.mode,
      historyGlobalId: historyEntry.globalId,
      previewText: historyEntry.preview,
      fullText: historyEntry.fullText,
    })

    historyEntry.requestId = request.id

    return {
      type: 'dispatch',
      mode: input.mode,
      content: input.prepared.content,
      request,
    }
  }
}
