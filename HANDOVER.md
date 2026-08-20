# CAID 项目交接文档

> 交接给 TreaWork · 2026-08-20 · 扩展版本 v0.3.2 · 文档定位：让接手者 30 分钟内跑通开发、理解架构、避开所有已知坑。

---

## 1. 项目是什么

**CAID**（**C**opilot + **A**I + **I**ntegrated **D**ashboard）——装进浏览器新标签页的程序员工作台，更是一个可编程的浏览器插件平台。

- Chromium 扩展（MV3，Chrome + Edge 双发），纯前端、零构建、零后端、无 npm 依赖
- 新标签页接管为工作台（搜索 / 快捷方式 / 代码片段 / 待办 / 服务器探活 / 插件）
- **跨页 AI 副驾**：任意网页右下角浮动按钮唤起，MAIN world 运行，12+1 个工具，能读页面、跑 JS、搜索、导航、续传任务
- **轻量插件系统**：用户手写 JS 插件（三视图），AI 副驾还能用 `create_plugin` 现场给你造插件
- **免费 AI 副驾不要 Key**：默认走第三方免费代理（代持 DashScope Key，模型锁 `qwen3.5-plus`）；也可填自己的 baseURL + Key 直连

## 2. 仓库 / 线上 / 推送

| 项 | 值 |
| --- | --- |
| GitHub 仓库 | `https://github.com/CqwqY/CAID.git`（分支 `main`，push 即部署） |
| GitHub Pages | `https://graduate.dpdns.org/`（**主站已暂停维护**，仅存档展示） |
| 本地开发 | `caid-extension/` 目录；Chrome 扩展管理页 → 开发者模式 → 加载已解压 |
| **推送铁律** | **沙箱/CI 环境 push 必失败**（schannel `CRYPT_E_NO_REVOCATION_CHECK` + 无凭据），`git push` 必须由真机执行；沙箱 `git -c http.sslVerify=false fetch` 可拉取 |
| 历史注意 | 2026-08-19 已用 `filter-branch` 重写历史（195→139 commits）清除 `.workbuddy` 痕迹，**其他设备 clone 需 `git fetch && git reset --hard origin/main`** 或重新 clone |

## 3. 开发重心（重要）

- **主站**（`index.html` 单文件版）**暂停维护**，仅存档
- **全力开发扩展** `caid-extension/`；**插件系统是核心方向**，副驾是最大特色
- 宣发状态：README 已按"插件优先"重写（含 OpenClaw FAQ 对比）；掘金长文草稿在 `juejin-caid.md`（未提交 git）；crx 已打包入库（`caid-extension.crx`）

## 4. 目录结构

```
├── caid-extension/            # ★ 开发重心：Chromium 扩展（Chrome + Edge）
│   ├── manifest.json          # MV3 清单（当前 0.3.2）
│   ├── newtab.html            # 扩展版工作台（含设置 / 插件中心）
│   ├── newtab-main.js         # 扩展版逻辑（工作台 UI / 插件系统 / 设置 / 待办）
│   ├── background.js          # Service Worker：接管 / 右键 / 注入 / 消息桥 / 副驾数据
│   ├── content.js             # 站外页面中继（浮动按钮、消息桥、右键启动）
│   ├── caid-copilot.js        # 副驾运行时（MAIN world，13 个 customTools）
│   ├── caid-bridge.js         # 主站页桥（扩展内，graduate.dpdns.org 专用）
│   ├── sandbox/               # 插件沙箱页（null 源 iframe）
│   ├── icons/                 # 扩展图标
│   ├── PLUGINS.md             # ★ 插件开发指南（完整 API 文档）
│   └── CHANGELOG.md           # 版本历史（每次提交必须同步）
├── index.html                 # 主站工作台（单文件 SPA，已暂停维护）
├── lib/                       # 主站依赖（zod-v4 / page-agent.headless / zod3 备用）
├── caid-extension.crx         # 已签名打包（README 提供下载）
├── juejin-caid.md             # 掘金宣发文章草稿（未提交 git）
└── HANDOVER.md                # 本文档
```

## 5. 核心架构（必须理解这 5 块）

### 5.1 新标签页接管（background.js）
- `onUpdated` 监听新建标签页，`isNewTabUrl()` 匹配 `chrome://newtab` / `edge://newtab`（带/不带尾斜杠），命中即 `tabs.update` 重定向到工作台
- **v0.3.1 起常驻开启、无开关**：设置页已删除「关闭接管」选项，恢复默认只能停用/卸载扩展
- 铁律：**MV3 Service Worker 会休眠，内存缓存不可靠**——接管判定每次 `await chrome.storage.local.get` 实时读，不要用 SW 内存变量

