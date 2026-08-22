# CAID 更新日志

所有重要变更都会记录在此文件。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。
版本号采用语义化版本（主版本.次版本.修订）。

## [纯净版 v0.3.14] - 2026-08-22

### 修复（仅清凉版 caid-extension-lite）
- **错题本写入不再依赖 background 端口**：此前错题本经 `chrome.runtime.sendMessage` 到 background 读写，当 LLM 端点域名不可解析（如 `net::ERR_NAME_NOT_RESOLVED`）导致 SW 忙/回收时会触发「消息端口关闭、错题本无法写入」。现改为在 content.js（ISOLATED world）**直接读写 `chrome.storage.local.caidMistakes`**（`mistRead/mistWrite`），彻底绕开 SW 端口往返。
- **副驾读错题本也绕过 SW**：content.js 的 `bg_request` 桥新增直连 `CAID_MISTAKES_GET` 处理（同 `CAID_MEMORY_GET` 模式），MAIN world 副驾发送任务时读取错题本不再走 background。
- **LLM fetch 加 15s 超时**：`CAID_LLM_FETCH` 用 AbortController 兜底，域名无法解析/挂起时最多 15s 即中断并返回错误，避免长时间占用 service worker 进而拖垮并发消息端口。

> ⚠️ 需重新加载扩展并刷新页面生效。
> 提示：若 `hif-dliq.deepseek.com/query` 这类端点仍报 ERR_NAME_NOT_RESOLVED，属该**域名本身无法解析**（非扩展 bug），请核对设置的 LLM 地址是否正确/可达。

## [纯净版 v0.3.13] - 2026-08-22

### 修复（仅清凉版 caid-extension-lite）
- **消除 "message port closed before a response" / "Unchecked runtime.lastError" 报错**：content.js 中所有带回调的 `chrome.runtime.sendMessage`（session 代理 CAID_SESSION_*、错题本 DEL/CLEAR/ADD、TRY_RESUME_FROM_BG）统一补读 `chrome.runtime.lastError`，避免 MV3 运行时 SW 端口关闭时产生未处理告警；错题本写入失败时也会明确提示"消息端口关闭"。
- **消掉 `net::ERR_NAME_NOT_RESOLVED` 网络报错**：background 的 `CAID_LLM_FETCH` 在发起请求前先校验 URL（必须为 `http(s)` 前缀），URL 为空或配置错误时直接返回 `invalid_url` 错误，不再发起注定失败的 fetch，避免产生 DNS 解析失败与端口竞态。

> ⚠️ 需重新加载扩展并刷新页面生效。

## [纯净版 v0.3.12] - 2026-08-22

### 修复与增强（仅清凉版 caid-extension-lite）
- **错题本写入确认 & 可视化管理**：纠错弹窗现在**实时加载已存错题列表**（含逐条删除与「清空全部」），保存后按真实结果提示——成功显示「✅ 已记入（当前共 N 条）」，失败显示红色「❌ 写入失败」，不再无脑提示成功，方便确认写入是否生效。
- **副驾不再把注入 UI 当网站内容**：系统提示新增【忽略副驾注入的 UI】规则，明确列出 `#caidLauncher`、`#caidExtCopilot`、`#caidQuickBar`、`#caidStopBtn`、`#caidBallMenu`、`#caidMistakeModal`、`#cpPlanArea` 及所有 `caid-` 前缀元素为**工具界面而非网站内容**，观察/提取/判断布局时一律忽略，除非用户明确要求操作它们。
- **按钮/链接语义判断**：系统提示新增【页面元素理解】规则——明确副驾**无视觉/图像识别能力**，判断按钮、链接、输入框用途必须依据 `aria-label / title / textContent / placeholder / name / id / class` 等**语义标记**而非外观样式；语义不明可先读取元素 outerHTML 再判断。

### 内部
- 错题本「始终遵守」进一步强化：以系统提示再次强调遵守【错题本】历史纠正，防止模型视而不见。

> ⚠️ 需重新加载扩展并刷新页面生效。

## [纯净版 v0.3.11] - 2026-08-22

### 新增（仅清凉版 caid-extension-lite）
- **圆球运行态停止键**：AI 运行中（圆球呼吸灯绿色）时在圆球左侧出现「⏹」停止键，点击一键终止当前任务；停止后自动隐藏。
- **悬浮工具菜单**：鼠标悬浮圆球时向上展开菜单，含两个按钮：
  - **进入产物页**：直接打开副驾产物页（历史视图）。
  - **纠错**：弹出纠错对话框，指出副驾错误后记入「AI 错题本」。
