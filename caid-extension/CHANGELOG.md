# CAID 更新日志

所有重要变更都会记录在此文件。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。
版本号采用语义化版本（主版本.次版本.修订）。

## [v0.3.6] - 2026-08-21

### 新增
- **多步规划（plan）工具**：LLM 可一次性规划多步任务并自动执行，大幅减少 LLM 调用次数（原每步 1 次 → 整个 plan 1 次）。
  - 输入：`{ goal, steps: [{ tool, args, desc, confirm, on_fail }, ...] }`，执行器按序调用其他工具（`execute_javascript` / `navigate_to_url` / `manage_todo` 等），支持 1-15 步。
  - **暂停点**：`confirm: true` 在敏感操作（删除/提交/支付）前弹窗等用户确认；`on_fail: "ask"` 在步骤失败后询问是否继续。
  - **失败策略**：`on_fail` 支持 `stop`（默认，停止整个 plan）/ `continue`（跳过继续）/ `ask`（询问用户）。失败步骤后的剩余步骤标记为 `skipped`。
  - **可视化进度条**：彩色状态圆点（灰=待执行 / 黄脉冲=运行中 / 绿=完成 / 红=失败 / 暗灰=跳过）+ 渐变进度条 + 每步耗时统计 + 完成汇总。
  - **强化 systemPrompt**：明确"2+步任务必须使用 plan"的判断准则（连接词 / 多动词 / 不确定时优先 plan），缓解 LLM 跳过 plan 直接单步执行的问题。
  - `sendTask` 启发式检测多步任务（"然后/之后/再"等连接词或多个动词），自动追加 plan 使用提示。

### 修复
- **plan 进度条 UI 被 `renderHistory` 清空**：
  - 根因：`renderHistory()` 每次 `historychange` 都会 `logEl.innerHTML = ''` 重建日志区；plan 执行子步骤会触发 `historychange`，导致刚插入的 plan 进度条被立即清掉。
  - 解决：副驾面板新增独立 `#cpPlanArea` 容器（位于 `.cp-activity` 与 `.cp-log` 之间），plan UI 改插入到这里，不受 `renderHistory` 清空影响；`:empty` 时自动隐藏不占空间。
- **`.cp-log` 输出池不显示 `[plan]` 记录**：
  - 根因：Page-Agent 在工具 `execute` 返回后才记录 step；若 plan 内含导航步骤，页面跳转会让 agent 中断、plan 不返回 summary，导致 `.cp-log` 没有任何 plan 相关条目。
  - 解决：plan 开始时主动往 `displayEvents` push 一条 `[plan] ▷ 开始执行：goal（N 步）`；完成时再 push 一条 `[plan] ✓ goal：done/total 成功`，确保输出池始终有 plan 记录。
- **新任务开始时清空旧 plan 进度条**，避免多个 plan 进度条堆积。

## [v0.3.5] - 2026-08-20

### 修复
- **扩展页副驾注入失败**（`bootCopilot failed: Cannot access contents of url "chrome-extension://..."`）：
  - 根因：`chrome.scripting.executeScript` 无法注入扩展自身的 `chrome-extension://` 页面（newtab.html）。
  - 解决：newtab 页面新增 **bootstrap 脚本**，自行按序加载 `page-agent.headless.js` → `caid-copilot.js`，读取 `chrome.storage.local.caidLlm` → `window.__CAID_LLM_CFG`、`chrome.storage.session.caidHandoff` → `window.__CAID_HANDOFF`，完全绕过 `executeScript`。
  - `background.js` 的 `tabs.onUpdated` 对 newtab 不再调 `bootCopilot`、不消费 handoff；`bootCopilot` 跳过逻辑更健壮（先查 `tabUrl` 参数，`tabs.get` 失败时不阻塞；跳过时若携带 handoff 存入 `storage.session` 给 bootstrap 读取）。
