import type { RouteMode } from './bridge-state.js'

export type RequestStatus = 'queued' | 'active' | 'replying' | 'done'

export interface RequestRecord<TSource = unknown> {
  id: string
  sourceUserId: string
  sourceMessage?: TSource
  mode: RouteMode
  historyGlobalId: number
  previewText: string
  fullText: string
  status: RequestStatus
  assistantBuffer: string
  createdAt: number
}

export interface RequestLedger<TSource = unknown> {
  nextId: number
  requests: Array<RequestRecord<TSource>>
}

export interface EnqueueRequestInput<TSource = unknown> {
  sourceUserId: string
  sourceMessage?: TSource
  mode: RouteMode
  historyGlobalId: number
  previewText: string
  fullText: string
  createdAt?: number
}

export function createRequestLedger<TSource = unknown>(): RequestLedger<TSource> {
  return {
    nextId: 1,
    requests: [],
  }
}

export function enqueueRequest<TSource>(
  ledger: RequestLedger<TSource>,
  input: EnqueueRequestInput<TSource>,
): RequestRecord<TSource> {
  const request: RequestRecord<TSource> = {
    id: `req-${ledger.nextId++}`,
    sourceUserId: input.sourceUserId,
    sourceMessage: input.sourceMessage,
    mode: input.mode,
    historyGlobalId: input.historyGlobalId,
    previewText: input.previewText,
    fullText: input.fullText,
    status: 'queued',
    assistantBuffer: '',
    createdAt: input.createdAt ?? Date.now(),
  }

  ledger.requests.push(request)
  return request
}

export function getActiveRequest<TSource>(ledger: RequestLedger<TSource>): RequestRecord<TSource> | undefined {
  return ledger.requests.find((request) => request.status === 'active')
}

export function getQueuedRequestCount<TSource>(ledger: RequestLedger<TSource>): number {
  return ledger.requests.filter((request) => request.status === 'queued').length
}

export function activateNextQueuedRequest<TSource>(ledger: RequestLedger<TSource>): RequestRecord<TSource> | undefined {
  const active = getActiveRequest(ledger)
  if (active) return active

  const queued = ledger.requests.find((request) => request.status === 'queued' && request.mode === 'steer')
    ?? ledger.requests.find((request) => request.status === 'queued')
  if (!queued) return undefined

  queued.status = 'active'
  return queued
}

export function appendAssistantText<TSource>(ledger: RequestLedger<TSource>, text: string): void {
  const active = getActiveRequest(ledger)
  if (!active) return
  active.assistantBuffer += text
}

export function setAssistantText<TSource>(ledger: RequestLedger<TSource>, text: string): void {
  const active = getActiveRequest(ledger)
  if (!active) return
  active.assistantBuffer = text
}

export function markActiveRequestReplying<TSource>(ledger: RequestLedger<TSource>): RequestRecord<TSource> | undefined {
  const active = getActiveRequest(ledger)
  if (!active) return undefined
  active.status = 'replying'
  return active
}

export function finishActiveRequest<TSource>(ledger: RequestLedger<TSource>): RequestRecord<TSource> | undefined {
  const active = ledger.requests.find((request) => request.status === 'active' || request.status === 'replying')
  if (!active) return undefined
  active.status = 'done'
  return active
}
