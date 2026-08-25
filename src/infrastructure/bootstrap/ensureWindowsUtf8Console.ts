/**
 * Windows 终端编码对齐。
 *
 * 症状:中文/emoji 在 cmd/老版 Windows Terminal 里渲染成 `?` 或乱码 —— Node 按
 * UTF-8 输出字节,但控制台活动代码页还是 GBK(936),解码端不匹配。
 *
 * 处理:启动时把三个流的编码与控制台代码页都切到 UTF-8(65001)。任何失败都
 * 静默降级 —— 编码对齐是尽力而为的体验修复,绝不能因此阻止启动。
 */
import { spawnSync } from 'node:child_process'

export async function ensureWindowsUtf8Console(): Promise<void> {
  if (process.platform !== 'win32') return

  // 1) Node 侧:stdin/stdout/stderr 全部按 UTF-8 收发
  for (const stream of [process.stdin, process.stdout, process.stderr]) {
    // setEncoding 影响读入侧的字符串解码;写出侧 Node 默认已按 UTF-8 编码 buffer。
    if (typeof stream.setEncoding === 'function') {
      try {
        stream.setEncoding('utf8')
      } catch {
        // 某些非 TTY 场景(管道/被重定向)会抛,忽略
      }
    }
  }

  // 2) 控制台侧:把活动代码页切到 65001(UTF-8)。
  //    仅当当前代码页已知且不是 UTF-8 时执行,避免无谓的子进程调用。
  const currentCodepage = readActiveCodepage()
  if (currentCodepage !== null && currentCodepage !== 65001) {
    try {
      spawnSync('chcp', ['65001'], { stdio: 'ignore', timeout: 3000 })
    } catch {
      // chcp 不可用(精简系统/非交互环境)则放弃,不影响功能
    }
  }
}

/** 读当前活动代码页;读不到返回 null(说明无需或无法干预)。 */
function readActiveCodepage(): number | null {
  try {
    // Intl.Locale 解析如 "zh-CN" 无法给出代码页;用注册表式 API 不可移植。
    // 直接跑 `chcp` 解析输出最可靠:"Active code page: 936"。
    const result = spawnSync('chcp', [], { encoding: 'utf8', timeout: 3000 })
    if (result.error || result.status !== 0 || !result.stdout) return null
    const match = result.stdout.match(/(\d+)\s*$/m)
    return match ? Number.parseInt(match[1], 10) : null
  } catch {
    return null
  }
}