- **待办桥接 `The message port closed before a response was received`**：
  - 根因：MV3 Service Worker 在 `chrome.storage.local.get` → `chrome.storage.local.set` 之间被 Chrome 销毁，`sendResponse` 永不触发。
  - 解决：`content.js` 与 `caid-copilot.js` 中所有存储类操作（`CAID_TODO_OP` / `CAID_MEMORY_*` / `CAID_SERVER_*` / `CAID_PLUGIN_SAVE` / `CAID_LAYOUT_SAVE` / `CHECKPOINT` 等）**直接用 `chrome.storage.local`**，完全绕过 SW。`caidRequestBg` 在扩展页先走 `_tryDirectStorage`，网络/导航类才走 `chrome.runtime.sendMessage`；正则网页通过 `postMessage` 让 content.js 直接操作 storage 后回 `bg_response`。

### 新增
- **插件 `api.setSize(opts)` API**：插件可主动调整自身渲染尺寸，覆盖默认的 `min-height: 60px`。
  - 入口：`api.setSize({ height?, width?, minHeight?, maxHeight? })`，所有参数可选、数值范围限制在 40-2000px（height/minHeight）和 80-2000px（width/maxHeight）。
  - 仅对 `mount` / `panel` 视图生效；`modal` 视图尺寸由弹窗容器决定，调用无效。
  - 父页面 `CAID_PLUGIN_SIZE` 处理器升级：支持 `height` / `width` / `minHeight` / `maxHeight` 四字段；自动 `reportSize`（ResizeObserver）只传 `height`，不会误覆盖其他字段（`typeof === 'number'` 校验）。
- **待办详情弹窗**：侧边栏待办过长被截断时点击卡片弹窗显示完整内容。
  - `.todo-text` 加 `-webkit-line-clamp:2` 两行省略；被截断的卡片自动加 `.ellipsis` 类并显示「展开」提示。
  - 新增 `.todo-detail-*` 全套弹窗样式（backdrop 模糊 + 卡片阴影，与 `caid-confirm` 一致）+ HTML 结构（优先级标签、完整内容、创建时间、完成/删除按钮）。
  - `renderTodos` 后检测 `scrollHeight > clientHeight` 给被截断的待办加 `.ellipsis` 类；点击 `.todo-text` 调用 `openTodoDetail(t)` 弹窗。
  - 弹窗支持：Esc 关闭、点击背景关闭、完成/取消完成、删除。

## [v0.3.3] - 2026-08-20

### 修复
- **副驾桥接从 CustomEvent 改为 postMessage**：`caidRequestBg` / `caidSendToBg` 在站外页面（MAIN world → ISOLATED world）的通信从 `CustomEvent` 切换到 `window.postMessage`，解决 `CustomEvent.detail` 跨世界时属性丢失导致桥接静默失败的问题。content.js 同步更新为 `message` 事件监听。
- **`manage_todo` 桥接重试**：首次桥接失败时自动等 2s 重试一次（SW 可能刚唤醒），重试仍失败才报错。
- **移除无效 localStorage 兜底**：之前写的 localStorage 兜底实际写到了宿主页面的 localStorage（不同源），数据到不了工作台，已移除。

### 变更
- **副驾脱离主站**：主站（graduate.dpdns.org）已停维，副驾不再引用主站地址。
  - `navigate_to_main_site` 工具改名为 `go_to_workbench`，跳转目标改为扩展自己的 newtab 页面。
  - 移除 `MAIN_URL` 硬编码主站地址，改读 `window.__CAID_OPTIONS_URL`。
  - systemPrompt 中 `navigate_to_main_site` 引用同步更新为 `go_to_workbench`。
  - 设置面板文案移除"同步回主站"提示。
- **移除 `caid-bridge.js`**：主站已停维，不再需要主站→扩展的单向配置同步脚本。manifest 中对应的 content_scripts 条目已删除，background.js 中 `caidLlmMain` 回退逻辑也已移除。
- **newtab 页面清理**：移除 `site-main-url` meta 标签和 `agent-instructions` meta（原指示副驾跳转主站）；移除 `MAIN_SITE_URL` 常量和 `navigateToMainSite` 函数；设为首页弹窗不再显示主站 URL。

## [v0.3.2] - 2026-08-20

