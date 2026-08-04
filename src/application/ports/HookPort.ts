/**
 * Hook 系统端口定义。
 *
 * 允许外部代码注册生命周期回调，在 Agent 执行的关键节点触发。
 * 所有 hook 都是可选的、异步的、失败隔离的。
 */

/** Hook 可注册的生命周期事件 */
export type HookEvent =
  | 'beforeToolExecute'
  | 'afterToolExecute'
  | 'beforeFileWrite'
  | 'afterFileWrite'
  | 'beforeModelRequest'
  | 'afterModelResponse'
  | 'onError'
  | 'onSessionStart'
  | 'onSessionEnd'

/** Hook 上下文 —— 传递给 hook handler 的数据 */
export interface HookContext {
  event: HookEvent
  /** 当前 session ID */
  sessionId?: string
  /** 工具名称（for tool hooks） */
  toolName?: string
  /** 工具输入 JSON（for tool hooks） */
  toolInput?: string
  /** 工具输出（for afterToolExecute） */
  toolOutput?: string
  /** 工具执行是否成功（for afterToolExecute） */
  toolSuccess?: boolean
  /** 模型名称（for model hooks） */
  modelName?: string
  /** 请求消息数（for model hooks） */
  messageCount?: number
  /** 文件路径（for file hooks） */
  filePath?: string
  /** 文件旧内容（for file hooks） */
  oldContent?: string
  /** 文件新内容（for file hooks） */
  newContent?: string
  /** 错误对象（for onError） */
  error?: Error
  /** 时间戳 */
  timestamp: number
}

/**
 * Hook 处理器签名。
 * 如果处理器返回 false，则中止后续操作（仅对 before* hooks 有效）。
 */
export type HookHandler = (context: HookContext) => Promise<boolean | void>

export interface HookPort {
  /**
   * 注册 hook 处理器。
   * @param event 监听的事件
   * @param handler 处理器函数
   * @returns 取消注册的函数
   */
  on(event: HookEvent, handler: HookHandler): () => void

  /**
   * 触发事件。
   * 按注册顺序调用所有处理器。
   * before* hooks 如果有任一返回 false，则返回 false。
   * 所有 handler 失败都被隔离，不会中断调用链。
   */
  emit(context: HookContext): Promise<boolean>
}
