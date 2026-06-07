/**
 * Pi Extension: WeChat Bridge
 *
 * Type /wechat in pi -> QR code appears -> scan with WeChat ->
 * WeChat messages become pi prompts -> pi responses sent back to WeChat.
 *
 * Supports:
 *   - Two sticky control modes: steer and follow-up
 *   - Unified command history across both modes
 *   - History re-open + resend for text prompts
 *   - Image messages (receive -> send to pi as vision)
 *   - File messages (text files -> include content, others -> describe)
 *   - Video messages (download -> save to temp -> tell pi the path)
 *   - Voice messages (transcribed text or SILK->WAV download)
 *   - Markdown stripping (pi responses -> plain text for WeChat)
 *   - Media auto-routing (image/video/file by MIME type)
 *
 * Uses @wechatbot/wechatbot SDK for iLink protocol.
 * Uses qrcode-terminal for QR display.
 */

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import {
  WeChatBot,
  stripMarkdown,
  type IncomingMessage,
} from '@wechatbot/wechatbot'
import qrTerminal from 'qrcode-terminal'
import { readFile, writeFile, mkdtemp } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  WechatBridgeController,
  type PiContent,
  type PreparedWechatMessage,
} from './bridge-controller.js'
import type { HistorySourceType, RouteMode } from './bridge-state.js'

