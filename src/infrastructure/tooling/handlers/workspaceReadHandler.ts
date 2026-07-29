import { parseJsonObject } from '../toolPathGuard'
import { toolSuccess, type ToolHandler } from './ToolHandler'

/** 返回工作区结构摘要，是模型开场了解项目的最低成本入口。 */
export const handleWorkspaceRead: ToolHandler = async (request) => {
  const prompt = parseJsonObject(request.input)
  const focus = typeof prompt.focus === 'string' ? prompt.focus : 'workspace'
  const entries = request.workspace.topLevelEntries.slice(0, 12).join(', ') || '(empty)'

  return toolSuccess(
    request.toolId,
    [
      `Focus: ${focus}`,
      `Root: ${request.workspace.rootPath}`,
      `Git: ${request.workspace.isGitRepository ? 'yes' : 'no'}`,
      `Package manager: ${request.workspace.packageManager}`,
      `Top-level entries: ${entries}`,
    ].join('\n'),
  )
}
