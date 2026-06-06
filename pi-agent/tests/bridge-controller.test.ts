import { describe, expect, it } from 'vitest'

import { WechatBridgeController } from '../src/bridge-controller.js'

describe('wechat bridge controller', () => {
  it('dispatches normal text in default steer mode', () => {
    const controller = new WechatBridgeController<object>()

    const result = controller.handleIncoming({
      sourceMessage: {},
      userId: 'user-1',
      rawText: 'Keep replies concise.',
      prepared: {
        content: 'Keep replies concise.',
        fullText: 'Keep replies concise.',
        preview: 'Keep replies concise.',
        editable: true,
        sourceType: 'text',
      },
    })

    expect(result.type).toBe('dispatch')
    if (result.type === 'dispatch') {
      expect(result.mode).toBe('steer')
    }
    expect(controller.state.historyLog).toHaveLength(1)
    expect(controller.ledger.requests).toHaveLength(1)
  })

  it('switches to follow-up mode and keeps sending there', () => {
    const controller = new WechatBridgeController<object>()

    controller.handleIncoming({
      sourceMessage: {},
      userId: 'user-1',
      rawText: '/followup',
      prepared: {
        content: '/followup',
        fullText: '/followup',
        preview: '/followup',
        editable: true,
        sourceType: 'text',
      },
    })

    const result = controller.handleIncoming({
      sourceMessage: {},
      userId: 'user-1',
      rawText: 'Continue the rollout plan.',
      prepared: {
        content: 'Continue the rollout plan.',
        fullText: 'Continue the rollout plan.',
        preview: 'Continue the rollout plan.',
        editable: true,
        sourceType: 'text',
      },
    })

    expect(result.type).toBe('dispatch')
    if (result.type === 'dispatch') {
      expect(result.mode).toBe('followUp')
    }
    expect(controller.state.routeMode).toBe('followUp')
  })

  it('blocks freeform text while browsing history', () => {
    const controller = new WechatBridgeController<object>()

    controller.handleIncoming({
      sourceMessage: {},
      userId: 'user-1',
      rawText: '/history',
      prepared: {
        content: '/history',
        fullText: '/history',
        preview: '/history',
        editable: true,
        sourceType: 'text',
      },
    })

    const result = controller.handleIncoming({
      sourceMessage: {},
      userId: 'user-1',
      rawText: 'accidental text',
      prepared: {
        content: 'accidental text',
        fullText: 'accidental text',
        preview: 'accidental text',
        editable: true,
        sourceType: 'text',
      },
    })

    expect(result).toEqual({
      type: 'reply',
      text: '当前在 history 视图，请先 /open 某条历史，或用 /cancel 退出。',
    })
  })

  it('keeps history edit locked until cancel or replacement text arrives', () => {
    const controller = new WechatBridgeController<object>()

    controller.handleIncoming({
      sourceMessage: {},
      userId: 'user-1',
      rawText: '/followup',
      prepared: {
        content: '/followup',
        fullText: '/followup',
        preview: '/followup',
        editable: true,
        sourceType: 'text',
      },
    })

    controller.handleIncoming({
      sourceMessage: {},
      userId: 'user-1',
      rawText: 'Continue with deployment details.',
      prepared: {
        content: 'Continue with deployment details.',
        fullText: 'Continue with deployment details.',
        preview: 'Continue with deployment details.',
        editable: true,
        sourceType: 'text',
      },
    })

    controller.handleIncoming({
      sourceMessage: {},
      userId: 'user-1',
      rawText: '/open 1',
      prepared: {
        content: '/open 1',
        fullText: '/open 1',
        preview: '/open 1',
        editable: true,
        sourceType: 'text',
      },
    })

    const blocked = controller.handleIncoming({
      sourceMessage: {},
      userId: 'user-1',
      rawText: '/steer',
      prepared: {
        content: '/steer',
        fullText: '/steer',
        preview: '/steer',
        editable: true,
        sourceType: 'text',
      },
    })

    expect(blocked).toEqual({
      type: 'reply',
      text: '当前正在编辑历史项，请发送修订后的完整文本，或用 /cancel 退出。',
    })

    const result = controller.handleIncoming({
      sourceMessage: {},
      userId: 'user-1',
      rawText: 'Continue, but now emphasize rollout risks.',
      prepared: {
        content: 'Continue, but now emphasize rollout risks.',
        fullText: 'Continue, but now emphasize rollout risks.',
        preview: 'Continue, but now emphasize rollout risks.',
        editable: true,
        sourceType: 'text',
      },
    })

    expect(result.type).toBe('dispatch')
    if (result.type === 'dispatch') {
      expect(result.mode).toBe('followUp')
    }
    expect(controller.state.routeMode).toBe('followUp')
  })

  it('rejects a second user while the first one owns the bridge', () => {
    const controller = new WechatBridgeController<object>()

    controller.handleIncoming({
      sourceMessage: {},
      userId: 'user-1',
      rawText: 'First message',
      prepared: {
        content: 'First message',
        fullText: 'First message',
        preview: 'First message',
        editable: true,
        sourceType: 'text',
      },
    })

    const result = controller.handleIncoming({
      sourceMessage: {},
      userId: 'user-2',
      rawText: 'Second user message',
      prepared: {
        content: 'Second user message',
        fullText: 'Second user message',
        preview: 'Second user message',
        editable: true,
        sourceType: 'text',
      },
    })

    expect(result).toEqual({
      type: 'reply',
      text: '当前 WeChat 连接正由另一位用户使用，请先断开并重新连接。',
    })
  })
})