export default function wechatBridge(pi: ExtensionAPI) {
  let bot: WeChatBot | null = null
  let connected = false
  const controller = new WechatBridgeController<IncomingMessage>()

  pi.on('before_agent_start', async (event) => {
    if (!connected || !bot) return

    const activeRequest = controller.getActiveRequest() ?? controller.activateNextRequest()
    if (!activeRequest) return

    return {
      systemPrompt: buildWechatSystemPrompt(event.systemPrompt, activeRequest.mode),
    }
  })

  pi.on('turn_start', async () => {
    if (!connected || !bot) return
    controller.activateNextRequest()
  })

  pi.on('message_update', async (event) => {
    if (event.message.role !== 'assistant') return

    const text = extractAssistantText(event.message)
    if (!text) return
    controller.setActiveAssistantText(text)
  })

  pi.on('turn_end', async (event, ctx) => {
    if (!bot || !connected) return
    if (event.toolResults.length > 0) return

    if (!shouldReplyOnTurnEnd(event.message)) {
      const pendingRequest = controller.getActiveRequest()
      if (pendingRequest) {
        ctx.ui.setStatus('wechat', `⏳ Waiting for final Pi result [${pendingRequest.mode === 'steer' ? 'S' : 'F'}] ${pendingRequest.previewText}`)
      }
      return
    }

    const request = controller.markActiveRequestReplying()
    if (!request?.sourceMessage) return

    const finalText = extractAssistantText(event.message) || request.assistantBuffer || '[No response]'

    try {
      await bot.stopTyping(request.sourceUserId)
      await replyWithMediaAwareContent(bot, request.sourceMessage, finalText)
      ctx.ui.setStatus('wechat', `✓ Replied [${request.mode === 'steer' ? 'S' : 'F'}] ${request.previewText}`)
    } catch (error) {
      ctx.ui.setStatus('wechat', `✗ Reply failed: ${error instanceof Error ? error.message : error}`)
    } finally {
      controller.finishActiveRequest()
    }
  })

  pi.on('agent_end', async (event, ctx) => {
    if (!bot || !connected) return

    const request = controller.getActiveRequest()
    if (!request?.sourceMessage) return

    const finalText = extractAssistantTextFromMessages(event.messages) || request.assistantBuffer || '[No response]'

    try {
      await bot.stopTyping(request.sourceUserId)
      await replyWithMediaAwareContent(bot, request.sourceMessage, finalText)
      ctx.ui.setStatus('wechat', `✓ Replied [${request.mode === 'steer' ? 'S' : 'F'}] ${request.previewText}`)
    } catch (error) {
      ctx.ui.setStatus('wechat', `✗ Reply failed: ${error instanceof Error ? error.message : error}`)
    } finally {
      controller.finishActiveRequest()
    }
  })

  const startWechat = async (_args: string | undefined, ctx: any) => {
    if (connected && bot) {
      const action = await ctx.ui.select('WeChat is connected', [
        'Reconnect', 'Disconnect', 'Status', 'Cancel',
      ])
      if (action === 'Reconnect') {
        ctx.ui.setStatus('wechat', '🔄 Reconnecting…')
        bot.stop()
        connected = false
        controller.reset()
        bot = null
      } else if (action === 'Disconnect') {
        bot.stop()
        connected = false
        controller.reset()
        ctx.ui.setStatus('wechat', undefined)
        ctx.ui.notify('WeChat disconnected', 'info')
        bot = null
        return
      } else if (action === 'Status') {
        const creds = bot.getCredentials()
        ctx.ui.notify(
          [
            `Account: ${creds?.accountId}`,
            `User: ${creds?.userId}`,
            `Mode: ${controller.state.routeMode}`,
            `History: ${controller.state.historyLog.length}`,
          ].join('\n'),
          'info',
        )
        return
      } else {
        return
      }
    }

    bot = new WeChatBot({ storage: 'file', logLevel: 'warn' })
    ctx.ui.setStatus('wechat', '⏳ Connecting…')

    try {
      const creds = await bot.login({
        force: false,
        callbacks: {
          onQrUrl: (url) => {
            qrTerminal.generate(url, { small: true }, (qr: string) => {
              process.stderr.write('\n')
              process.stderr.write('  📱 Scan this QR code in WeChat:\n\n')
              for (const line of qr.split('\n')) {
                process.stderr.write(`  ${line}\n`)
              }
              process.stderr.write('\n')
            })
            ctx.ui.setStatus('wechat', `⏳ Scan QR in WeChat… (${url})`)
          },
          onScanned: () => {
            ctx.ui.setStatus('wechat', '📱 Scanned — confirm in WeChat…')
          },
          onExpired: () => {
            ctx.ui.setStatus('wechat', '⏳ QR expired — new one coming…')
          },
        },
      })

      connected = true
      controller.reset()
      ctx.ui.setStatus('wechat', `✓ WeChat: ${creds.accountId} | mode: steer`)
      ctx.ui.notify(`WeChat connected!\nAccount: ${creds.accountId}`, 'info')

      bot.onMessage(async (msg: IncomingMessage) => {
        if (!bot) return

        const result = await handleWechatMessage(pi, ctx, controller, bot, msg)

        if (result.type === 'reply') {
          await bot.reply(msg, result.text)
          ctx.ui.setStatus('wechat', `✓ WeChat: ${creds.accountId} | mode: ${controller.state.routeMode}`)
          return
        }

        try {
          await bot.sendTyping(msg.userId)
        } catch {
          // Best effort only.
        }

        ctx.ui.setStatus('wechat', `📱 [${result.mode === 'steer' ? 'S' : 'F'}] ${result.request.previewText}`)
      })

      bot.on('error', (err) => {
        ctx.ui.setStatus('wechat', `⚠ ${err instanceof Error ? err.message : String(err)}`)
      })
      bot.on('session:expired', () => {
        ctx.ui.setStatus('wechat', '⚠ Session expired — re-login…')
      })
      bot.on('session:restored', (restored) => {
        ctx.ui.setStatus('wechat', `✓ Reconnected: ${restored.accountId} | mode: ${controller.state.routeMode}`)
      })

      bot.start().catch((error) => {
        connected = false
        controller.reset()
        ctx.ui.setStatus('wechat', `✗ Poll error: ${error instanceof Error ? error.message : error}`)
      })
    } catch (error) {
      ctx.ui.setStatus('wechat', undefined)
      ctx.ui.notify(`Login failed: ${error instanceof Error ? error.message : error}`, 'error')
      connected = false
      controller.reset()
      bot = null
    }
  }

  pi.registerCommand('wechat', {
    description: 'Connect WeChat — scan QR to chat with Pi from your phone',
    handler: startWechat,
  })

  pi.on('session_shutdown', async () => {
    if (bot) {
      bot.stop()
      bot = null
    }
    connected = false
    controller.reset()
  })

  pi.on('session_start', async (_event, ctx) => {
    if (connected && bot) {
      ctx.ui.setStatus('wechat', `✓ WeChat: ${bot.getCredentials()?.accountId ?? 'connected'} | mode: ${controller.state.routeMode}`)
    }
  })
}