- **AI 错题本（纠错）机制**：用户纠错记录持久化到 `caidMistakes`（上限 50 条）。副驾无论执行任何任务，`sendTask` 时都会自动读取最近 10 条错误与纠正建议并强制注入指令，**始终遵守**、避免重蹈覆辙——不受任务类型或时间影响。
- **全局快捷键调整**：
  - 启动副驾：**Ctrl+I+L**（按住 Ctrl，按 I 后 1.5 秒内按 L）。
  - 终止当前任务：**Ctrl+L**（单独按 L，无 I 前缀）。

### 内部
- background 新增 `CAID_MISTAKES_GET/ADD/DEL/CLEAR` 消息端点，统一负责错题本读写。
- 圆球配套元件（停止键、菜单、纠错弹窗）调用 `layoutBallCompanions()` 始终跟随圆球位置。

> ⚠️ 需重新加载扩展并刷新页面生效。浏览器可能保留 Ctrl+L（聚焦地址栏）而不透传，此时终止建议用「停止键」。

## [v0.3.10] - 2026-08-21

### 修复
- **LLM 请求 413 Payload Too Large**：页面复杂度高（如 B 站视频评论流）时整页 DOM 被全量塞进请求压爆 body。
  - 通过框架原生 `transformPageContent` 钩子把每次页面快照裁剪到 3 万字符预算内（保留开头交互元素），超长截断并提示模型先滚动/缩小范围再观察。
  - 记忆改为按需 skill：新增 `get_memory` 工具，`sendTask` 不再全量拼接长期记忆，改用轻量提示引导模型按需检索（配合上轮改造）。
- **相关搜索推荐 / 空闲推荐条没有数据**：原阅读采集只在副驾被注入（点球启动）后才运行，普通浏览页面不记录，导致新标签「你X天前看过一篇相关的」提示与浏览时「继续读？你之前认真看过这篇」推荐条无历史可用。
  - 将阅读采集下沉到 content.js（ISOLATED world，每个页面加载即跟踪停留时长 + 最大滚动深度 + 标题/摘要/实体，离开时写回 `caidReadLog`），不点副驾也开始积累。
  - 移除 MAIN world 中重复的写库逻辑，避免同一页面重复记账（visits 虚高）。

> ⚠️ 需重新加载扩展后生效。

## [纯净版 caid-extension-lite] - 2026-08-21

### 新增
- **不捆绑新标签页的纯净版**：新增独立目录 `caid-extension-lite/`，保留浏览器原生新标签页，只在任意网页提供跨页智能体副驾。
- **保留原版全部功能**：content.js（任意页面圆球 + 阅读采集）、background.js（注入副驾/断点续传/待办与记忆后台）、caid-copilot.js（副驾本体，含内联 LLM 设置）、lib/、icons/、sandbox/（插件沙箱）、vendor/、newtab.html + newtab-main.js（原版工作台）。
- **设置页 = 原版工作台**：`options_ui` 仍指向 `newtab.html#settings`（相同于全量版），右键图标→选项即打开原版工作台的设置弹窗；同样保留 `topSites`、`sandbox` 权限，插件系统完整可用。
- **唯一差异**：不注册 `tabs.onCreated → maybeTakeoverNewTab`，也不声明 `chrome_url_overrides.newtab`，因此 `chrome://newtab` 保持原生、不被接管；需访问工作台时可右键图标→选项，或点圆球面板里的「前往工作台」。

## [v0.3.9] - 2026-08-21

### 圆球交互修正
- **圆球改小**：56px → 44px，图标在圆球内严格居中（消除点击后上移/错位）。
- **圆球可拖动**：按住圆球拖动可改变右下角停靠位置。
- **首次单击不再误开整块面板**：单击只弹底部横向输入条；双击才展开完整面板（未注入时用 280ms 窗口正确区分单/双击）。
- **小栏提交不跳大栏**：在横向输入条按 Enter/发送后直接开始任务，不再强行展开完整面板，进度由圆球呼吸灯 + 弹窗反馈。
- **横向输入条打开时保留圆球**：仅完整面板打开才隐藏圆球，保证双击展开面板仍可用。
- **移除「拖文字到圆球」功能**：不再支持把选中文字拖到圆球自动开始任务（含相关选区监听与 drop 处理），仅保留单击输入 / 双击面板 / 圆球拖动。
- **阅读推荐设置入口**：新标签页「设置 → 常规 → 阅读记录 & 推荐」新增推荐开关、站点黑名单编辑与「清空阅读记录」。

