# Changelog - feat/nuwaxcode 分支

本文档总结了 `feat/nuwaxcode` 分支相对于主分支的主要更改。

## Unreleased

### 🐛 修复

- **ACP 子智能体权限询问转发**：Task 派生的子会话（不在 ACP 会话注册表内）发出的 permission ask 此前被 `acp/permission.ts` 静默丢弃，导致子智能体无限等待、父会话 Task 卡死。现沿 `parentID` 链上溯，以已注册祖先会话身份转发 `session/request_permission`（上游 v1.18.20 已修 `opencode run` 模式同类问题，ACP 路径上游至今未修）；无法解析到任何已注册祖先的 ask 改为快速 `reject` 并输出 warn 日志，不再无限挂起。

### ✨ 新特性 / 改进

- **权限询问有界等待**：新增 `experimental.permission_ask_timeout_ms` 配置（默认 1800000 即 30 分钟，`0` 禁用）。无人应答的 permission ask 超时后按 `reject` 收场并发布 `permission.replied` 终态事件，任何路由缺口从"永久挂死"变为"快速失败"。

---

## v1.3.18 (2026-06-30)

> 正式版（npm `latest`）。版本号跳过 `1.3.0`–`1.3.17`：仓库内 `v1.3.0`–`v1.3.17` tag 已被上游 opencode 同步历史占用，避免 force-push 冲突。

### ✨ 新特性 / 改进（自 v1.2.3 稳定版以来）

- **Agent 权限**：未列出工具（含 MCP）及 `edit`、`bash` 默认 `ask`，需 ACP 客户端审批；`webfetch`、`grep`、`task` 等其它内置工具仍为 `allow`。
- **模型目录**：同步 models.dev（含 Kimi K2.7 Code、GLM-5.2 等新增与下线模型）。
- **ACP / 模型解析**：信任 `OPENCODE_MODEL` 配置并在 config 中注册 provider+model，恢复默认模型选择行为。
- **发版**：预发布版本自动发布到 npm `beta` dist-tag，稳定版发布到 `latest`。

---

## v1.3.0-beta.11 (2026-06-28)

### 🔄 行为变更

- **Agent 权限**：`edit`、`bash` 不再显式 `allow`，与 MCP 一样走默认 `*: ask`，需 ACP 客户端审批；`webfetch`、`grep`、`task` 等其它内置工具仍为 `allow`。

---

## v1.3.0-beta.10 (2026-06-28)

### 🐛 修复

- **Agent 权限**：未列出的工具（含 MCP）默认 `ask`，需 ACP 客户端审批；内置工具（edit、bash、read 等）保持显式 `allow`。

---

## v1.3.0-beta.9 (2026-06-17)

### ✨ 模型目录

- 同步 models.dev：新增 Kimi K2.7 Code、GLM-5.2 等 19 个模型；移除 6 个已下线模型。

---

## v1.2.3 (2026-06-01)

### 🔄 发版 / CI

- **build-release**: 仅 `push tag v*` 触发；构建前拉取 models.dev；npm 发布与校验统一走 `scripts/release-publish.sh`（与本地 `release.sh` 一致）。

### 🐛 修复

- 延续 v1.2.2：无 AVX2 机器 CLI 静默退出、nuwaxcode-* 包名与 baseline 解析（见 v1.2.2）。

---

## v1.2.2 (2026-06-01)

### 🐛 修复

- **CLI / 无 AVX2**: 修复 `nuwaxcode` 在无 AVX2 CPU 上静默退出（SIGILL 被当作 exit 0）；入口直接解析 `node_modules` 中的 `nuwaxcode-*`（含 baseline，`opencode-*` 兜底），不再使用 `bin/.opencode`；postinstall 仅校验平台包已安装。

### 🔄 CI

- **build-release**: 打 tag 后除 GitHub Release 外，自动执行 npm 发布（`publish-npm` job，需配置 `NPM_TOKEN`）。