### 新增
- **副驾待办管理工具 `manage_todo`**（12 → 13 个 customTools）：AI 副驾可直接读写工作台待办列表，自然语言即可管理待办——"帮我记一下明天开会" → 副驾调用 `manage_todo add`，待办立即出现在新标签页待办区并持久化。
  - 动作：`add`（text 必填，priority 可选 high/mid/low 默认 mid，文本截断 200 字）/ `list` / `complete`（按 id 切换完成态）/ `delete` / `clear_done`；inputSchema 使用真 Zod v4 `z.object`（可选字段 `.optional()`）
  - 链路：副驾 → `caidRequestBg`（`CAID_TODO_OP`）→ background 读写 `chrome.storage.local.todos`；newtab 侧 `storage.onChanged` 监听实时同步 UI（跨标签页即时生效），UI 增删改走 `persistTodos()` 双写 localStorage + chrome.storage 保持同源
  - 边界：导入备份 / 重置全部数据时同步 chrome.storage 的 todos，防止数据残留或丢失；reset 清理列表同步加入 `todos` key

## [v0.3.1] - 2026-08-19

### 变更
- **移除「新标签页接管」开关**（用户确认）：设置 → 常规 中的接管开关已删除，接管功能改为**常驻开启**——新建标签页一律重定向为 CAID 工作台，无关闭入口。如需恢复浏览器默认新标签页，请在扩展管理页停用/卸载本扩展。同步移除关闭接管的 `tabs.remove` 关闭页面、顶部横幅提示等逻辑与样式。

### 修复
- **接管逻辑简化**：`maybeTakeoverNewTab` 不再读取 `chrome.storage.local.caidNewtabEnabled` 开关（已无开关），识别到 `chrome://newtab` / `edge://newtab` 后直接重定向。
- **Edge 支持**：`isNewTabUrl()` 统一匹配 `chrome://newtab`、`edge://newtab`（带/不带尾斜杠），Edge 中接管同样生效。

## [v0.2.9] - 2026-08-19

### 新增
- **插件高级 API 全面落地**（安全评审后实现，跳过 `getTabInfo`/`executeScript` 两个隐私/高危项）：
  - 信息类：`api.getPluginId()`、`api.getVersion()`、`api.getLocale()`、`api.isDarkMode()`、`api.log(...)`（带插件前缀）
  - 监听类：`api.onSettingsChange(cb)`（**回传脱敏设置**，apiKey 等敏感字段打码）、`api.onThemeChange(cb)`（当前固定暗色，接口保留）
  - 工具类：`api.css('--var')`（读父页 CSS 变量，校验 `--` 前缀）、`api.copyToClipboard(text)`、`api.openURL(url)`（仅 http/https 白名单）、`api.confirm(msg, opts)`（复用 CAID 弹窗，返回 `Promise<boolean>`）
  - 通信类：`api.emitPluginEvent(name, payload)` / `api.onPluginEvent(cb)`（插件间广播式通信）
  - 数据类：`api.exportData()` / `api.importData(data)`（仅本插件命名空间，500KB 上限）
  - 通知类：`api.showNotification(opts)`（`chrome.notifications`，每插件 10 秒限 1 条）
  - 快捷键：`api.registerShortcut('Ctrl+K', cb)`（**页面内**快捷键降级方案，非浏览器全局，需带修饰键）
- manifest 新增 `notifications` 权限；删除插件时清理通知节流与快捷键注册残留。

## [v0.2.8] - 2026-08-19

### 新增
- **插件富文本渲染接口 `api.md(text)`**：把 Markdown 文本渲染成安全 HTML 字符串（先转义再替换；链接仅放行 http/https，`javascript:` 与 href 属性注入天然免疫）。支持围栏代码块（沙箱页加载 hljs 时自动高亮）、行内代码、标题 1-4、有序/无序列表、引用块、表格、分隔线、加粗/斜体、链接；样式内置（`caid-md-*`），用法 `api.container.innerHTML = api.md('**你好**')`。与副驾 `cpMd` 同源实现，PLUGINS.md 新增「富文本渲染」章节与示例，`create_plugin` 工具描述同步。

## [v0.2.7] - 2026-08-19

### 修复
- **取消新标签页接管更彻底**：background 增加 SW 内存缓存 + `chrome.storage.onChanged` 实时同步接管开关——在设置页点「取消」的瞬间后台立刻知晓，正在排队/即将新建的新标签页也不会再被重定向（此前每次新建标签才读一次 storage，极端时序下可能多接管一拍）。关闭接管时**所有** CAID 工作台标签页（含当前设置页本身）都会导航回浏览器默认新标签页，「取消接管」立竿见影。