### 5.2 副驾运行时（caid-copilot.js，MAIN world）
- 通过 `web_accessible_resources` 注入页面 MAIN world（`run_at: document_start`），与页面脚本同执行环境，能读 DOM/跑 JS/防页面脚本干扰
- **MAIN world 没有 `chrome.*`**：LLM 请求、存储、导航等特权调用一律走 `caidRequestBg`（扩展页直连 `chrome.runtime.sendMessage`；正则网页派发 `__caid_bg_request` DOM 事件 → content.js(ISOLATED) 转发 → background）
- 双模式：自动 `agent.execute()` 闭环 / 手动自建 LLM 循环；无 Key 时规则引擎兜底
- **13 个 customTools**：`execute_javascript` / `navigate_to_url` / `open_url_in_new_tab` / `go_to_main` / `remember_fact` / `forget_fact` / `search_web` / `search_code` / `save_snippet` / `fill_form` / `click` / `create_plugin` / **`manage_todo`（v0.3.2 新增）**
- **工具输入校验必须真 Zod v4 schema**（`z.object` / `mkObj` 包装器），duck-typed 假 `_zod` 永远骗不过 v4 解析器；`z.toJSONSchema` 是独立函数

### 5.3 消息桥（MAIN ↔ ISOLATED ↔ background）
- 三层：页面 MAIN world → `postMessage` → content.js（ISOLATED）→ `chrome.runtime.sendMessage` → background（有特权，执行后原路返回）
- 断点续传 handoff：goal/上下文快照写入 `storage.session`，跨页跳转后新页面 `resumeIfNeeded` 捡起续跑；**防嵌套**靠 `_originalGoal`（续传指令不覆盖真实目标）+ `cleanResumeGoal()` 剥壳兜底（历史 bug，勿回退）

### 5.4 插件沙箱（sandbox/plugin-sandbox.html）
- 插件代码在 **null 源 sandbox iframe**（`sandbox="allow-scripts"` **不加 allow-same-origin**）用 `new Function` 执行（MV3 扩展页 CSP 禁 eval）
- 插件碰不到父页面 DOM 与 `chrome.*`；存储按 `caidPlugin:<id>:<key>` 隔离；设置回调脱敏（apiKey 打码）
- 三视图 `mount`（侧边栏）/ `panel`（右面板）/ `modal`（弹窗），至少实现一个；validate 只回传可序列化元数据 `{id,name,icon,hasPanel,hasModal}`
- 插件列表存 `chrome.storage.local.caidPlugins`；副驾 `create_plugin` 经 `CAID_PLUGIN_SAVE` 写入同一列表

### 5.5 待办数据层（v0.3.2 双存储同源）
- 数据结构：`{ id, text, done, priority(high/mid/low), createdAt }`
- **双写**：UI 增删改走 `persistTodos()`（localStorage + `chrome.storage.local.todos` 同写）；副驾 `manage_todo` 经 background 读写 `chrome.storage.local.todos`
- **同步**：newtab 的 `chrome.storage.onChanged` 监听把副驾写入单向同步回 UI（跨标签页即时生效）；启动时校正一次（storage 有值覆盖、无值上传建立权威源）
- reset 全部数据同步 remove `todos` key；导入备份后 `persistTodos()` 补同步

## 6. 数据存储体系

| 存储 | 存什么 |
| --- | --- |
| `localStorage` | 工作台 UI 数据（快捷方式 / 搜索历史 / todos / uiPrefs / llmCfg / paCfg），`LS` 封装同步读写 |
| `chrome.storage.local` | 跨页/副驾数据：`caidMemory`（长期记忆+任务历史）、`caidPlugins`（插件列表）、`todos`（v0.3.2 起与 localStorage 双写同源）、`caidServers`/`caidServerStats`（服务器监控）、`caidLlm`（LLM 配置，与 localStorage.llmCfg 双写） |
| `storage.session` | 断点续传 handoff 快照（页面跳转临时上下文） |
| IndexedDB（Dexie） | 代码片段 `snippets`、历史 `history`（备份恢复用） |

## 7. 开发约定（必须遵守）

