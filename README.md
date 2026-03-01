# MindWeave

MindWeave 是一个本地运行的 Agent 操作系统：把本地目录转换为可检索的 Markdown 镜像知识空间，并通过对话驱动 Agent 完成查询、修改与生成。

## 特性

- 本地工作空间接入与同步：将目录内容同步为 Markdown 镜像
- 对话式交互：前端 UI + 后端 API（SSE）流式输出
- 工具调用：文件系统读写、网页抓取等（以 Agent 自动化为第一原则）
- 桌面端壳：Electron 运行前端并承载主进程能力

## 目录结构

- electron/：Electron 主进程与本地 API Server
- src/：前端（Vite + React）
- tests/：单测与示例脚本（Node 原生 test runner）
- vendor/：第三方/示例代码（不属于本仓主运行路径）

## 环境要求

- Node.js（建议使用较新的 LTS 版本）
- npm

## 快速开始

安装依赖：

```bash
npm i
```

启动 Web + API（推荐）：

```bash
npm run dev
```

- Web：`http://127.0.0.1:5173`
- API：`http://127.0.0.1:3189`

启动 Electron 桌面端：

```bash
npm run electron
```

注意：Electron 主进程会加载 `http://127.0.0.1:5173`，请确保 Web 开发服务器已启动。

## 配置（.env）

项目会从根目录 `.env` 读取配置（也支持直接设置环境变量）。

常用配置项：

- ARK_API_KEY：模型服务 Key
- ARK_BASE_URL：模型服务 Base URL（默认 https://ark.cn-beijing.volces.com/api/v3）
- DOUBAO_DEFAULT_MODEL：默认模型（默认 doubao-seed-2-0-lite-260215）
- DEBUG_MODEL_IO：是否输出模型输入输出日志（true/false）
- DEBUG_MODEL_IO_VERBOSE：更详细的模型日志（true/false）
- DEBUG_MODEL_IO_MAX_CHARS：单条日志最大字符数（默认 2000）
- MIRROR_VISIBLE_EXTS：镜像里允许被读取/展示的扩展名列表（逗号/空格/分号分隔，或用 `*` 表示全部）
- MIRROR_SHOW_BACKUPS：是否在镜像中展示备份文件（true/false）
- AGENTOS_API_HOST：API 监听地址（默认 127.0.0.1）
- AGENTOS_API_PORT：API 监听端口（默认 3189）
- AGENTOS_PYTHON_BIN：文档转换使用的 Python 命令（可选；Windows 可设为 `py` 或 `python`）

## 常用命令

- `npm run dev:web`：启动 Vite Web 开发服务器
- `npm run dev:api`：启动本地 API Server（会先构建 Electron 侧代码）
- `npm run build`：构建 Web + Electron（生成 dist 与 dist-electron）
- `npm run typecheck`：TypeScript 类型检查
- `npm run sample:fetch-webpage`：运行一个网页抓取示例

## 测试

本仓测试放在 `tests/` 目录下：

```bash
npm --prefix tests run test:unit
npm --prefix tests run test:api
npm --prefix tests run test:chat-ui
npm --prefix tests run test:all
```

## 架构概览

- 前端（src/）通过 HTTP 调用本地 API（默认 `http://127.0.0.1:3189`），并通过 SSE 获取流式输出
- API Server（electron/api-server.ts）提供 workspace/sync/mirror/readFile/chat 等接口
- Agent 运行时（electron/core/）负责模型调用、工具编排与流式输出

## 项目约束

- 禁止使用 embedding、向量数据库与任何 RAG 技术路线
- 系统设计与实现以 Agent 可自动化为第一原则

## 贡献

建议先阅读：

- AGENTS.md：项目级约束与工作准则
