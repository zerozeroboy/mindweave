# 对话框输入区样式隔离方案

## 目标

- 让“输入框 + 附加功能按钮（含联网搜索）”成为一个统一的输入容器
- 防止全局 CSS 对对话框内部结构造成样式污染
- 保持响应式一致性，并提供 hover/active 交互态

## 方案概述

本项目将对话框（ProChat）相关样式从全局 [App.css](file:///c:/Users/zheng/dev/AgentOS/src/App.css) 中剥离，集中到组件级 CSS Module：

- [chatUi.module.css](file:///c:/Users/zheng/dev/AgentOS/src/components/ChatArea/chatUi.module.css)

并通过在 ProChat 根节点挂载 `styles.proChatRoot`，把对第三方库 class 的覆盖限制在对话框范围内。

## 关键做法

### 1) CSS Modules + :global 精准覆盖第三方 DOM

第三方组件（如 `@ant-design/pro-chat`）的 DOM class 不受 CSS Modules 命名空间影响，因此需要使用：

- `:global(.ant-pro-chat-...)` 指定要覆盖的库 class
- 但必须放在 `.proChatRoot` 作用域下，避免全局污染

示例（实际代码在 chatUi.module.css 中）：

- `.proChatRoot :global(.ant-pro-chat-input-area) { ... }`
- `.proChatRoot :global(.ant-pro-chat-list) { ... }`

### 2) 统一输入容器结构

对话输入区通过 `inputAreaRender` 渲染为一个容器（上方输入、下方按钮），保证“联网搜索”在输入框内部结构中：

- 外层粘滞容器：`styles.inputAreaOuter`（承接对话框底部 sticky 与外边距）
- 外层输入壳：`styles.inputShell`
- 左下角工具区：`styles.toolbox`（放联网搜索按钮）
- 右下角发送区：复用 ProChat 内置发送按钮（通过重设 ProChat 容器为非 sticky/无 padding，让按钮绝对定位参照 `styles.inputShell`）

空线程欢迎页同样使用同一套容器视觉结构：

- 外层容器：`styles.welcomeInputShell`
- 左下角工具区：`styles.toolbox`
- 右下角发送按钮：`styles.welcomeBottomRight`

### 3) 防止外部样式覆盖

- 对话框相关样式不再依赖全局 `.ant-pro-chat-...` 选择器
- 覆盖仅在 `styles.proChatRoot` 包裹范围内生效
- App.css 仅保留真正需要全局生效的内容（如滚动条、基础变量、全局圆角体系）

## 扩展建议

- 新增更多“附加功能”按钮：直接在 `inputAreaRender` 的 `styles.toolbox` 中追加即可，保持 `gap` 一致
- 如需按产品习惯微调按钮布局：优先改 `chatUi.module.css` 的 `.toolbox`、`.toolButton`、`.toolButtonActive`