---

## v1.2.1 (2026-05-17)

> 仅 GitHub Release（`git tag v1.2.1` → `build-release.yml`），**不发 npm**。

### ✨ 新特性

- **Sandbox（≥1.2.0）**: 原生 OpenCode `config.sandbox`（strict / compat / permissive），工具层同步 path guard，与 Nuwaclaw Electron 客户端对接。

### 🐛 修复

- 避免向旧版注入 `OPENCODE_CONFIG_CONTENT.sandbox` 导致 `Unrecognized key: sandbox` 崩溃。

---

## v1.1.99 (2026-05-13)

### 🐛 修复

- **ACP / System Prompt**: 增加 `session/new` 的 `systemPrompt` 多来源兼容解析（`_meta.systemPrompt`、`_meta.system_prompt`、顶层同名字段），避免不同客户端字段命名差异导致 system prompt 丢失。
- **ACP / 日志**: 保留轻量关键日志（来源 + 是否命中），避免高频/重日志影响主流程可读性。

---

## v1.1.98 (2026-05-13)

### 修复

- **ACP**: 恢复 `session/new` 时 `params._meta.systemPrompt` 的读取与保存，并在普通 `prompt` 调用中映射为 `session.prompt` 的 `system` 字段（与历史 claude-code-acp 约定及先前 1.1.x 行为一致）。

---

## v1.1.68 (2026-03-31)

### 🐛 修复

- **ACP/MCP 初始化**: `non_blocking` 模式下 MCP 初始化超时后会清理等待句柄，避免后续 prompt 重复等待同一超时窗口导致首字延迟累积。
- **MCP 批量加载**: `addBatch` 增加单 server 异常隔离，`create()` 抛错时不会中断整批加载，并补充 `create_threw` summary 日志便于排障。

---

## v1.1.67 (2026-03-31)

### ✨ 新特性

- **Logging**: ACP 全链路日志增强，补充 request/session 关联信息与端到端排障观测字段，便于定位首包与 MCP 初始化链路问题。

---

## v1.1.66 (2026-03-30)

### 🔄 优化

- **MCP 懒加载**: ACP `newSession` 不再同步等待 MCP 服务器连接建立，改为 fire-and-forget 后台初始化，首次 `prompt` 时按需等待。`acp.session.create` 耗时从 ~2890ms 降至 ~10ms，与 claude-code 一致。
- **CI 标准化**: 新增 tag 触发的 `build-release.yml` 工作流，单 runner 通过 Bun 跨平台编译构建全部 11 个目标（darwin/linux/windows 含 baseline、musl 变体），自动创建 GitHub Release 并上传全部 13 个平台资产。

---

## v1.1.62 (2026-01-25)

### 🐛 修复

- **Session**: 修复 `SessionProcessor` 无限重试导致的僵尸进程问题 (防止无限循环，限制最大重试次数为 10)。

---

## v1.1.61 (2026-01-25)

### 🔄 优化

- **Performance**: 实现 **TUI 懒加载**。移除了 ACP 模式下对 React/Blessed 等重型 UI 库的静态导入，显著降低了 headless 模式下的内存开销（~70%）和容器启动时间（~50%）。
- **Latency**: ACP 冷启动速度由之前的分钟级降低至 **26s** 左右。

---

## v1.1.60 (2026-01-25)

### 🔄 优化

- **MCP**: 实现 **MCP Batch API**。在 ACP 会话初始化时，通过一个批处理调用同时连接多个 MCP 服务器，将 HTTP 往返开销由 O(N) 降低至 O(1)。
- **Throughput**: 极大提升了在高并发环境下的连接复用速度（典型热启动耗时缩短至 **30s** 左右，相比之前提升 ~200%）。

---

## v1.1.59 (2026-01-25)

### 🔄 优化