async function handleWechatMessage(
  pi: ExtensionAPI,
  ctx: any,
  controller: WechatBridgeController<IncomingMessage>,
  bot: WeChatBot,
  msg: IncomingMessage,
) {
  const rawText = msg.type === 'text' ? msg.text ?? '' : undefined
  const prepared = rawText?.trim().startsWith('/')
    ? prepareCommandMessage(rawText)
    : await prepareWechatMessage(msg, bot)

  const result = controller.handleIncoming({
    sourceMessage: msg,
    userId: msg.userId,
    rawText,
    prepared,
  })

  if (result.type === 'dispatch') {
    sendUserMessage(pi, ctx, result.mode, result.content)
  }

  return result
}

function sendUserMessage(pi: ExtensionAPI, ctx: any, mode: RouteMode, content: PiContent): void {
  try {
    if (ctx.isIdle()) {
      pi.sendUserMessage(content)
      return
    }
  } catch {
    // Fall through to explicit delivery mode retry.
  }

  pi.sendUserMessage(content, { deliverAs: mode })
}

function buildWechatSystemPrompt(baseSystemPrompt: string, mode: RouteMode): string {
  return baseSystemPrompt + `\n
## WeChat Bridge (Active)

You are currently bridged to WeChat via the wechatbot extension.
A real WeChat user is chatting with you — your response will be sent back to them.

Current delivery mode: ${mode === 'steer' ? 'steer' : 'follow-up'}.

Key behaviors:
- No markdown: WeChat doesn't render markdown. Write plain text. Use line breaks for structure.
- Send files: To send a file (image, video, document) back to WeChat, mention its absolute path in your response (for example /tmp/photo.png). The bridge auto-detects paths ending in media extensions and sends them as attachments.
- Concise replies: WeChat is a mobile chat app. Keep responses short and conversational.
- Media received: Images arrive as vision input. Videos, voice, and files are described with metadata.
`
}

function prepareCommandMessage(text: string): PreparedWechatMessage {
  return {
    content: text,
    fullText: text,
    preview: text,
    editable: true,
    sourceType: 'text',
  }
}

async function prepareWechatMessage(msg: IncomingMessage, bot: WeChatBot): Promise<PreparedWechatMessage> {
  switch (msg.type) {
    case 'text': {
      const text = msg.text || '[empty message]'
      return {
        content: text,
        fullText: text,
        preview: text,
        editable: true,
        sourceType: 'text',
      }
    }

    case 'image': {
      const media = await bot.download(msg)
      if (!media) {
        const text = '[Image received but could not be downloaded]'
        return {
          content: text,
          fullText: text,
          preview: text,
          editable: false,
          sourceType: 'image',
        }
      }

      const promptText = msg.text && msg.text !== '[image]' ? msg.text : 'User sent an image from WeChat:'
      return {
        content: [
          { type: 'text', text: promptText },
          { type: 'image', data: media.data.toString('base64'), mimeType: 'image/jpeg' },
        ],
        fullText: `${promptText}\n[image attached]`,
        preview: promptText,
        editable: false,
        sourceType: 'image',
      }
    }

    case 'voice': {
      const voice = msg.voices[0]
      if (voice?.text) {
        const text = `[Voice message, transcribed]: ${voice.text}`
        return {
          content: text,
          fullText: text,
          preview: text,
          editable: false,
          sourceType: 'voice',
        }
      }

      const media = await bot.download(msg)
      const text = media
        ? `[Voice message received (${media.format}, ${media.data.length} bytes). No transcription available — please ask the user to type their message.]`
        : '[Voice message received but could not be downloaded]'
      return {
        content: text,
        fullText: text,
        preview: text,
        editable: false,
        sourceType: 'voice',
      }
    }

    case 'file': {
      const file = msg.files[0]
      const fileName = file?.fileName ?? 'unknown file'
      const fileSize = file?.size ? ` (${formatFileSize(file.size)})` : ''
      const textExts = new Set([
        '.txt', '.md', '.csv', '.json', '.xml', '.html', '.yaml', '.yml', '.toml', '.log',
        '.py', '.js', '.ts', '.go', '.rs', '.java', '.c', '.cpp', '.h',
      ])

      if (textExts.has(extname(fileName).toLowerCase())) {
        try {
          const media = await bot.download(msg)
          if (media) {
            const text = media.data.toString('utf-8')
            const truncated = text.length > 10000 ? `${text.slice(0, 10000)}\n... [truncated]` : text
            const prompt = `[File: ${fileName}${fileSize}]\n\n\`\`\`\n${truncated}\n\`\`\``
            return {
              content: prompt,
              fullText: prompt,
              preview: `[File] ${fileName}${fileSize}`,
              editable: false,
              sourceType: 'file',
            }
          }
        } catch {
          // Fall through to generic file description.
        }
      }

      const prompt = `[File received: ${fileName}${fileSize}. To process this file, ask the user to share its content as text.]`
      return {
        content: prompt,
        fullText: prompt,
        preview: `[File] ${fileName}${fileSize}`,
        editable: false,
        sourceType: 'file',
      }
    }

    case 'video': {
      const video = msg.videos[0]
      const duration = video?.durationMs ? ` (${Math.round(video.durationMs / 1000)}s)` : ''
      try {
        const media = await bot.download(msg)
        if (media) {
          const tempDir = await mkdtemp(join(tmpdir(), 'wechat-video-'))
          const videoPath = join(tempDir, 'video.mp4')
          await writeFile(videoPath, media.data)
          const prompt = `[Video received${duration}, saved to: ${videoPath}. You can access this file for processing.]`
          return {
            content: prompt,
            fullText: prompt,
            preview: `[Video]${duration || ' received'}`,
            editable: false,
            sourceType: 'video',
          }
        }
      } catch {
        // Fall through to generic video description.
      }

      const prompt = `[Video received${duration} but could not be downloaded.]`
      return {
        content: prompt,
        fullText: prompt,
        preview: `[Video]${duration || ' received'}`,
        editable: false,
        sourceType: 'video',
      }
    }

    default: {
      const sourceType = normalizeHistorySourceType(msg.type)
      const prompt = `[${msg.type} message received — not supported yet]`
      return {
        content: prompt,
        fullText: prompt,
        preview: prompt,
        editable: false,
        sourceType,
      }
    }
  }
}

