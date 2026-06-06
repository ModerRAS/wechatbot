# @wechatbot/pi-agent

Pi extension — type `/wechat` in pi, scan QR code in terminal, then drive Pi from WeChat with sticky `steer` / `follow-up` control modes.

## Install

### From npm (recommended)

```bash
pi install npm:@wechatbot/pi-agent
```

Done. The extension auto-loads on next `pi` session. Type `/wechat` to start.

### From git

```bash
pi install https://github.com/jiweiyuan/wechatbot
```

### Quick test (no install)

```bash
pi -e npm:@wechatbot/pi-agent
```

### Manual (local development)

```bash
git clone https://github.com/jiweiyuan/wechatbot
cd wechatbot/pi-agent && npm install

# Load directly
pi -e ./src/index.ts

# Or copy to auto-discovery directory
cp -r . ~/.pi/agent/extensions/wechat/
```

## Usage

```
/wechat              Scan QR code → connect WeChat to this pi session
```

### WeChat-side commands

Once connected, send these commands from WeChat itself:

```
/steer               Switch sticky mode to steer (default)
/followup            Switch sticky mode to follow-up
/history             Show unified history across both modes
/open <id>           Open one history entry and wait for replacement text
/status              Show current mode, ui state, history counts, queue counts
/cancel              Exit history/edit helper state
/help                Show command help
```

### Mode behavior

- Default mode is `steer`.
- In `steer` mode, every normal text message is sent to Pi as a steer message when Pi is busy; if Pi is idle, it is sent immediately as a normal turn.
- In `follow-up` mode, every normal text message is sent as a follow-up when Pi is busy; if Pi is idle, it is also sent immediately as a normal turn.
- Modes are sticky: they stay active until you switch to the other mode.

### Unified history

- `/history` shows a single reverse-chronological list for both modes.
- Entries are labeled like `12 [F#5] ...` or `11 [S#6] ...`.
- `12` is the global history id used by `/open 12`.
- `F#5` means the 5th follow-up entry; `S#6` means the 6th steer entry.

### Editing a history item

1. Send `/history`
2. Send `/open <id>`
3. The bridge replies with the full original text
4. Your next plain text message becomes the replacement and is re-sent using the original entry's mode

This does **not** rewrite Pi's internal queued messages. It creates a new steer/follow-up entry, matching Pi's public extension API behavior.

### What happens

```
> /wechat

  📱 Scan this QR code in WeChat:

    ▄▄▄▄▄▄▄ ▄▄▄ ▄▄▄▄▄▄▄
    █ ▄▄▄ █ █▀█ █ ▄▄▄ █
    █ ███ █ ▄▀▄ █ ███ █
    █▄▄▄▄▄█ █ ▄ █▄▄▄▄▄█
    ▄▄▄▄▄ ▄▄▄█▄▄▄ ▄▄▄▄▄
    █▄█▀█▄▄ ▀▀▄▀▀█▄▀█▀▄
    ▄▄▄▄▄▄▄ ▀▄ █▀▄█▄█▀▄
    █▄▄▄▄▄█ █▀▄█▀▀█▀███

  [wechat] ✓ Connected: e06c1ceea05e@im.bot

# Now send "/followup" from WeChat...
# Then send "帮我继续展开部署步骤"
# Pi queues it as a follow-up and sends the reply back to WeChat.
# "对方正在输入中..." is shown while Pi is working on your active request.
```

## How It Works

```
WeChat User (phone)
    │
    ▼
iLink API (Tencent) ←── @wechatbot/wechatbot SDK
    │
    ▼
Pi Extension
    │
    ├── WeChat msg → state machine decides:
    │       - command reply
    │       - steer dispatch
    │       - follow-up dispatch
    │
    ├── dispatch → pi.sendUserMessage(..., { deliverAs })
    │
    └── Pi turn finishes → reply routed back to the matching WeChat message
```

1. `/wechat` creates a `WeChatBot` instance (SDK)
2. SDK calls iLink API → gets QR URL
3. `qrcode-terminal` renders QR code in pi TUI via `ctx.ui.setWidget()`
4. User scans QR in WeChat → login confirmed → credentials saved
5. SDK starts long-poll → incoming WeChat messages go through the bridge state machine
6. The bridge records request/history metadata and dispatches to Pi with `sendUserMessage()`
7. When a Pi turn completes, the matching response is sent back via `bot.reply()`
8. `bot.sendTyping()` shows "对方正在输入中..." while Pi thinks

## QR Code Display

The QR code is rendered using `qrcode-terminal` — a real scannable QR code in the terminal.

The **SDK does NOT render QR codes** — that is the developer's responsibility.
This extension is the developer. It receives the URL via `onQrUrl` callback and renders it.

## Dependencies

| Package | Purpose |
|---|---|
| `@wechatbot/wechatbot` | WeChat iLink Bot SDK — login, poll, send, typing, context_token |
| `qrcode-terminal` | Render scannable QR code in terminal |
| `@mariozechner/pi-coding-agent` | Pi extension API (peer dependency) |
| `vitest` | Local tests for bridge state machine and request ledger |

## Pi Package

This is a [pi package](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md). It declares `"keywords": ["pi-package"]` and `"pi": { "extensions": [...] }` in package.json. Pi auto-discovers the extension after install.