### 内部
- 圆球统一由 `_makeBallNode`/`_setupBallExtras` 生成（content.js 与 MAIN world 行为一致）。

> ⚠️ 需重新加载扩展并刷新页面生效。

## [v0.3.8] - 2026-08-21

### 副驾界面全新改版
- **圆球启动按钮**：底部右侧的胶囊按钮改为 56px 圆形球，内嵌品牌图标，居中悬浮。
- **状态呼吸灯**：
  - 空闲：正常球体；
  - 运行中：**绿色呼吸灯**；
  - 出错：**红色呼吸灯** + 右上角弹窗（❌ 任务出错）；
  - 完成：**黄色呼吸灯 5 秒**后回到空闲 + 右上角弹窗（✅ 任务完成）。
- **输入交互**：
  - **单击圆球**：弹出底部横向输入条（左侧 ☰ 展开按钮 → 展开完整面板，输入后 Enter/发送交副驾执行，副驾会自动弹出面板展示进度）；
  - **双击圆球**：直接展开完整副驾面板；
  - **拖拽文字到圆球**：自动把选中文字作为任务交给副驾（空闲时也会先读页面）。
- 圆球显隐与面板/输入条联动双向同步；扩展页与普通网页统一经 `postMessage` 路由到 MAIN world 处理。

### 阅读记录系统（自动追踪"认真看过"的页面）
- **记录维度**：停留时长（dwell）+ 最大滚动深度（scroll depth）+ 标题 + 摘要（og:description/meta）+ 提取到的实体词。
- 跨标签页/会话持久化到 `chrome.storage.local.caidReadLog`，按 URL 合并访问次数（最新优先，上限 200 条）。
- **新标签页"继续读这篇？"**：基于时间（8h~7 天）+ 主题匹配，提示最近认真读过的页面并可一键打开。
- **相关搜索提示**：在搜索框输入命中阅读记录的标题/实体时，主动提示"你昨天/xx天前看过一篇相关的"。
- **空闲阅读推荐条**（顶栏）：读过 ≥20s 的页面有机会在顶部弹出"继续读？你之前认真看过这篇"推荐条。
  - 可**关闭推荐**（`off`）、**加入黑名单**（`black`，按站点域名）、手动**×关闭**；
  - 开关 + 黑名单持久化到 `chrome.storage.local.caidReadPrefs`。

### 场景识别与副驾专项优化
- **购物场景**：`taobao/tmall/jd/pinduoduo/1688/amazon/suning…` 的具体商品页（item/detail/product 等）自动识别。
- **视频场景**：`youtube/bilibili/douyin/v.qq/iqiyi/youku…` 及 `/watch|/video|/live` 等自动识别。
- 副驾运行时，对当前场景自动注入专项系统提示（`__caidSceneHint`），让副驾优先提取商品信息 / 视频要点，针对性优化。

### 内部
- background 新增 `CAID_READLOG_SAVE/GET`、`CAID_READPREFS_GET/SET` 消息，统一负责阅读记录与偏好读写。
- 修复 MAIN world 消息监听的空指针风险（`ev.data` 为 null 时安全返回）。

> ⚠️ 需重新加载扩展并刷新页面生效。椭圆/双击/拖拽交互与呼吸灯在**普通网页**与**接管的 newtab** 一致。

## [v0.3.7] - 2026-08-21

