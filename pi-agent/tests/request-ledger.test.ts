import { describe, expect, it } from 'vitest'

import {
  activateNextQueuedRequest,
  appendAssistantText,
  createRequestLedger,
  enqueueRequest,
  finishActiveRequest,
  getActiveRequest,
} from '../src/request-ledger.js'

describe('request ledger', () => {
  it('tracks queued requests and activates them in order', () => {
    const ledger = createRequestLedger()

    const first = enqueueRequest(ledger, {
      sourceUserId: 'user-1',
      mode: 'steer',
      historyGlobalId: 1,
      previewText: 'Keep replies short',
      fullText: 'Keep replies short and direct.',
    })
    const second = enqueueRequest(ledger, {
      sourceUserId: 'user-1',
      mode: 'followUp',
      historyGlobalId: 2,
      previewText: 'Continue the plan',
      fullText: 'Continue the plan and include deployment steps.',
    })

    expect(first.status).toBe('queued')
    expect(second.status).toBe('queued')

    expect(activateNextQueuedRequest(ledger)?.id).toBe(first.id)
    expect(getActiveRequest(ledger)?.id).toBe(first.id)

    finishActiveRequest(ledger)
    expect(activateNextQueuedRequest(ledger)?.id).toBe(second.id)
    expect(getActiveRequest(ledger)?.id).toBe(second.id)
  })

  it('buffers assistant streaming text on the active request only', () => {
    const ledger = createRequestLedger()
    enqueueRequest(ledger, {
      sourceUserId: 'user-1',
      mode: 'followUp',
      historyGlobalId: 4,
      previewText: 'Continue from the last answer',
      fullText: 'Continue from the last answer and focus on testing.',
    })

    activateNextQueuedRequest(ledger)
    appendAssistantText(ledger, 'First chunk. ')
    appendAssistantText(ledger, 'Second chunk.')

    expect(getActiveRequest(ledger)?.assistantBuffer).toBe('First chunk. Second chunk.')
  })

  it('prioritizes queued steer requests ahead of follow-up requests', () => {
    const ledger = createRequestLedger()

    const firstFollowUp = enqueueRequest(ledger, {
      sourceUserId: 'user-1',
      mode: 'followUp',
      historyGlobalId: 10,
      previewText: 'Follow-up first',
      fullText: 'After this finishes, summarize the risks.',
    })
    const steer = enqueueRequest(ledger, {
      sourceUserId: 'user-1',
      mode: 'steer',
      historyGlobalId: 11,
      previewText: 'Steer second',
      fullText: 'Before that, focus on the failing test.',
    })

    expect(activateNextQueuedRequest(ledger)?.id).toBe(steer.id)

    finishActiveRequest(ledger)
    expect(activateNextQueuedRequest(ledger)?.id).toBe(firstFollowUp.id)
  })

  it('marks completed requests as done without deleting history', () => {
    const ledger = createRequestLedger()
    const request = enqueueRequest(ledger, {
      sourceUserId: 'user-1',
      mode: 'steer',
      historyGlobalId: 7,
      previewText: 'Prefer exact file names',
      fullText: 'Prefer exact file names and line references.',
    })

    activateNextQueuedRequest(ledger)
    finishActiveRequest(ledger)

    expect(request.status).toBe('done')
    expect(getActiveRequest(ledger)).toBeUndefined()
  })
})