- **MCP**: 实现 **MCP Tools 缓存** (5s TTL)。避免在单次 prompt 处理中重复调用昂贵的 `listTools()` RPC。
- **MCP**: 实现 **MCP 连接池 (Connection Pooling)**。支持根据配置哈希复用已存在的 MCP 客户端，避免重复启动子进程。
- **Initialization**: 并行化 `loadSessionMode` 中的配置加载逻辑（providers/agents/commands 并行获取）。

---

## v1.1.56 (2026-01-23)

### 🐛 修复

- **ACP**: 修复接收 `question.asked` 事件时请求权限导致的无限阻塞问题。

---

## v1.1.55 (2026-01-23)

### ✨ 新特性

- **Config**: 支持 `max_context_tokens` 配置选项。

### 🐛 修复

- **Provider**: 修复自定义加载器中 provider 未定义的边缘情况。

---

## v1.1.54 (2026-01-23)

### ✨ 新特性

- **Config**: 支持通过配置项和环境变量设置 `max_tokens`。

---

### 🐛 修复

- **Config**: 支持在 Linux 上读取固定路径 `/root/.config/opencode/opencode.json` 的配置文件。

---

## v1.1.52 (2026-01-22)

### 🐛 修复

- **Logging**: 修复日志初始化过晚导致早期日志泄漏到终端的问题，实现同步早期初始化。
- **MCP**: 修复本地 MCP 服务器启动时因 stderr 流不兼容导致的 `TODO: stream.Readable stdio @ 2` 错误。
- **Debug**: 增强 MCP 工具加载调试日志，包含详细的启动命令、环境信息及工具列表追踪。
- **Dependencies**: 修复 `optionalDependencies` 版本同步逻辑。

---

## v1.1.51 (2026-01-22)

### 🔄 优化

- **Logging**: 更新日志文件名格式，包含具体时间 (HHmmss) 以提高区分度。

---

## v1.1.50 (2026-01-22)

### 🐛 修复

- **Dependencies**: 修复 `optionalDependencies` 版本不同步的问题，确保所有平台二进制包版本一致。

---

## v1.1.49 (2026-01-22)

### ✨ 新特性

- **Logging**: 新增初始化性能追踪 (`bun.install`, `plugin.load`, `provider.state`)，帮助诊断启动耗时。
- **ACP**: `acp.message.part` 事件现在记录双向消息（用户输入与模型回复），提供完整会话视图。
- **Config**: 增强配置日志，`system.env` 和 `config.load` 现在包含完整的（已脱敏）配置状态。

### 📝 文档

- **CONFIGURATION**: 更新中文配置文档，新增 "Observability & Log Reference" 章节，详细列出所有日志事件及其含义。

---

## v1.1.48

### 🐛 修复

- **ACP Model Selection**: 修复 Title Agent 错误使用 `gpt-5-nano` 的问题。
- **Prompts**: 更新 prompts 中的品牌名称。

---

## v1.1.47

### 🔄 优化

- **Logging**: 优化日志文件名，添加随机后缀以确保每次会话生成独立的日志文件。

---

## 🎉 主要变更

### 项目重命名

- 将项目从 `opencode` 重命名为 `nuwaxcode`
- 移除 `@xagi` 命名空间，包名改为 `nuwaxcode`
- 更新 TUI 和 CLI 品牌标识为 'nuwax' 风格

### 版本发布

- 当前版本: **v1.1.45**
- 主要版本迭代: v1.1.27 → v1.1.45

---

## ✨ 新特性

### 环境变量配置支持

- **`OPENCODE_MODEL`**: 支持通过环境变量配置模型
- **`OPENCODE_LOG_DIR`**: 支持通过环境变量配置日志目录
- **`OPENCODE_API_BASE`**: 支持自定义 API 基础地址
- **`OPENCODE_API_KEY`**: 支持通过环境变量配置 API 密钥
- **Anthropic 环境变量**: 独立支持 Anthropic 相关环境变量配置

