import { getQuickJS } from 'quickjs-emscripten'

export interface SandboxOptions {
  timeoutMs?: number
  memoryBytes?: number
}

export type SandboxResult =
  | { ok: true; value: unknown; durationMs: number }
  | { ok: false; error: string; durationMs: number }

/**
 * 在 QuickJS WASM 中执行模型生成的分析代码。
 * 隔离性：无 fs / net / require / process，仅能读取注入的只读 `input`，
 * 必须以 `return` 的形式返回可 JSON 序列化的结果。
 */
export async function runInSandbox(
  code: string,
  input: unknown,
  { timeoutMs = 1000, memoryBytes = 32 * 1024 * 1024 }: SandboxOptions = {},
): Promise<SandboxResult> {
  const started = Date.now()
  const QuickJS = await getQuickJS()
  const runtime = QuickJS.newRuntime()
  runtime.setMemoryLimit(memoryBytes)
  runtime.setMaxStackSize(1024 * 1024)
  const deadline = started + timeoutMs
  runtime.setInterruptHandler(() => Date.now() > deadline)

  const vm = runtime.newContext()
  try {
    const wrapped = `(function(){ "use strict"; const input = Object.freeze(JSON.parse(${JSON.stringify(
      JSON.stringify(input),
    )})); ${code}\n})()`
    const result = vm.evalCode(wrapped)
    if (result.error) {
      const err = vm.dump(result.error)
      result.error.dispose()
      return { ok: false, error: formatError(err), durationMs: Date.now() - started }
    }
    const value = vm.dump(result.value)
    result.value.dispose()
    // 再过一次 JSON，确保结果是纯数据
    return { ok: true, value: JSON.parse(JSON.stringify(value ?? null)), durationMs: Date.now() - started }
  } finally {
    vm.dispose()
    runtime.dispose()
  }
}

function formatError(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const e = err as { name?: string; message: string }
    return `${e.name ?? 'Error'}: ${e.message}`
  }
  return String(err)
}
