import type {
  ToolActionIntent,
  ToolApprovalDecision,
} from '../../domain/tooling/value-objects/ToolApproval'
import type { PermissionMode } from '../dto/UiPreferences'

/**
 * 高风险工具执行前向用户征求同意。
 * 端口只描述「问一次、拿到一个决定」，具体怎么问（终端面板 / 自动放行）由外层实现。
 */
export interface ToolApprovalPort {
  requestApproval(intent: ToolActionIntent): Promise<ToolApprovalDecision>
}

/**
 * 待决审批的操作面，供终端层驱动。
 * 单独定义是为了让 presentation 只依赖这个接口，而不是 infrastructure 里的具体适配器。
 */
export interface ToolApprovalController {
  /** 订阅当前待决意图；null 表示没有待办审批。 */
  setObserver(observer: (intent: ToolActionIntent | null) => void): void
  getPending(): ToolActionIntent | null
  /** 结算队首审批，返回 false 表示当时并没有待决项。 */
  resolvePending(decision: ToolApprovalDecision): boolean
  /** 中止时清空所有待决审批，避免执行流永久挂起。 */
  denyAllPending(): void
  getMode(): PermissionMode
  setMode(mode: PermissionMode): void
}
