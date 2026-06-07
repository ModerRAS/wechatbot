export type AssistantStopReason = 'stop' | 'length' | 'toolUse' | 'error' | 'aborted'

export type AssistantMessageLike = {
  role: 'assistant'
  content: Array<{ type: string; text?: string }>
  stopReason?: AssistantStopReason
  errorMessage?: string
}

export function shouldReplyOnTurnEnd(message: unknown): boolean {
  const assistantMessage = getAssistantMessage(message)
  if (!assistantMessage) return false

  return assistantMessage.stopReason !== 'error' && assistantMessage.stopReason !== 'aborted'
}

export function extractAssistantText(message: unknown): string {
  const assistantMessage = getAssistantMessage(message)
  if (!assistantMessage) return ''

  let text = ''
  for (const block of assistantMessage.content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      text += block.text
    }
  }

  if (text.trim()) return text
  return buildAssistantFallbackText(assistantMessage)
}

export function extractAssistantTextFromMessages(messages: unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const text = extractAssistantText(messages[index])
    if (text) return text
  }
  return ''
}

export function getAssistantMessage(value: unknown): AssistantMessageLike | undefined {
  if (!isAssistantMessage(value)) return undefined
  return value
}

function buildAssistantFallbackText(message: AssistantMessageLike): string {
  if (message.stopReason === 'error') {
    const errorText = message.errorMessage?.trim()
    return errorText ? `[Pi error] ${errorText}` : '[Pi error]'
  }

  if (message.stopReason === 'aborted') {
    return '[Request aborted]'
  }

  return ''
}

function isAssistantMessage(value: unknown): value is AssistantMessageLike {
  if (!value || typeof value !== 'object') return false

  const maybeMessage = value as { role?: unknown; content?: unknown; stopReason?: unknown; errorMessage?: unknown }
  if (maybeMessage.role !== 'assistant') return false
  if (!Array.isArray(maybeMessage.content)) return false
  if (maybeMessage.stopReason !== undefined && typeof maybeMessage.stopReason !== 'string') return false
  if (maybeMessage.errorMessage !== undefined && typeof maybeMessage.errorMessage !== 'string') return false

  return maybeMessage.content.every((block) => {
    if (!block || typeof block !== 'object') return false
    const candidate = block as { type?: unknown; text?: unknown }
    if (typeof candidate.type !== 'string') return false
    if ('text' in candidate && candidate.text !== undefined && typeof candidate.text !== 'string') return false
    return true
  })
}