### 新增
- **主内容区插件挂载点**：服务器监控列表下方新增「插件」区域（`#pluginZone`），插件的 `mount` 视图从侧边栏迁移至此——同一插件代码不再双帧运行（避免 DOM/副作用重复）。侧边栏插件区块保留为管理入口（图标/名称/更多操作/折叠）；停用或删除插件时挂载卡片同步移除。

## [v0.2.6] - 2026-08-19

### 修复
- **`api.fetch` 改为返回标准 `Response`**：修复之前返回包装对象 `{ok, status, text, json}`、开发者需额外适配的问题。现在与浏览器 `fetch` 一致——`res.ok` / `res.status` / `await res.text()` / `await res.json()` 直接可用；另附 `res.raw`（`{ ok, status, statusText, text, json, headers }`）兼容旧版字段，旧插件无需改动。桥接失败或非法 status 时回退 `status: 200`。
- **侧边栏插件更多操作按钮**：窄屏（≤900px，文字隐藏时）kebab 按钮一并隐藏，不再出现孤立的「⋮」图标。

### 新增
- **`api.shared` 跨视图共享变量**：mount / panel / modal 三个视图各自运行在独立沙箱帧、JS 变量天然隔离，现通过父页面内存中转 + 广播提供同一插件三视图**共享的内存对象**——任一视图 `api.shared.x = ...` 修改，其他视图立即同步读到（父页 `pluginSharedStore` 统一存储 + `CAID_PLUGIN_SHARED_SYNC` 广播）。仅当前页面会话内有效，刷新即清空；需要持久化请用 `api.storage`。插件删除时自动清理共享存储。
- 侧边栏插件更多操作菜单新增「编辑插件」：右键菜单可直接把插件代码载入编辑器修改（复用现有编辑态：取消按钮 /「更新插件」按钮）。

### 变更
- 插件开发文档 `PLUGINS.md` 同步：`api.fetch` 标准 Response 说明、新增「多视图共享变量（`api.shared`）」章节与示例；副驾 `create_plugin` 工具描述同步提及 `api.shared` 与标准 Response。

## [v0.2.5] - 2026-08-19

### 新增
- **副驾回答富文本渲染**：内置迷你 Markdown 渲染器（`cpMd`），assistant 气泡支持标题、加粗/斜体、行内代码、围栏代码块（`window.hljs` 存在时自动高亮）、有序/无序列表、引用块、表格、分隔线与 http(s) 链接；用户输入气泡保持纯文本原样显示。
- 渲染安全：先转义后替换，`<script>`、`javascript:`/`data:` 链接、href 属性注入均不可利用；流式输出未闭合标记（围栏/粗体/半截表格）原样降级不报错。
- 面板样式补充富文本配套（`.cp-md-*`：段落/标题/代码/表格/列表/引用/分隔线，深浅色一致）。

## [v0.2.4] - 2026-08-19

### 变更
- **新标签页接管改为浏览器层面动态接管**（纠正 v0.2.1 方案）：不再静态声明 `chrome_url_overrides.newtab`——该声明无法在运行时移除，v0.2.1 的「停用提示页」本质上仍是扩展继续占用新标签页。现改为由 background 监听浏览器原生新标签页创建（`chrome://newtab`），仅当开关开启时才重定向到工作台；**关闭开关后浏览器 100% 恢复默认新标签页，扩展零干预**。关闭瞬间已打开的工作台标签页（当前设置页与 `#settings` 选项入口除外）也会被导航回默认新标签页，取消接管即时可见。
- 移除新标签页「停用提示页」及其逻辑（`newtab-disabled-view` / `showNewtabDisabledView`）；manifest 移除 `chrome_url_overrides` 声明，版本号同步为 0.2.4。

## [v0.2.3] - 2026-08-19