### 动态模型加载器

- 添加 OpenAI-compatible 动态模型提供器
- 添加 Anthropic 动态加载器支持
- 添加 Anthropic-compatible 动态加载器支持

### 日志系统增强

- 支持通过 `--log-dir` 参数指定日志目录
- 实现每日日志文件命名规则
- 添加日志目录配置、每日轮换、显式刷新功能
- 支持记录系统提示词 (System Prompt)
- 默认禁用文件日志，除非配置了 log-dir

### ACP 功能增强

- 支持通过 `_meta` 在 ACP 会话创建时传递系统提示词
- 添加 ACP 系统提示词测试
- 将系统提示词传递给 agent 调用

### 构建与发布

- 添加 Linux musl libc 支持
- 更新发布工作流

---

## 🐛 修复

- 修复 OpenAI-compatible 提供器动态加载问题
- 修复 'require is not defined' 错误 (将入口点转换为 ESM)
- 修复 `catalog:` 协议导致的安装失败问题 (替换为具体版本号)
- 隔离 Anthropic 环境变量与通用 opencode API 变量
- 修复构建依赖问题
- 修复 `AI_APICallError` 401: 移除 `opencode` provider 的 `gpt-5-nano` 自动回退

---

## 📝 文档

- 添加安装说明
- 添加配置指南
- 更新中文配置文档
- 添加 Zed 调试说明
- 添加环境变量配置说明（独立章节）
- 添加旧版环境变量兼容性说明

---

## 🔧 其他更改

- 添加 `.agent` 到 `.gitignore`
- 升级 Bun 到 1.3.6
- 更新各项依赖
- 添加环境变量配置测试

---

## 📋 提交列表

| Commit      | 描述                                                             |
| ----------- | ---------------------------------------------------------------- |
| `d1b4ffd09` | docs: 更新中文配置文档                                           |
| `60a8e8737` | docs: 更新中文配置文档，添加 nuwaxcode 更新日志                  |
| `5460ee74a` | feat: 移除 `@xagi` 命名空间，添加 musl libc 支持，更新发布工作流 |
| `65909a003` | docs: 添加安装说明                                               |
| `202fc626c` | fix: 支持 openai/anthropic 兼容模型并更新文档                    |
| `b2aa930b3` | feat: 添加 anthropic-compatible 动态加载器支持                   |
| `1d58132b9` | feat: 添加 anthropic 动态加载器支持                              |
| `3432fd729` | fix: 解决 openai-compatible 提供器动态加载问题                   |
| `58fe4c7e5` | refactor: 重命名项目为 nuwaxcode，更新元数据                     |
| `cde6e3c9b` | feat: 添加动态 OpenAI-compatible 模型提供器                      |
| `6e1babf0d` | test: 添加环境变量配置测试                                       |
| `cad247ab8` | feat: 支持通过环境变量配置模型和日志目录                         |
| `7f3c369b8` | feat: 支持 anthropic 环境变量配置                                |
| `56c046702` | feat: 支持 OPENCODE_API_BASE 和 OPENCODE_API_KEY                 |
| `caedaf621` | feat: 支持 OPENCODE_MODEL 环境变量                               |
| `7dbf78cd4` | fix: 默认禁用文件日志                                            |
| `5028d2a15` | feat: 支持 OPENCODE_LOG_DIR 环境变量                             |
| `8cbea8543` | feat: 记录系统提示词，版本升级至 v1.1.39                         |
| `a77897b26` | feat: 增强日志管理系统                                           |
| `f5e1c585a` | feat: 支持 --log-dir 参数                                        |
| `5942b827a` | feat: 支持通过 ACP \_meta 传递系统提示词                         |
| `fbb501fd8` | refactor: 重命名 opencode 为 nuwaxcode                           |
| `653450621` | feat: 重命名并添加 ACP meta systemPrompt 支持                    |

---

_生成日期: 2026-01-21_
