export const SUPPORTED_APP_LOCALES = ['zh-CN', 'en'] as const

export type AppLocale = (typeof SUPPORTED_APP_LOCALES)[number]

export type TranslationVariables = Record<string, string | number | boolean | null | undefined>

const messages = {
  'zh-CN': {
    'assistant.tagline': '冷静执行，精准掌控你的代码库。',
    'assistant.description':
      '一位面向终端的 AI 编程搭档，强调结构清晰、执行可靠、交互稳定。',
    'common.by': '作者',
    'common.yes': '是',
    'common.no': '否',

    'app.boot.panelTitle': '启动中',
    'app.boot.panelSubtitle': '运行时预热',
    'app.boot.workspaceName': '启动环境',
    'app.boot.modelLabel': '初始化中',
    'app.boot.heading': '正在启动 Adnify-Cli',
    'app.boot.description': '正在装配运行时、工作区上下文与模型配置。',
    'app.boot.failed': '启动失败',

    'header.meta.workspace': 'workspace ',
    'header.meta.package': 'pkg ',
    'header.meta.git': 'git ',
    'header.meta.gitTracked': 'tracked',
    'header.meta.gitDetached': 'detached',

    'empty.hint': '从一个目标、文件路径，或输入 `/` 打开命令面板。',
    'empty.panelSession': 'session',
    'empty.panelQuickStart': '快速开始',
    'empty.recentSessions': '最近会话',

    'input.panelCommands': '命令',
    'input.panelConsole': '控制台',
    'input.panelSetup': '配置',
    'input.labelInput': 'input',
    'input.labelPalette': 'palette',
    'input.labelSetup': 'setup',
    'input.labelSetupMode': 'config',
    'input.placeholder': '描述任务，或输入 / 打开命令列表。',
    'input.hintSuggestions': '上下选择  Tab/Enter 填入  Esc 关闭',
    'input.hintDefault': 'Enter 发送  / 命令  Up/Down 历史  Ctrl+O 全屏记录',
    'input.hintConfigInit': 'Enter 继续  Esc 退出配置',
    'input.panelApproval': '审批',
    'input.labelApprovalMode': 'approval',
    'input.hintApproval': '输入 y 或 n，然后回车',

    'status.system': 'system',
    'status.configured': '已配置',
    'status.setupRequired': '待配置',
    'status.initializing': '正在初始化...',
    'status.notConfigured': '尚未检测到模型配置。输入 :config init 开始配置。',
    'status.runtimeReady': '运行时已就绪，可以开始协作。',
    'status.sessionRestored': '已恢复最近会话 {id}。',
    'status.sessionRestoredSetupRequired':
      '已恢复最近会话 {id}，但仍需完成模型配置。输入 :config init 开始配置。',
    'status.configInitCancelled': '已退出配置向导。输入 :config init 可重新进入。',
    'status.enteringConfigInit': '正在进入模型配置向导...',
    'status.executionFailed': '执行失败：{message}',
    'status.responseFailed': '响应失败：{message}',
    'status.configFailed': '配置失败：{message}',
    'status.configFileInvalid':
      '配置文件 JSON 无效：{path}。请修复后重试，或重新运行 :config init。',
    'status.configFileUnreadable': '无法读取配置文件：{path}。{message}',
    'status.bootFailedGeneric': '启动失败：{message}',
    'status.bootFailedConfigInvalid':
      '启动失败：配置文件 JSON 无效：{path}。请修复后重试，或重新运行 :config init。',
    'status.bootFailedConfigUnreadable': '启动失败：无法读取配置文件：{path}。{message}',
    'status.executionAborting': '正在中止当前执行...',
    'status.executionAborted': '已中止当前执行。',
    'status.approvalRequired': '运行请求的工具前需要审批。',
    'status.approvalChoiceRequired': '请输入 y 以批准，或输入 n 以拒绝当前工具请求。',
    'status.responseCompleted': '已完成一轮响应。',
    'status.inputIgnored': '输入为空，已忽略。',
    'status.hintControls': 'Esc 中止 · PgUp/PgDn 滚动 · Ctrl+O 全屏记录',

    'conversation.panelSession': '会话',
    'conversation.panelConfiguration': '配置向导',
    'conversation.response': '响应',
    'conversation.notice': '提示',
    'conversation.output': '输出',
    'conversation.localCommand': '本地命令',
    'conversation.thinking': '思考中',
    'conversation.configError': '错误：{message}',
    'conversation.scrollHidden': '… 上方还有 {count} 行（PgUp/PgDn 滚动，Esc 回到最新）',
    'conversation.scrollHiddenOne': '… 上方还有 1 行（PgUp/PgDn 滚动，Esc 回到最新）',
    'conversation.scrollHiddenShort': '… 上方 {count} 行',
    'conversation.scrollPosition': '… 上方 {above} 行 / 下方 {below} 行（Esc 回到最新）',
    'conversation.scrollPositionShort': '… ↑{above} ↓{below}',
    'conversation.scrollTop': '… 已到顶部（Esc 回到最新）',
    'conversation.hintControls': 'PgUp/PgDn · Ctrl+O',
    'conversation.transcriptTitle': '全屏记录',
    'conversation.transcriptHint': 'PgUp/PgDn 滚动 · Esc 回到底部/退出 · Ctrl+O 退出',
    'collapse.hidden': '… 另有 {count} 行未显示',
    'collapse.hiddenOne': '… 另有 1 行未显示',
    'collapse.hiddenShort': '… 另 {count} 行',
    'cli.output.omittedChars': '…… 内容过长，省略 {count} 个字符 ……',

    'transcript.commands': '命令',
    'transcript.mode': '模式',
    'transcript.workspace': '工作区',
    'transcript.tools': '工具',
    'transcript.model': '模型',
    'transcript.config': '配置',
    'transcript.conversation': '会话',
    'transcript.session': '会话',
    'transcript.command': '命令',

    'config.selectProviderTitle': '请选择 AI Provider：',
    'config.customProvider': '自定义 OpenAI 兼容端点',
    'config.enterIndexContinue': '输入序号继续',
    'config.selectModelTitle': '已选择 {provider}，请选择模型：',
    'config.defaultSuffix': '（默认）',
    'config.selectModelInstruction': '输入序号，或直接回车使用默认模型',
    'config.enterApiKey': '请输入 API Key',
    'config.enterBaseUrl': '请输入 Base URL，例如 https://api.example.com/v1',
    'config.confirmTitle': '确认配置：',
    'config.confirmBaseUrl': 'Base URL：{value}',
    'config.confirmModel': 'Model：{value}',
    'config.confirmApiKey': 'API Key：{value}',
    'config.confirmInstruction': '输入 y 确认保存，输入 n 取消',
    'config.rangeError': '请输入 1 到 {max} 之间的序号',
    'config.modelRangeError': '请输入 1 到 {max} 之间的序号，或直接回车',
    'config.baseUrlRequired': 'Base URL 不能为空',
    'config.apiKeyRequired': 'API Key 不能为空',
    'config.confirmChoiceError': '请输入 y 或 n',
    'config.savedLine1': '配置已保存到 ~/.adnify-cli/config.json',
    'config.savedLine2': '当前模型：{model} ({baseUrl})',
    'config.savedLine3': '现在可以直接开始对话，或使用 :model 继续切换模型。',

    'approval.panelTitle': '工具审批',
    'approval.title': '{tool} 请求执行以下操作',
    'approval.riskLabel': '风险等级：{value}',
    'approval.targetLabel': '目标路径：{value}',
    'approval.instruction': 'y 批准   n 拒绝   a 本会话内始终允许该工具',
    'approval.choiceError': '请输入 y、n 或 a',
    'approval.deniedByUser': '你拒绝了这次操作：{summary}',
    'approval.approvedStatus': '已批准：{summary}',
    'approval.deniedStatus': '已拒绝：{summary}',
    'approval.alwaysApprovedStatus': '已批准，且本会话内不再询问 {tool}',

    'tool.risk.safe': '安全',
    'tool.risk.careful': '需谨慎',
    'tool.risk.dangerous': '危险',

    'command.desc.default': '执行本地命令',
    'command.desc.help': '查看本地命令列表',
    'command.desc.mode.chat': '切换到 chat 模式',
    'command.desc.mode.agent': '切换到 agent 模式',
    'command.desc.mode.plan': '切换到 plan 模式',
    'command.desc.workspace': '查看当前工作区摘要',
    'command.desc.status': '查看当前运行与 git 状态',
    'command.desc.tools': '查看当前工具目录',
    'command.desc.doctor': '查看当前运行状态诊断',
    'command.desc.diff': '查看当前 git diff 补丁',
    'command.desc.review': '审查当前 git diff',
    'command.desc.model': '查看或切换当前模型',
    'command.desc.config': '查看当前模型配置',
    'command.desc.configInit': '启动模型配置向导',
    'command.desc.session': '查看当前会话信息',
    'command.desc.sessions': '查看最近会话列表',
    'command.desc.resume': '恢复指定会话',
    'command.desc.storage': '查看或设置数据存储目录',
    'command.desc.memory': '保存或查看跨会话记忆',
    'command.desc.checkpoint': '创建 git 检查点提交',
    'command.desc.undo': '撤销最后一次检查点',
    'command.desc.skill': '查看或加载技能指令',
    'command.desc.mcp': '查看已连接的 MCP 服务器',
    'command.desc.context': '查看当前上下文使用情况',
    'command.desc.clear': '清空当前会话消息',
    'command.desc.exit': '退出 Adnify-Cli',

    'cli.help.title': '本地命令列表：',
    'cli.help.status': '已输出本地命令帮助。',
    'cli.mode.invalidOutput': '模式无效。可选模式：{modes}',
    'cli.mode.invalidStatus': '模式切换失败，请检查命令参数。',
    'cli.mode.changedOutput': '会话模式已切换为 {mode}。',
    'cli.mode.changedStatus': '当前模式：{mode}',
    'cli.workspace.status': '已输出工作区摘要。',
    'cli.status.title': '当前状态：',
    'cli.status.gitChanges': 'Git 变更：',
    'cli.status.clean': '工作区干净。',
    'cli.status.noCommits': '暂无提交记录',
    'cli.status.upToDate': '已同步',
    'cli.status.aheadBy': '领先 {count}',
    'cli.status.behindBy': '落后 {count}',
    'cli.status.countStaged': '{count} 个已暂存',
    'cli.status.countUnstaged': '{count} 个未暂存',
    'cli.status.countUntracked': '{count} 个未跟踪',
    'cli.status.staged': '已暂存变更：',
    'cli.status.unstaged': '未暂存变更：',
    'cli.status.untracked': '未跟踪文件：',
    'cli.status.notGit': '当前工作区不是 Git 仓库。',
    'cli.status.status': '已显示当前状态。',
    'cli.status.failed': '查看当前状态失败：{message}',
    'cli.doctor.title': '运行状态诊断：',
    'cli.doctor.ready': '运行状态看起来正常。',
    'cli.doctor.setupRequired': '模型尚未配置完成，请先运行 :config init。',
    'cli.doctor.status': '已显示运行状态诊断。',
    'cli.diff.title': '当前 diff：',
    'cli.diff.noChanges': '当前没有检测到 git diff。',
    'cli.diff.status': '已显示当前 diff。',
    'cli.diff.notGit': '当前工作区不是 Git 仓库，无法执行 :diff。',
    'cli.diff.failed': '查看 diff 失败：{message}',
    'cli.review.title': '代码审查结果：',
    'cli.review.clean': '未发现明显问题。',
    'cli.review.noChanges': '当前没有检测到待审查的 git diff。',
    'cli.review.findings': '发现的问题：',
    'cli.review.summary': '审查摘要：',
    'cli.review.changedFiles': '变更文件：',
    'cli.review.stagedFocus': '已暂存重点：',
    'cli.review.unstagedFocus': '未暂存重点：',
    'cli.review.priorityFiles': '建议优先查看的文件：',
    'cli.review.status': '已完成当前 diff 的审查。',
    'cli.review.notGit': '当前工作区不是 Git 仓库，无法执行 :review。',
    'cli.review.failed': '代码审查失败：{message}',
    'cli.tools.title': '当前规划的工具目录：',
    'cli.tools.summary': '共有 {count} 个工具可用',
    'cli.tools.status': '已输出工具目录。',
    'cli.model.current': '当前模型：{model} ({baseUrl})',
    'cli.model.providersTitle': '可用 Provider：',
    'cli.model.noProviders':
      '尚未配置额外 Provider，可在 ~/.adnify-cli/config.json 的 providers 字段中添加。',
    'cli.model.usage': '用法：:model <provider> [model]',
    'cli.model.example': '示例：:model openai gpt-5',
    'cli.model.unavailable': '当前运行时不支持直接切换模型。请改用 :config 或 :config init 更新配置。',
    'cli.model.unavailableStatus': '当前运行时不支持模型切换。',
    'cli.model.providerMissing':
      'Provider "{provider}" 不存在或未配置模型。\n可用 Provider：{available}',
    'cli.model.providerMissingStatus': '切换失败：未找到 {provider}',
    'cli.model.switchedOutput': '已切换到 {model} ({baseUrl})',
    'cli.model.switchedStatus': '当前模型：{model}',

    'cli.config.unset': '未配置',
    'cli.config.title': '当前模型配置：',
    'cli.config.provider': '- Provider：{value}',
    'cli.config.apiKey': '- API Key：{value}',
    'cli.config.baseUrl': '- Base URL：{value}',
    'cli.config.model': '- Model：{value}',
    'cli.config.maxTokens': '- Max Tokens：{value}',
    'cli.config.temperature': '- Temperature：{value}',
    'cli.config.timeout': '- Timeout：{value}ms',
    'cli.config.dataRoot': '- 数据目录：{value}',
    'cli.config.configFile': '- 配置文件：{value}',
    'cli.config.sessionsDir': '- 会话目录：{value}',
    'cli.config.howTo': '配置方式：',
    'cli.config.howToFile': '1. 创建 ~/.adnify-cli/config.json',
    'cli.config.howToEnv':
      '2. 或设置环境变量：ADNIFY_API_KEY、ADNIFY_BASE_URL、ADNIFY_MODEL、ADNIFY_PROVIDER',
    'cli.config.commandHelpTitle': '命令式配置：',
    'cli.config.commandHelpSetProvider':
      '- :config set provider <openai-compatible|openai-responses|anthropic|google>',
    'cli.config.commandHelpSetModel': '- :config set model <model>',
    'cli.config.commandHelpSetApiKey': '- :config set api-key <key>',
    'cli.config.commandHelpSetBaseUrl': '- :config set base-url <url>',
    'cli.config.commandHelpSetMaxTokens': '- :config set max-tokens <number>',
    'cli.config.commandHelpSetTemperature': '- :config set temperature <0-2>',
    'cli.config.commandHelpSetTimeout': '- :config set timeout <ms>',
    'cli.config.commandHelpClearApiKey': '- :config clear api-key',
    'cli.config.commandHelpInit': '- :config init',
    'cli.config.errorUnsupportedProvider': '不支持的 provider：{value}',
    'cli.config.errorInvalidMaxTokens': '无效的 max tokens：{value}',
    'cli.config.errorInvalidTemperature': '无效的 temperature：{value}',
    'cli.config.errorInvalidTimeout': '无效的 timeout：{value}',
    'cli.config.errorUnsupportedField': '不支持的配置字段：{value}',
    'cli.config.errorUnsupportedClearField': '不支持清空的配置字段：{value}',
    'cli.config.updated': '配置已更新。',
    'cli.config.cleared': '配置项已清空。',
    'cli.config.updatedField': '- 字段：{value}',
    'cli.config.commandInvalidStatus': '配置命令无效。',
    'cli.config.updatedStatus': '配置已更新。',
    'cli.config.status': '已输出模型配置。',

    'cli.session.title': '当前会话：',
    'cli.session.id': '- 完整 ID：{value}',
    'cli.session.shortId': '- 短 ID：{value}',
    'cli.session.name': '- 标题：{value}',
    'cli.session.mode': '- 模式：{value}',
    'cli.session.workspace': '- 工作区：{value}',
    'cli.session.messageCount': '- 消息数：{value}',
    'cli.session.updatedAt': '- 最近更新时间：{value}',
    'cli.session.status': '已显示当前会话信息。',

    'cli.storage.title': '当前存储设置：',
    'cli.storage.source': '- 生效来源：{value}',
    'cli.storage.currentRoot': '- 当前数据目录：{value}',
    'cli.storage.configPath': '- 当前配置文件：{value}',
    'cli.storage.sessionsPath': '- 当前会话目录：{value}',
    'cli.storage.settingsPath': '- 存储设置文件：{value}',
    'cli.storage.customRoot': '- 已保存的自定义目录：{value}',
    'cli.storage.customRootUnset': '未设置',
    'cli.storage.sourceDefault': '默认目录',
    'cli.storage.sourceSettings': 'settings.json',
    'cli.storage.sourceEnv': '环境变量 ADNIFY_HOME',
    'cli.storage.usage':
      '用法：:storage 查看当前设置，:storage set <path> 设置目录，:storage reset 恢复默认目录。',
    'cli.storage.envOverride':
      '注意：当前存在 ADNIFY_HOME，已保存的目录设置会被环境变量覆盖。',
    'cli.storage.setMissingPath': '缺少目标路径，请在 :storage set 后提供目录。',
    'cli.storage.invalidStatus': '存储目录设置失败：缺少路径。',
    'cli.storage.updated': '已保存新的存储目录设置。',
    'cli.storage.updatedStatus': '新的存储目录已写入设置。',
    'cli.storage.reset': '已恢复为默认存储目录设置。',
    'cli.storage.resetStatus': '已恢复默认存储目录。',
    'cli.storage.status': '已输出当前存储设置。',
    'cli.storage.configMigrated': '- 已复制现有 config.json 到新目录。',
    'cli.storage.sessionsMigrated': '- 已复制现有 sessions 目录到新目录。',
    'cli.storage.migrationSkipped': '- 目标目录已有内容，或当前没有可迁移的数据文件。',
    'cli.storage.restartHint': '请重启 Adnify-Cli，以完整应用新的存储目录。',

    'cli.sessions.title': '最近会话：',
    'cli.sessions.columns': '#  *  id        mode    msgs  updated      title',
    'cli.sessions.empty': '当前还没有可恢复的会话。',
    'cli.sessions.hint': '输入 :resume <序号|id> 可切回对应会话。',
    'cli.sessions.status': '已显示最近会话列表。',
    'cli.sessions.current': '当前',

    'cli.resume.notFound': '未找到目标会话，请先使用 :sessions 查看可恢复的会话。',
    'cli.resume.ambiguous': '匹配到多个会话，请改用更具体的序号、ID 或标题关键词：',
    'cli.resume.suggestions': '你可以试试这些会话：',
    'cli.resume.failedStatus': '恢复失败：未找到目标会话。',
    'cli.resume.status': '已恢复会话 {id}。',

    'cli.clear.output': '会话已清空，但工作区上下文和当前模式仍会保留。',
    'cli.clear.status': '会话已清空。',
    'cli.exit.output': '正在退出 Adnify-Cli...',
    'cli.exit.status': '正在退出 Adnify-Cli...',
    'cli.unknown.output': '未知命令：{command}。输入 /help 查看可用命令。',
    'cli.unknown.status': '命令无法识别。',

    'workspace.summaryTitle': '工作区摘要：',
    'workspace.root': '- 根目录：{value}',
    'workspace.git': '- Git 仓库：{value}',
    'workspace.packageManager': '- 包管理器：{value}',
    'workspace.topLevelEntries': '- 顶层条目：{value}',
    'workspace.none': '无',

    'tool.workspace-read.name': '工作区读取',
    'tool.workspace-read.description':
      '读取仓库结构、包元数据和工作区上下文，为后续决策提供依据。',
    'tool.file-ops.name': '文件操作',
    'tool.file-ops.description':
      '读取、编辑、创建和重构仓库文件，同时保持项目结构和用户意图不被破坏。',
    'tool.shell-runner.name': '终端执行',
    'tool.shell-runner.description':
      '执行终端命令用于检查、构建、测试和定向自动化，同时遵守危险操作审批边界。',
    'tool.search-index.name': '代码检索',
    'tool.search-index.description':
      '搜索代码、符号和项目文本，帮助快速定位实现细节并减少盲改。',
    'tool.category.workspace': '工作区',
    'tool.category.execution': '执行',
    'tool.category.search': '检索',

    'unconfigured.replyHelpTitle': '在完成模型配置前，当前构建不会发送真实模型请求。',
    'unconfigured.replyHelpConfig': '- 输入 :config 查看当前配置状态',
    'unconfigured.replyHelpInit': '- 输入 :config init 启动配置向导',

    'modelPrompt.language.self': '简体中文',
    'modelPrompt.respondIn': 'Unless the user explicitly asks otherwise, respond in {language}.',
    'modelPrompt.currentMode': '当前模式：{mode}',
    'modelPrompt.workspaceRoot': '工作区根目录：{value}',
    'modelPrompt.packageManager': '包管理器：{value}',
    'modelPrompt.gitRepository': 'Git 仓库：{value}',
    'modelPrompt.topLevelEntries': '顶层条目：{value}',
    'modelPrompt.noTools': '- 暂未注册工具。',

    'session.defaultTitle': 'Adnify-Cli 会话',
  },
  en: {
    'assistant.tagline': 'Command your codebase with calm precision.',
    'assistant.description':
      'An AI programming partner for the terminal, focused on clear structure, reliable execution, and stable interaction.',
    'common.by': 'by',
    'common.yes': 'yes',
    'common.no': 'no',

    'app.boot.panelTitle': 'Boot',
    'app.boot.panelSubtitle': 'runtime warmup',
    'app.boot.workspaceName': 'booting',
    'app.boot.modelLabel': 'initializing',
    'app.boot.heading': 'Bootstrapping Adnify-Cli',
    'app.boot.description': 'Preparing runtime services, workspace context, and model configuration.',
    'app.boot.failed': 'Boot failed',

    'header.meta.workspace': 'workspace ',
    'header.meta.package': 'pkg ',
    'header.meta.git': 'git ',
    'header.meta.gitTracked': 'tracked',
    'header.meta.gitDetached': 'detached',

    'empty.hint': 'Start with a goal, a file path, or `/` to open the command palette.',
    'empty.panelSession': 'session',
    'empty.panelQuickStart': 'Quick start',
    'empty.recentSessions': 'Recent sessions',

    'input.panelCommands': 'Commands',
    'input.panelConsole': 'Console',
    'input.panelSetup': 'Setup',
    'input.labelInput': 'input',
    'input.labelPalette': 'palette',
    'input.labelSetup': 'setup',
    'input.labelSetupMode': 'config',
    'input.placeholder': 'Describe the task, or type / to open commands.',
    'input.hintSuggestions': 'Up/Down select  Tab/Enter fill  Esc close',
    'input.hintDefault': 'Enter send  / commands  Up/Down history  Ctrl+O transcript',
    'input.hintConfigInit': 'Enter continue  Esc exit setup',
    'input.panelApproval': 'Approval',
    'input.labelApprovalMode': 'approval',
    'input.hintApproval': 'Enter y or n, then press Enter',

    'status.system': 'system',
    'status.configured': 'configured',
    'status.setupRequired': 'setup required',
    'status.initializing': 'Initializing...',
    'status.notConfigured': 'No model configuration detected yet. Run :config init to set it up.',
    'status.runtimeReady': 'Runtime is ready. You can start working now.',
    'status.sessionRestored': 'Restored recent session {id}.',
    'status.sessionRestoredSetupRequired':
      'Restored recent session {id}, but model setup is still required. Run :config init to continue.',
    'status.configInitCancelled': 'Exited the setup wizard. Run :config init to enter it again.',
    'status.enteringConfigInit': 'Entering model setup wizard...',
    'status.executionFailed': 'Execution failed: {message}',
    'status.responseFailed': 'Response failed: {message}',
    'status.configFailed': 'Configuration failed: {message}',
    'status.configFileInvalid':
      'Configuration file contains invalid JSON: {path}. Fix it and try again, or run :config init.',
    'status.configFileUnreadable': 'Could not read the configuration file: {path}. {message}',
    'status.bootFailedGeneric': 'Boot failed: {message}',
    'status.bootFailedConfigInvalid':
      'Boot failed because the configuration file contains invalid JSON: {path}. Fix it and try again, or run :config init.',
    'status.bootFailedConfigUnreadable':
      'Boot failed because the configuration file could not be read: {path}. {message}',
    'status.executionAborting': 'Aborting current execution...',
    'status.executionAborted': 'Current execution aborted.',
    'status.approvalRequired': 'Approval required before running the requested tool.',
    'status.approvalChoiceRequired': 'Enter y to approve or n to reject the pending tool request.',
    'status.responseCompleted': 'Completed one response.',
    'status.inputIgnored': 'Empty input ignored.',
    'status.hintControls': 'Esc stop · PgUp/PgDn scroll · Ctrl+O transcript',

    'conversation.panelSession': 'Session',
    'conversation.panelConfiguration': 'configuration',
    'conversation.response': 'response',
    'conversation.notice': 'notice',
    'conversation.output': 'output',
    'conversation.localCommand': 'local command',
    'conversation.thinking': 'thinking',
    'conversation.configError': 'Error: {message}',
    'conversation.scrollHidden': '… {count} lines above (PgUp/PgDn to scroll, Esc for latest)',
    'conversation.scrollHiddenOne': '… 1 line above (PgUp/PgDn to scroll, Esc for latest)',
    'conversation.scrollHiddenShort': '… {count} above',
    'conversation.scrollPosition': '… {above} above / {below} below (Esc for latest)',
    'conversation.scrollPositionShort': '… ↑{above} ↓{below}',
    'conversation.scrollTop': '… top reached (Esc for latest)',
    'conversation.hintControls': 'PgUp/PgDn · Ctrl+O',
    'conversation.transcriptTitle': 'TRANSCRIPT',
    'conversation.transcriptHint': 'PgUp/PgDn scroll · Esc latest/close · Ctrl+O close',
    'collapse.hidden': '… {count} more lines hidden',
    'collapse.hiddenOne': '… 1 more line hidden',
    'collapse.hiddenShort': '… {count} more',
    'cli.output.omittedChars': '... content too long, {count} characters omitted ...',

    'transcript.commands': 'commands',
    'transcript.mode': 'mode',
    'transcript.workspace': 'workspace',
    'transcript.tools': 'tools',
    'transcript.model': 'model',
    'transcript.config': 'config',
    'transcript.conversation': 'conversation',
    'transcript.session': 'session',
    'transcript.command': 'command',

    'config.selectProviderTitle': 'Select an AI provider:',
    'config.customProvider': 'Custom OpenAI-compatible endpoint',
    'config.enterIndexContinue': 'Enter the index to continue',
    'config.selectModelTitle': '{provider} selected. Choose a model:',
    'config.defaultSuffix': ' (default)',
    'config.selectModelInstruction': 'Enter the index, or press Enter to use the default model',
    'config.enterApiKey': 'Enter the API key',
    'config.enterBaseUrl': 'Enter the Base URL, for example https://api.example.com/v1',
    'config.confirmTitle': 'Confirm configuration:',
    'config.confirmBaseUrl': 'Base URL: {value}',
    'config.confirmModel': 'Model: {value}',
    'config.confirmApiKey': 'API Key: {value}',
    'config.confirmInstruction': 'Enter y to save or n to cancel',
    'config.rangeError': 'Enter a number between 1 and {max}',
    'config.modelRangeError': 'Enter a number between 1 and {max}, or press Enter',
    'config.baseUrlRequired': 'Base URL is required',
    'config.apiKeyRequired': 'API Key is required',
    'config.confirmChoiceError': 'Enter y or n',
    'config.savedLine1': 'Configuration saved to ~/.adnify-cli/config.json',
    'config.savedLine2': 'Current model: {model} ({baseUrl})',
    'config.savedLine3': 'You can start chatting now, or use :model to switch models later.',

    'approval.panelTitle': 'Tool approval',
    'approval.title': '{tool} wants to run the following operation',
    'approval.riskLabel': 'Risk level: {value}',
    'approval.targetLabel': 'Target path: {value}',
    'approval.instruction': 'y approve   n deny   a always allow this tool in this session',
    'approval.choiceError': 'Enter y, n, or a',
    'approval.deniedByUser': 'You denied this operation: {summary}',
    'approval.approvedStatus': 'Approved: {summary}',
    'approval.deniedStatus': 'Denied: {summary}',
    'approval.alwaysApprovedStatus': 'Approved, and {tool} will not ask again this session',

    'tool.risk.safe': 'safe',
    'tool.risk.careful': 'careful',
    'tool.risk.dangerous': 'dangerous',

    'command.desc.default': 'Run a local command',
    'command.desc.help': 'Show local command list',
    'command.desc.mode.chat': 'Switch to chat mode',
    'command.desc.mode.agent': 'Switch to agent mode',
    'command.desc.mode.plan': 'Switch to plan mode',
    'command.desc.workspace': 'Show current workspace summary',
    'command.desc.status': 'Show current runtime and git status',
    'command.desc.tools': 'Show planned tool catalog',
    'command.desc.doctor': 'Show runtime diagnostics',
    'command.desc.diff': 'Show the current git diff patch',
    'command.desc.review': 'Review the current git diff',
    'command.desc.model': 'Show or switch the current model',
    'command.desc.config': 'Show current model configuration',
    'command.desc.configInit': 'Launch model setup wizard',
    'command.desc.session': 'Show current session details',
    'command.desc.sessions': 'Show recent sessions',
    'command.desc.resume': 'Resume a saved session',
    'command.desc.storage': 'Inspect or change the data directory',
    'command.desc.memory': 'Save or list cross-session memories',
    'command.desc.checkpoint': 'Create a git checkpoint commit',
    'command.desc.undo': 'Undo the last checkpoint',
    'command.desc.skill': 'List or load skill instructions',
    'command.desc.mcp': 'Show connected MCP servers',
    'command.desc.context': 'Show current context usage',
    'command.desc.clear': 'Clear current conversation messages',
    'command.desc.exit': 'Exit Adnify-Cli',

    'cli.help.title': 'Local commands:',
    'cli.help.status': 'Local command help displayed.',
    'cli.mode.invalidOutput': 'Invalid mode. Available modes: {modes}',
    'cli.mode.invalidStatus': 'Mode switch failed. Check the command arguments.',
    'cli.mode.changedOutput': 'Session mode switched to {mode}.',
    'cli.mode.changedStatus': 'Current mode: {mode}',
    'cli.workspace.status': 'Workspace summary displayed.',
    'cli.status.title': 'Current status:',
    'cli.status.gitChanges': 'Git changes:',
    'cli.status.clean': 'Working tree is clean.',
    'cli.status.noCommits': 'No commits yet',
    'cli.status.upToDate': 'up to date',
    'cli.status.aheadBy': 'ahead by {count}',
    'cli.status.behindBy': 'behind by {count}',
    'cli.status.countStaged': '{count} staged',
    'cli.status.countUnstaged': '{count} unstaged',
    'cli.status.countUntracked': '{count} untracked',
    'cli.status.staged': 'Staged changes:',
    'cli.status.unstaged': 'Unstaged changes:',
    'cli.status.untracked': 'Untracked files:',
    'cli.status.notGit': 'The current workspace is not a Git repository.',
    'cli.status.status': 'Displayed current status.',
    'cli.status.failed': 'Showing current status failed: {message}',
    'cli.doctor.title': 'Runtime diagnostics:',
    'cli.doctor.ready': 'Runtime looks ready.',
    'cli.doctor.setupRequired': 'Model setup is still required. Run :config init first.',
    'cli.doctor.status': 'Displayed runtime diagnostics.',
    'cli.diff.title': 'Current diff:',
    'cli.diff.noChanges': 'No current git diff was found.',
    'cli.diff.status': 'Displayed the current diff.',
    'cli.diff.notGit': 'The current workspace is not a Git repository, so :diff is unavailable.',
    'cli.diff.failed': 'Showing diff failed: {message}',
    'cli.review.title': 'Code review results:',
    'cli.review.clean': 'No obvious issues found.',
    'cli.review.noChanges': 'No current git diff was found to review.',
    'cli.review.findings': 'Findings:',
    'cli.review.summary': 'Review summary:',
    'cli.review.changedFiles': 'Changed files:',
    'cli.review.stagedFocus': 'Staged focus:',
    'cli.review.unstagedFocus': 'Unstaged focus:',
    'cli.review.priorityFiles': 'Suggested files to inspect first:',
    'cli.review.status': 'Reviewed the current diff.',
    'cli.review.notGit': 'The current workspace is not a Git repository, so :review is unavailable.',
    'cli.review.failed': 'Code review failed: {message}',
    'cli.tools.title': 'Planned tool catalog:',
    'cli.tools.summary': '{count} tools available',
    'cli.tools.status': 'Tool catalog displayed.',
    'cli.model.current': 'Current model: {model} ({baseUrl})',
    'cli.model.providersTitle': 'Available providers:',
    'cli.model.noProviders':
      'No additional providers are configured yet. Add them under providers in ~/.adnify-cli/config.json.',
    'cli.model.usage': 'Usage: :model <provider> [model]',
    'cli.model.example': 'Example: :model openai gpt-5',
    'cli.model.unavailable':
      'This runtime does not support live model switching. Use :config or :config init to update the active model.',
    'cli.model.unavailableStatus': 'This runtime does not support model switching.',
    'cli.model.providerMissing':
      'Provider "{provider}" does not exist or has no configured models.\nAvailable providers: {available}',
    'cli.model.providerMissingStatus': 'Switch failed: provider {provider} was not found',
    'cli.model.switchedOutput': 'Switched to {model} ({baseUrl})',
    'cli.model.switchedStatus': 'Current model: {model}',

    'cli.config.unset': 'not configured',
    'cli.config.title': 'Current model configuration:',
    'cli.config.provider': '- Provider: {value}',
    'cli.config.apiKey': '- API Key: {value}',
    'cli.config.baseUrl': '- Base URL: {value}',
    'cli.config.model': '- Model: {value}',
    'cli.config.maxTokens': '- Max Tokens: {value}',
    'cli.config.temperature': '- Temperature: {value}',
    'cli.config.timeout': '- Timeout: {value}ms',
    'cli.config.dataRoot': '- Data root: {value}',
    'cli.config.configFile': '- Config file: {value}',
    'cli.config.sessionsDir': '- Sessions dir: {value}',
    'cli.config.howTo': 'Configuration methods:',
    'cli.config.howToFile': '1. Create ~/.adnify-cli/config.json',
    'cli.config.howToEnv':
      '2. Or set environment variables: ADNIFY_API_KEY, ADNIFY_BASE_URL, ADNIFY_MODEL, ADNIFY_PROVIDER',
    'cli.config.commandHelpTitle': 'Command-driven setup:',
    'cli.config.commandHelpSetProvider':
      '- :config set provider <openai-compatible|openai-responses|anthropic|google>',
    'cli.config.commandHelpSetModel': '- :config set model <model>',
    'cli.config.commandHelpSetApiKey': '- :config set api-key <key>',
    'cli.config.commandHelpSetBaseUrl': '- :config set base-url <url>',
    'cli.config.commandHelpSetMaxTokens': '- :config set max-tokens <number>',
    'cli.config.commandHelpSetTemperature': '- :config set temperature <0-2>',
    'cli.config.commandHelpSetTimeout': '- :config set timeout <ms>',
    'cli.config.commandHelpClearApiKey': '- :config clear api-key',
    'cli.config.commandHelpInit': '- :config init',
    'cli.config.errorUnsupportedProvider': 'Unsupported provider: {value}',
    'cli.config.errorInvalidMaxTokens': 'Invalid max tokens: {value}',
    'cli.config.errorInvalidTemperature': 'Invalid temperature: {value}',
    'cli.config.errorInvalidTimeout': 'Invalid timeout: {value}',
    'cli.config.errorUnsupportedField': 'Unsupported config field: {value}',
    'cli.config.errorUnsupportedClearField': 'Unsupported clear field: {value}',
    'cli.config.updated': 'Configuration updated.',
    'cli.config.cleared': 'Configuration field cleared.',
    'cli.config.updatedField': '- Field: {value}',
    'cli.config.commandInvalidStatus': 'Invalid config command.',
    'cli.config.updatedStatus': 'Configuration updated.',
    'cli.config.status': 'Model configuration displayed.',

    'cli.session.title': 'Current session:',
    'cli.session.id': '- Full ID: {value}',
    'cli.session.shortId': '- Short ID: {value}',
    'cli.session.name': '- Title: {value}',
    'cli.session.mode': '- Mode: {value}',
    'cli.session.workspace': '- Workspace: {value}',
    'cli.session.messageCount': '- Message count: {value}',
    'cli.session.updatedAt': '- Last updated: {value}',
    'cli.session.status': 'Current session details displayed.',

    'cli.storage.title': 'Current storage settings:',
    'cli.storage.source': '- Effective source: {value}',
    'cli.storage.currentRoot': '- Active data root: {value}',
    'cli.storage.configPath': '- Active config file: {value}',
    'cli.storage.sessionsPath': '- Active sessions dir: {value}',
    'cli.storage.settingsPath': '- Storage settings file: {value}',
    'cli.storage.customRoot': '- Saved custom root: {value}',
    'cli.storage.customRootUnset': 'not set',
    'cli.storage.sourceDefault': 'default location',
    'cli.storage.sourceSettings': 'settings.json',
    'cli.storage.sourceEnv': 'ADNIFY_HOME environment variable',
    'cli.storage.usage':
      'Usage: :storage shows the current setup, :storage set <path> saves a custom directory, :storage reset returns to the default location.',
    'cli.storage.envOverride':
      'Note: ADNIFY_HOME is currently set, so the saved storage directory is being overridden by the environment.',
    'cli.storage.setMissingPath': 'Missing target path. Provide a directory after :storage set.',
    'cli.storage.invalidStatus': 'Storage update failed: missing path.',
    'cli.storage.updated': 'Saved a new storage directory.',
    'cli.storage.updatedStatus': 'The storage directory setting was updated.',
    'cli.storage.reset': 'Storage directory reset to the default location.',
    'cli.storage.resetStatus': 'Storage directory reset.',
    'cli.storage.status': 'Storage settings displayed.',
    'cli.storage.configMigrated': '- Existing config.json was copied to the new directory.',
    'cli.storage.sessionsMigrated': '- Existing sessions were copied to the new directory.',
    'cli.storage.migrationSkipped':
      '- The target already had data, or there was nothing available to migrate.',
    'cli.storage.restartHint': 'Restart Adnify-Cli to fully apply the new storage location.',

    'cli.sessions.title': 'Recent sessions:',
    'cli.sessions.columns': '#  *  id        mode    msgs  updated      title',
    'cli.sessions.empty': 'No sessions found yet.',
    'cli.sessions.hint': 'Use :resume <index|id> to switch back to a session.',
    'cli.sessions.status': 'Recent sessions displayed.',
    'cli.sessions.current': 'current',

    'cli.resume.notFound': 'Session not found. Run :sessions to see available items.',
    'cli.resume.ambiguous': 'Multiple sessions matched that query.',
    'cli.resume.suggestions': 'You can try one of these:',
    'cli.resume.failedStatus': 'Resume failed: session not found.',
    'cli.resume.status': 'Resumed session {id}.',

    'cli.clear.output': 'Conversation cleared. Workspace context and current mode were kept.',
    'cli.clear.status': 'Conversation cleared.',
    'cli.exit.output': 'Exiting Adnify-Cli...',
    'cli.exit.status': 'Exiting Adnify-Cli...',
    'cli.unknown.output': 'Unknown command: {command}. Type /help to see available commands.',
    'cli.unknown.status': 'Command could not be recognized.',

    'workspace.summaryTitle': 'Workspace summary:',
    'workspace.root': '- Root path: {value}',
    'workspace.git': '- Git repository: {value}',
    'workspace.packageManager': '- Package manager: {value}',
    'workspace.topLevelEntries': '- Top-level entries: {value}',
    'workspace.none': 'none',

    'tool.workspace-read.name': 'Workspace Read',
    'tool.workspace-read.description':
      'Read repository structure, package metadata, and workspace context to ground later decisions.',
    'tool.file-ops.name': 'File Ops',
    'tool.file-ops.description':
      'Read, edit, create, and refactor repository files while preserving project structure and user intent.',
    'tool.shell-runner.name': 'Shell Runner',
    'tool.shell-runner.description':
      'Run terminal commands for inspection, build, test, and targeted automation while respecting approval boundaries.',
    'tool.search-index.name': 'Search Index',
    'tool.search-index.description':
      'Search code, symbols, and project text to locate implementation details quickly and avoid blind edits.',
    'tool.category.workspace': 'Workspace',
    'tool.category.execution': 'Execution',
    'tool.category.search': 'Search',

    'unconfigured.replyHelpTitle':
      'This build will not send real model requests until model setup is complete.',
    'unconfigured.replyHelpConfig': '- Run :config to inspect the current configuration',
    'unconfigured.replyHelpInit': '- Run :config init to start the setup wizard',

    'modelPrompt.language.self': 'English',
    'modelPrompt.respondIn': 'Unless the user explicitly asks otherwise, respond in {language}.',
    'modelPrompt.currentMode': 'Current mode: {mode}',
    'modelPrompt.workspaceRoot': 'Workspace root: {value}',
    'modelPrompt.packageManager': 'Package manager: {value}',
    'modelPrompt.gitRepository': 'Git repository: {value}',
    'modelPrompt.topLevelEntries': 'Top-level entries: {value}',
    'modelPrompt.noTools': '- No tools registered.',

    'session.defaultTitle': 'Adnify-Cli Session',
  },
} as const

