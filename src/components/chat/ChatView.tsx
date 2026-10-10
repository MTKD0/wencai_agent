import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { useEffect, useRef, useState } from 'react'
import { Streamdown } from 'streamdown'
import type { WencaiUIMessage } from '#/server/agent/messages'
import ToolPart from './ToolPart'

const SUGGESTIONS = ['我的余额有多少？', '给妈妈转 200 元', '分析一下我这个月的消费', '帮我看看有哪些订阅在扣费']

export default function ChatView() {
  const { messages, sendMessage, status } = useChat<WencaiUIMessage>({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  })
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const busy = status === 'submitted' || status === 'streaming'

  useEffect(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages])

  const send = (text: string) => {
    if (!text.trim() || busy) return
    sendMessage({ text })
    setInput('')
  }

  return (
    <>
      <main className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="space-y-3 pt-8 text-center">
            <p className="text-base font-semibold text-[var(--sea-ink)]">说句话就能办业务</p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1.5 text-sm text-[var(--sea-ink)]">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'space-y-2'}>
            {m.parts.map((part, i) => {
              const key = `${m.id}-${i}`
              if (part.type === 'text') {
                return m.role === 'user' ? (
                  <p key={key} className="m-0 max-w-[80%] rounded-2xl rounded-br-sm bg-[var(--lagoon-deep)] px-3 py-2 text-sm text-white">
                    {part.text}
                  </p>
                ) : (
                  <div key={key} className="prose prose-sm max-w-none text-[var(--sea-ink)] dark:prose-invert">
                    <Streamdown>{part.text}</Streamdown>
                  </div>
                )
              }
              if (part.type === 'data-verify') {
                return (
                  <p key={key} className="m-0 rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-900">
                    ⚠️ 以上回复中的 {part.data.violations.map((v) => `「${v.text}」`).join('、')} 未能在系统数据中核实，请以卡片中的数据为准。
                  </p>
                )
              }
              if (part.type === 'data-blocked') {
                return (
                  <p key={key} className="m-0 text-xs text-[var(--sea-ink-soft)]">
                    🛡️ 安全审核已拦截（{part.data.categories.join('、')}）
                  </p>
                )
              }
              if (part.type.startsWith('tool-')) {
                return <ToolPart key={key} part={part as never} onFollowUp={send} />
              }
              return null
            })}
          </div>
        ))}
        {status === 'submitted' && <p className="text-sm text-[var(--sea-ink-soft)]">文财正在思考…</p>}
        <div ref={bottomRef} />
      </main>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
        className="flex gap-2 border-t border-[var(--line)] bg-[var(--header-bg)] px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        {/* TODO: 语音输入（ASR）与图片上传（DeepSeek V4.1 多模态） */}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="想办点什么？"
          className="flex-1 rounded-full border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-2 text-sm outline-none"
        />
        <button type="submit" disabled={busy} className="rounded-full bg-[var(--lagoon-deep)] px-4 text-sm font-semibold text-white disabled:opacity-50">
          发送
        </button>
      </form>
    </>
  )
}
