# CAID 更新日志

所有重要变更都会记录在此文件。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。
版本号采用语义化版本（主版本.次版本.修订）。

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