type MessageCatalog = typeof messages
type MessageKey = keyof MessageCatalog['zh-CN']

export class AppI18n {
  constructor(public readonly locale: AppLocale) {}

  t(key: MessageKey, variables?: TranslationVariables): string {
    const template = this.maybeT(key, variables)
    if (!template) {
      throw new Error(`Missing translation for key: ${key}`)
    }

    return template
  }

  maybeT(key: string, variables?: TranslationVariables): string | null {
    const catalog = messages[this.locale] as Record<string, string>
    const fallbackCatalog = messages['zh-CN'] as Record<string, string>
    const template = catalog[key] ?? fallbackCatalog[key]

    if (!template) {
      return null
    }

    return formatTemplate(template, variables)
  }
}

export function createAppI18n(locale: AppLocale): AppI18n {
  return new AppI18n(locale)
}

export function resolveAppLocale(input?: string | null): AppLocale {
  if (!input) {
    return 'en'
  }

  const normalized = input.toLowerCase()

  if (normalized.startsWith('zh')) {
    return 'zh-CN'
  }

  if (normalized.startsWith('en')) {
    return 'en'
  }

  return 'en'
}

export function resolveAppLocaleFromEnv(
  env: Record<string, string | undefined> = getRuntimeEnvironment(),
): AppLocale {
  const candidates = [
    env.ADNIFY_LOCALE,
    env.LC_ALL,
    env.LC_MESSAGES,
    env.LANG,
    getRuntimeLocale(),
  ]

  for (const candidate of candidates) {
    if (candidate) {
      return resolveAppLocale(candidate)
    }
  }

  return 'en'
}

function getRuntimeEnvironment(): Record<string, string | undefined> {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> }
  }

  return runtime.process?.env ?? {}
}

function getRuntimeLocale(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale
  } catch {
    return undefined
  }
}

function formatTemplate(template: string, variables?: TranslationVariables): string {
  if (!variables) {
    return template
  }

  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = variables[key]
    return value === undefined || value === null ? '' : String(value)
  })
}