async function replyWithMediaAwareContent(bot: WeChatBot, reply: IncomingMessage, finalText: string): Promise<void> {
  const cleanText = stripMarkdown(finalText)
  const mediaFiles = extractMediaPaths(finalText)

  if (mediaFiles.length > 0) {
    const textWithoutPaths = removeMediaPaths(cleanText, mediaFiles)
    if (textWithoutPaths.trim()) {
      await bot.reply(reply, textWithoutPaths)
    }

    for (const filePath of mediaFiles) {
      try {
        const data = await readFile(filePath)
        await bot.reply(reply, { file: data, fileName: basename(filePath) })
      } catch {
        await bot.reply(reply, `[Failed to send file: ${basename(filePath)}]`)
      }
    }
    return
  }

  await bot.reply(reply, cleanText)
}

type AssistantStopReason = 'stop' | 'length' | 'toolUse' | 'error' | 'aborted'

type AssistantMessageLike = {
  role: 'assistant'
  content: Array<{ type: string; text?: string }>
  stopReason?: AssistantStopReason
  errorMessage?: string
}

function shouldReplyOnTurnEnd(message: unknown): boolean {
  const assistantMessage = getAssistantMessage(message)
  if (!assistantMessage) return false

  return assistantMessage.stopReason !== 'error' && assistantMessage.stopReason !== 'aborted'
}

function extractAssistantText(message: unknown): string {
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

function extractAssistantTextFromMessages(messages: unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const text = extractAssistantText(messages[index])
    if (text) return text
  }
  return ''
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

function getAssistantMessage(value: unknown): AssistantMessageLike | undefined {
  if (!isAssistantMessage(value)) return undefined
  return value
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

function normalizeHistorySourceType(type: string): HistorySourceType {
  switch (type) {
    case 'text':
    case 'image':
    case 'voice':
    case 'file':
    case 'video':
      return type
    default:
      return 'structured'
  }
}

function extractMediaPaths(text: string): string[] {
  const paths: string[] = []
  const mediaExts = /\.(png|jpg|jpeg|gif|webp|bmp|svg|mp4|mov|webm|avi|pdf|doc|docx|xls|xlsx|ppt|pptx|zip|tar|gz)$/i
  const pathRegex = /(?:^|\s)((?:\/[\w./-]+|\.\/[\w./-]+))/gm
  let match
  while ((match = pathRegex.exec(text)) !== null) {
    const filePath = match[1].trim()
    if (mediaExts.test(filePath)) paths.push(filePath)
  }
  return [...new Set(paths)]
}

function removeMediaPaths(text: string, paths: string[]): string {
  let result = text
  for (const filePath of paths) {
    result = result.replace(new RegExp(filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '')
  }
  return result.replace(/\n{3,}/g, '\n\n').trim()
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