### 修复
- **正则网页上副驾桥接全部失效（核心 bug）**：
  - 根因：`caid-copilot.js` 通过 `chrome.scripting.executeScript({ world: 'MAIN' })` 注入，在正则网页的 MAIN world 中 `window.chrome.runtime` **存在**（浏览器内置对象），但 `chrome.runtime.sendMessage` 无法真正发送给 background（无扩展上下文）。`caidSendToBg` / `caidRequestBg` / `caidRequestNavigate` 用 `typeof chrome.runtime.sendMessage === 'function'` 判断扩展环境，条件为 true → 走 `chrome.runtime.sendMessage` 静默失败 → `return` → 跳过 `window.postMessage` → content.js 永远收不到消息。
  - 影响范围：正则网页上所有副驾桥接操作失效——任务历史不记录（`CAID_MEMORY_ADD_HISTORY`）、待办不写入（`CAID_TODO_OP`）、长期记忆不读写（`CAID_MEMORY_GET/ADD_FACT`）、导航不跳转（`NAVIGATE_TO_URL`）。
  - 解决：三个桥接函数改用 `chrome.runtime.id`（扩展 ID 字符串）判断是否在扩展环境。`caidSendToBg` 去掉 `return`，让 `window.postMessage` 总是执行作为兜底（扩展页上 content.js 不运行，不会重复）。`caidRequestBg` 和 `caidRequestNavigate` 非扩展环境直接走 postMessage / DOM 事件桥。
- **副驾任务历史不再同步**：
  - 根因：`recordTaskHistory()` 只在 `agent.status === 'completed'` 时调用。任务被用户停止（`stopped`）、出错（`error`）、或因 plan 内导航中断时，不会记录历史，导致执行过的任务不出现在新标签页的副驾任务列表里。
  - 解决：`renderStatus()` 中 `stopped`（非 handoff）和 `error` 状态也调用 `recordTaskHistory()`，只有因导航跳转的 `stopped`（`isHandingOff=true`）才跳过（任务会在新页面续跑）。
- **AI 主动建议静默失败**：
  - 根因：无 API Key 时 `renderSmartAiSuggestion()` 直接 `return`，LLM 调用失败时也只 `console.warn`，用户什么卡片都看不到，误以为功能没做。
  - 解决：无 API Key 时显示「配置 AI API Key 后可获得个性化建议」引导卡片（带「前往配置」按钮直接打开设置弹窗）；LLM 调用失败时显示 fallback 智能建议卡片（基于时段 + 待办数的本地规则）。
- **同一时段重复输出 AI 主动建议 / 重复输出后卡片消失**：
  - 根因：原逻辑用 `smartAiPeriod` 标记已输出时段，命中时直接 `return`，导致关闭重开新标签页后**完全不显示**卡片——只做到了"不重新调 LLM"，但没做到"继续显示已生成的卡片"。
  - 解决：新增 `smartAiCache`（持久化在 `chrome.storage.local`）缓存建议卡片的 HTML 与元数据（`type`/`aiKey`/`suggestion`/`actionUrl`）。新标签页打开时先查缓存：时段匹配则用 `renderCachedAiCard` 重建卡片并重新绑定事件（关闭/让 AI 处理/稍后按钮），**不调用 LLM**；时段不匹配才调 LLM 生成新建议并写缓存。手动刷新按钮清除 `smartAiCache` + `smartAiPeriod`，强制重新生成。三类卡片（LLM 成功 / 无 API Key / fallback）都纳入缓存。

### 新增
- **智能推荐区（`#smartZone`）**：新标签页中部新增独立推荐区，不动用户自定义的 `#shortcutBar`。新标签页打开时根据时段 + 访问习惯 + 副驾历史任务，动态生成三层推荐内容：
  - **分时段内容卡片**：6 个时段（清晨 / 上午 / 中午 / 下午 / 晚上 / 深夜）显示不同内容——清晨提示未完成待办数、上午显示最近副驾任务、中午汇总上午完成数、下午提示剩余待办、晚上建议放松或留待办到明天、深夜提示休息。左侧色条按时段切换（早黄 / 午蓝 / 晚紫 / 深夜灰），每 5 分钟检测时段变化自动刷新。
  - **常用站点推荐**：用 `chrome.topSites` API 拿最常访问的 6 个站点，过滤扩展页 / `newtab` / `chrome://` 等，显示 favicon（Google s2 服务）+ 标题胶囊，点击新标签打开并写入搜索历史。
  - **AI 主动建议卡片**：新标签页打开时，根据时段 + 未完成待办 + 最近副驾任务 + `caidMemory.facts` 上下文，调 LLM 一次（非流式，`max_tokens: 120`）生成 ≤100 字主动建议。带「打开链接 / 让 AI 处理 / 稍后」三个按钮：建议里若提到 URL 直接打开；「让 AI 处理」预填搜索框；「稍后」关闭本次会话不再重弹。
- 新增 `topSites` 权限，用于读取浏览器最常访问站点列表。

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
