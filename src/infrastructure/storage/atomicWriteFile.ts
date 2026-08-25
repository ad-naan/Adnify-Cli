import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * 原子写盘：先写同目录临时文件，再 rename 覆盖目标。
 *
 * 直接 writeFile 在写入途中被中断（崩溃/断电/kill）会留下半个 JSON，
 * 下次启动会读到损坏的配置或会话。rename 在同一卷上是原子的，
 * 目标文件要么是旧内容、要么是完整新内容。
 *
 * 临时文件名带 pid + 纳秒后缀避免并发写互相踩踏；失败时尽力清理残留。
 */
export async function atomicWriteFile(
  path: string,
  content: string,
): Promise<void> {
  const tmpPath = `${path}.tmp-${process.pid}-${Number(process.hrtime.bigint() % 1_000_000_000n)}`
  await mkdir(dirname(path), { recursive: true })
  try {
    await writeFile(tmpPath, content, 'utf8')
    await rename(tmpPath, path)
  } catch (error) {
    await rm(tmpPath).catch(() => {})
    throw error
  }
}
