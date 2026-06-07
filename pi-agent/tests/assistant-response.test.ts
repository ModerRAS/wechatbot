import { describe, expect, it } from 'vitest'

import {
  extractAssistantText,
  extractAssistantTextFromMessages,
  shouldReplyOnTurnEnd,
} from '../src/assistant-response.js'

describe('assistant response helpers', () => {
  it('does not reply on turn_end for retryable error messages', () => {
    const message = {
      role: 'assistant',
      content: [],
      stopReason: 'error' as const,
      errorMessage: 'Error Code internal_server_error: http2: server sent GOAWAY',
    }

    expect(shouldReplyOnTurnEnd(message)).toBe(false)
    expect(extractAssistantText(message)).toBe('[Pi error] Error Code internal_server_error: http2: server sent GOAWAY')
  })

  it('prefers the last successful assistant message after an earlier error', () => {
    const messages = [
      {
        role: 'assistant',
        content: [],
        stopReason: 'error' as const,
        errorMessage: 'Error Code internal_server_error: http2: server sent GOAWAY',
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Final answer after retry.' }],
        stopReason: 'stop' as const,
      },
    ]

    expect(extractAssistantTextFromMessages(messages)).toBe('Final answer after retry.')
  })

  it('falls back to the final error text if no successful retry message exists', () => {
    const messages = [
      {
        role: 'assistant',
        content: [],
        stopReason: 'error' as const,
        errorMessage: 'Temporary upstream failure',
      },
    ]

    expect(extractAssistantTextFromMessages(messages)).toBe('[Pi error] Temporary upstream failure')
  })
})