### 新增
- **副驾右键 skill**：在任意网页选中文本后右键，菜单出现「用 CAID 副驾处理选中内容」和「让 CAID 副驾制作插件」——点击后自动注入/打开副驾面板，文本填入输入框（制作插件模式自动附「请帮我制作一个 CAID 插件：」指令前缀），回车即可发送。
- **副驾自制插件**：副驾新增 `create_plugin` 工具，LLM 根据需求生成完整插件代码后**自动保存到扩展插件系统**（经桥接写入 `chrome.storage.local.caidPlugins`），打开/刷新新标签页即见即用；在无扩展桥接的环境（如纯书签注入）自动降级为「代码区展示 + 引导复制粘贴导入」。
- **插件系统兼容外部保存**：副驾/后台保存的插件首次渲染时自动沙箱校验补齐 `hasPanel`/`hasModal` 元数据，右侧面板视图也能正常注入。

### 变更
- 副驾 customTools 由 11 个增至 12 个；manifest 新增 `contextMenus` 权限。

## [v0.2.2] - 2026-08-19

### 修复
- **插件编辑器文字错位（根治）**：移除「textarea 透明文字 + 底层 pre 语法高亮」双层结构，textarea 直接显示文字，从根源上消除换行/滚动条占位差异导致的逐层错位。
- **插件编辑器滚动条不可见**：滚动条滑块颜色与编辑器背景同色导致看不清，改为边框色并显式加宽。

### 变更
- 插件编辑器不再做语法高亮（保留 Tab 缩进、草稿缓存等功能；教程/更新日志页面的代码高亮不受影响）。

## [v0.2.1] - 2026-08-19

### 新增
- **新标签页接管开关**：设置新增「常规」页签，可随时关闭「自动接管新标签页」。关闭后新开标签页显示浏览器默认页面（并出现停用提示页，可一键打开默认新标签页或返回设置重新启用）；扩展选项（右键图标 → 选项）入口不受开关影响，随时可恢复。

## [v0.2.0] - 2026-08-19

### 新增
- **插件弹窗**：插件可调用 `api.modal({ title, width })` 打开自己的弹窗，内容由 `def.modal(api)` 渲染在独立沙箱帧中；`api.closeModal()` 可主动关闭。ESC / 遮罩点击 / 关闭按钮均可关闭。
- **右侧面板**：插件定义 `def.panel(api)` 后，内容自动显示在主页面右侧面板栏；面板头部可手动移除，移除后记住状态（不再自动出现）。
- **更新日志**：侧边栏底部新增「更新日志」入口，主页可直接阅读本文件（markdown 渲染 + 代码高亮）。

### 修复
- 插件 icon 恒为 puzzle：编辑器图标输入框默认值在保存时覆盖了代码里的 `icon` 字段。
- 插件创建后出现两个（并发渲染未去重）。
- 插件不生效（iframe 未设置 `src`，沙箱页从未加载）。
- 插件右键菜单不显示（CSS 类切换体系冲突）。

### 改进
- 插件编辑器语法高亮（highlight.js 双层渲染 + Tab 缩进）。
- 插件编辑器草稿缓存：未保存内容自动恢复，保存/取消/新建时清除。
- 所有「是否确认」操作改用网站自定义弹窗（替代原生 `confirm`）。
- 插件编辑器新增「插件教程」入口，全屏阅读 `PLUGINS.md`。
- 插件编辑器从弹窗改为整站全屏视图；修复顶栏胶囊层级压住侧边栏的问题。

## [v0.1.0] - 2026-08-16

### 新增
- Chromium 扩展（MV3）首个版本：接管浏览器新标签页为 CAID 工作台。
- **插件系统**：用户 JS 在 sandbox iframe 中安全运行（null 源 + 放宽 CSP），`CAID.plugin({...})` 定义插件；`storage / fetch / toast` 等能力经 postMessage 桥接，按 `caidPlugin:<id>:<key>` 隔离存储。
- 魔改 Page-Agent 副驾全量继承（9 个 customTools：导航/搜索/填表/取数等），站外任意页面可经 content.js 浮动按钮注入使用。
- LLM 配置统一入口（newtab 设置弹窗，localStorage 与 `chrome.storage` 双写，apiKey 留空走免费代理）。
- 「设为首页」引导：浏览器安全限制下无法自动改主页，提供手动引导。