1. **每次提交扩展改动，必须同步追加 `caid-extension/CHANGELOG.md`**（用户明确要求）
2. 改完代码先 `node --check <file>` 校验语法；提交前做逻辑自查（参考 HANDOVER 的坑清单）
3. **插件 API 变更必须同步更新 `caid-extension/PLUGINS.md`**
4. 单文件无构建：`newtab.html` 是主站 `index.html` 的扩展版副本，改完刷新即生效
5. 命名 `caid*` 前缀；全局变量用 `caidQs`/`caidQsa`，勿引入裸 `$`
6. **`git push` 交真机**（沙箱必失败，不要假装成功）
7. 涉及 personal_files/工作区外路径的操作务必谨慎，先备份

## 8. 已知的坑（血泪清单）

1. **书签代码**：对象字面量属性间不能加分号；**不要压缩书签代码**（破坏 ASI，只 `.trim()`）；改动后用户必须重新拖拽
2. **Bookmarklet** 必须自带全局防御 hack（`Object.keys` 等），否则站外自动模式抛 TypeError 连续重试
3. **沙箱环境 `caid-extension/` 文件可能被外部进程清空**（发生过两次）→ 未提交修改尽快 commit；文件消失先 `git status --short` + `git checkout --` 恢复
4. **Write 工具写 CAID 根目录文件偶发丢失**（路径异常）→ 临时脚本用 Bash heredoc，写完立即验证
5. 双层 textarea+pre 代码高亮在"软换行+滚动条"下无法对齐（已删，用户宁可不要高亮）
6. 页面滚动条 thumb 用 `var(--bg3)` 与编辑器背景同色不可见，编辑器内需显式覆盖
7. MV3 CSP 禁 eval：插件代码绝不可在扩展页直接 `new Function`/`eval`（只能在 sandbox 页）
8. filter-branch/filter-repo 重写历史有风险（filter-repo 曾清空 `.git`），非必要不动历史

## 9. 当前待办（2026-08-20 状态）

- [ ] **真机执行 `git push -f origin main`**（历史重写 + README 两处改动 + crx 入库 + 本版 v0.3.2 全部待推送；其他设备需 reset 同步）
- [ ] 验证 v0.3.2 manage_todo 实机效果（加载已解压 → 站外页面唤副驾 → "帮我记一条待办" → 新标签页确认出现）
- [ ] 宣发执行（按 README 定位叙事）：V2EX 首发 → 掘金发 `juejin-caid.md`（需先补录 5 张配图：封面 GIF / 架构图 / 插件截图 / AI 造插件录屏 / 踩坑代码）→ 短视频破圈
- [ ] 宣发前考虑在 README 添加免费代理隐私/稳定性提示（第三方 FC 服务，重度使用有风险）

## 10. 版本历史摘要

| 版本 | 日期 | 要点 |
| --- | --- | --- |
| v0.3.2 | 2026-08-20 | 副驾 manage_todo 待办工具（13 tools）、todos 双存储同源同步 |
| v0.3.1 | 2026-08-19 | 移除接管开关、常驻开启；Edge 接管支持；SW 缓存竞态修复 |
| v0.3.0 | 2026-08-19 | 接管取消 4 根因修复（后并入 0.3.1 叙事） |
| v0.2.9 | 2026-08-19 | 插件高级 API 14 项（onSettingsChange 脱敏 / export/import / 通知 / 快捷键等） |
| v0.2.8 | 2026-08-19 | 插件 `api.md` 富文本渲染 |
| v0.2.7 | 2026-08-19 | 接管开关实时同步、插件挂载点迁移主内容区 |
| v0.2.6 | 2026-08-19 | `api.fetch` 标准 Response、`api.shared` 跨视图共享 |
| v0.2.5 | 2026-08-19 | 副驾回答富文本渲染（cpMd） |
| … | … | 更早见 CHANGELOG.md |

## 11. 快速验证清单（改完必测）

- [ ] `node --check` 全绿
- [ ] 新标签页正常接管为工作台
- [ ] 站外页面（如 github.com）右下角出现副驾按钮，右键选中文本 → 副驾附带上文回答
- [ ] 插件中心：保存一个插件 → 侧边栏/面板/弹窗正常，刷新仍在
- [ ] 副驾："帮我记一条待办" → 新标签页待办区出现；"列出待办" → 正确返回
- [ ] 设置 → 重置全部数据 → 待办、插件、记忆全部清空

---

*本文档与 `CHANGELOG.md`、`PLUGINS.md`、`README.md` 一起构成项目的完整可交接知识库。*
