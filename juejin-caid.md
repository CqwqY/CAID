# 我用 5000 行单文件做了一个浏览器插件平台：AI 副驾 + 可编程插件系统

> 程序员一天要开几十次新标签页。以前那里是空白，或者一个搜索框。我把它变成了一个带 AI 副驾的工作台，而且这个工作台还能让 AI 自己给你写插件。

<!-- 封面图：拖 crx 进浏览器 → 新标签页变工作台的 3 秒 GIF -->

## 起因：一个别扭的日常

程序员一天要开几十次新标签页。以前那里是空白，或者一个搜索框。

同时，我用 AI 工具的方式一直很别扭：看到一段代码有问题，要复制 → 切到 Claude → 粘贴 → 描述上下文 → 拿回答案 → 自己动手改。AI 看不到我的页面，最后一步"动手"永远是我自己。

OpenClaw 这类系统级 agent 倒是能动手，代价是把整台电脑的 Shell 权限交给 AI，还要自备 API Key 烧钱（工信部都发了安全提醒）。

我想要个折中：AI 就住在新标签页里，看得到我看的页面，能动手但只动浏览器里的东西，最好还免费。没找到，就自己撸了一个。这就是 **CAID**（Copilot + AI + Integrated Dashboard）。

<!-- 配图：CAID 与 OpenClaw、普通 AI 工具的对比表 -->

## 这是什么

一句话：一个 Chromium 扩展（MV3，Chrome/Edge 双发），新标签页接管为程序员工作台，任意网页右下角能唤出 AI 副驾，还能用 JavaScript 自己写插件扩展它。纯前端、零构建、零后端。

核心就两件事：

1. **免费 AI 副驾不要 Key**：副驾在页面里跑，能读 DOM、能跑 JS、能搜索、能导航。你没看错，不需要 API Key，装上就能用。
2. **AI 自己造插件**：副驾有个 `create_plugin` 工具，你说"我想要一个倒计时插件"，它现场写代码、校验、装进系统，下次打开还在。

第二点是和市面所有 AI 工具的本质区别——别的产品里"AI 功能"和"插件生态"是两回事：官方写 AI，用户装插件。CAID 把两者焊死了，AI 的产出从"一段会丢失的对话"变成了"永久沉淀的功能"。

<!-- 配图：AI 造插件的 10 秒录屏，全文传播核心 -->

> **关于副驾内核**：CAID 的 AI agent 运行时基于开源项目 [Page-Agent](https://github.com/xing1/Page-Agent)（魔改 headless 版）。CAID 在它基础上做了 MV3 适配、双执行模式（自动闭环 / 手动 LLM 循环）、12 个 customTools、跨页任务续传等改造，在此感谢原作者的开源贡献。

## 架构：MV3 的三层隔离

Chromium 扩展是 MV3（Manifest V3），整个架构绕不开一个核心约束：**不同的代码跑在不同的世界，权限天差地别**。CAID 用三层把它切干净了。

```
┌───────────────────────── 浏览器 ─────────────────────────┐
│  ┌── newtab.html（工作台 + 设置 + 插件中心）──────────┐  │
│  │  └── 插件沙箱（sandbox iframe，null 源）────────┐  │  │
│  │      new Function 执行 · 受控 API · 存储隔离    │  │  │
│  │  └── 副驾运行时（caid-copilot.js，MAIN world）─┐  │  │
│  │      12 个工具 + Zod v4 输入校验 + 双模式       │  │  │
│  └──────────────────────────────────────────────────┘  │
│                          │ postMessage                  │
│  ┌── content.js（ISOLATED，页面中继）────────────────┐  │
│  └──────────────────────┬────────────────────────────┘  │
│                          │ chrome.runtime.sendMessage    │
│  ┌── background.js（MV3 Service Worker）────────────┐  │
│  │  新标签页接管 · 右键菜单 · 跨页注入 · 消息桥      │  │
│  └──────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### 为什么副驾要在 MAIN world

浏览器扩展往页面注入脚本有两种世界：**ISOLATED world**（隔离世界，扩展专用，能访问 `chrome.*` 但看不到页面 JS 上下文）和 **MAIN world**（主世界，和页面脚本同一个执行环境，能读页面的全局变量、能被页面看到，但没有 `chrome.*`）。

副驾要操作页面 DOM、要和页面脚本共存，必须在 MAIN world。但 MAIN world 没有 `chrome.*`——这意味着副驾想发个网络请求、想存个数据、想开个新标签页，都做不到。

解法是**消息桥**：副驾在 MAIN world 把请求 `postMessage` 给同页面的 content.js（ISOLATED world），content.js 再 `chrome.runtime.sendMessage` 给 background（Service Worker），由有特权的一方执行后再原路返回。

```js
// caid-copilot.js（MAIN world）—— 副驾想发请求
window.postMessage({ type: 'caid-fetch', url, options }, '*');

// content.js（ISOLATED）—— 中转
window.addEventListener('message', (e) => {
  if (e.data.type === 'caid-fetch') {
    chrome.runtime.sendMessage({ type: 'fetch', url: e.data.url }, (res) => {
      window.postMessage({ type: 'caid-fetch-resp', id: e.data.id, res }, '*');
    });
  }
});
```

这个三跳看起来啰嗦，但它是 MV3 安全模型的必然结果——特权调用必须收敛到能被审计的单一通道。后来我见过有人想在 MAIN world 直连 `chrome.runtime`，报错一脸懵，就是因为没想通这层隔离。

<!-- 配图：消息桥三跳流程图 -->

### 为什么插件要用 null 源沙箱

插件是用户写的任意 JavaScript，安全性是头等大事。MV3 扩展页的 CSP 是 `script-src 'self'`，**直接 `eval` 或 `new Function` 会被拦**（报 `unsafe-eval`）。

所以插件代码不能在扩展页直接跑。CAID 的方案是把每个插件塞进一个 **null 源的 sandbox iframe**：

```html
<iframe sandbox="allow-scripts" src="sandbox/sandbox.html"></iframe>
```

关键在两个细节：

1. **null 源**：iframe 不加 `allow-same-origin`，它的 origin 是 `null`，和父页面（`chrome-extension://...`）不同源，碰不到父页面的 DOM、localStorage、`chrome.*`，什么都拿不到。
2. **`new Function` 而非 `eval`**：sandbox 页是独立文档，CSP 由 sandbox 自己的 meta 控制，可以放开 `unsafe-eval`，于是用 `new Function` 跑插件代码。

插件要操作 UI、存数据、发请求怎么办？全部走 `postMessage` 桥回父页，父页用**受控 API** 响应。存储按 `caidPlugin:<插件id>:<key>` 命名空间隔离，插件 A 永远读不到插件 B 的数据（事件广播除外）。

这套设计的好处是：哪怕一个插件代码是恶意的，它的爆炸半径也只在自己那个 null 源 iframe 里，碰不到你的浏览器、你的文件、其他插件。约束即安全。

## 插件系统：三种视图 + 受控 API

一个插件就是一次 `CAID.plugin(def)` 调用：

```js
CAID.plugin({
  id: 'my-clock',
  name: '我的时钟',
  icon: 'clock',
  mount(api) {
    const box = api.el('div', { className: 'plugin-row' });
    api.container.appendChild(box);
    const tick = () => { box.textContent = new Date().toLocaleTimeString('zh-CN'); };
    tick();
    api.setInterval(tick, 1000);
  }
});
```

保存后自动出现在左侧边栏新区块，点标题可折叠/展开。

### 三种视图

插件能渲染在三个位置，对应三个生命周期函数：

| 视图 | 字段 | 说明 |
| ---- | ---- | ---- |
| 侧边栏区块 | `mount(api)` | 主视图，渲染在左侧边栏可折叠区块 |
| 右侧面板 | `panel(api)` | 渲染在主页面右侧面板栏 |
| 弹窗 | `modal(api)` | 定义后用 `api.modal()` 打开 |

三者至少实现一个，否则插件不加载。每个视图收到独立的 `api`，但 `storage` 和 `shared`（跨视图内存共享）是共享的。

### 受控 API 的设计哲学

核心原则：**绝不暴露 `chrome.*`**。插件能做的事，全部封装成显式 API：

| API | 说明 |
| --- | --- |
| `api.container` / `api.el()` | DOM 容器与元素创建 |
| `api.storage.get/set` | 按插件 id 隔离的本地存储 |
| `api.fetch()` | 网络请求（继承扩展跨域权限，返回标准 `Response`） |
| `api.md()` | Markdown 渲染为安全 HTML |
| `api.modal()` / `api.closeModal()` | 弹窗控制 |
| `api.setInterval` / `api.setTimeout` | 自动追踪的定时器，插件停用时自动清理 |
| `api.toast()` / `api.confirm()` | 提示与确认对话框 |
| `api.copyToClipboard()` / `api.openURL()` | 剪贴板与打开链接（`javascript:` 协议拒绝） |
| `api.onPluginEvent()` / `api.emitPluginEvent()` | 插件间事件广播 |
| `api.exportData()` / `api.importData()` | 插件数据备份恢复 |

这里有个细节值得展开：`api.fetch()` 返回的是标准 `Response`，但 `Response.body` 只能读一次。第一次 `await res.text()` 后，第二次再读就是空。解法是附一个 `res.raw` 字段保留原始信息，需要多次读的场景用两次独立请求。这种 Web API 的坑封装进 API 比让插件作者自己踩强。

设置回调还会做脱敏——`apiKey` 打码成 `sk-***...***`，插件永远拿不到完整密钥。这是受控 API 的另一面：不仅限制能做什么，还限制能看到什么。

## 最得意的一个功能：AI 自己造插件

讲到这里，前面都还是"一个不错的浏览器插件平台"。真正让 CAID 和所有 AI 工具拉开差距的，是这一个工具。

副驾有 12 个 customTools，其中最特别的是 `create_plugin`。流程是这样的：

1. 你对副驾说："我想要一个番茄钟插件，25 分钟工作 5 分钟休息，到点弹通知"
2. 副驾调用 `create_plugin`，把自然语言转成完整的 `CAID.plugin(def)` 代码
3. 代码送进沙箱做 `validate`（只回传可序列化的元数据：`{id, name, icon, hasPanel, hasModal}`）
4. 校验通过 → `chrome.runtime.sendMessage` 到 background → 合并写进 `caidPlugins` 列表
5. 插件出现在侧边栏，**下次打开浏览器还在**

这件事的意义在于：AI 的产出不再是聊天框里一段会滚走的代码，而是一个**永久沉淀进你工作台的功能**。用得越多，工作台越贴合你——这个飞轮是普通 AI 工具没有的。

别的产品里"AI 功能"和"插件生态"是两条腿：官方写 AI，用户装插件，互不相干。CAID 把 AI 变成了插件的作者，用户变成了甲方。这个角色反转是我觉得最对的地方。

<!-- 配图：AI 造番茄钟插件的录屏 -->

## 踩过的几个坑

开发过程里踩的坑不少，挑几个有意思的讲。

### 坑一：Zod v4 的假 schema 骗不过解析器

副驾的 12 个工具都有 `inputSchema` 做输入校验，用的是 Zod。我一开始图省事，用了个 duck-typed 的假 schema——构造一个带 `_zod` 标记的普通对象，假装它是 Zod schema。

结果 v4 的解析器根本不认。`z.toJSONSchema(schema)` 是个独立函数，不是 schema 的方法，它内部会检查真实的 Zod 内部结构，duck-typed 的假对象一进去就炸。

正确做法是必须用真实的 Zod v4 schema：

```js
const { z } = window.ZodV4;  // 真 v4
const schema = z.object({
  query: z.string().describe('搜索关键词'),
  limit: z.number().optional().default(10)
});
const jsonSchema = z.toJSONSchema(schema);  // 独立函数
```

这个坑的教训是：别想骗过库的内部校验，该用真 schema 就用真 schema，省下来的那点代码不值得。

### 坑二：续传 goal 嵌套雪球

CAID 有个"任务续传"功能：副驾在 A 页面跑着任务，跳转到 B 页面后能接着跑。实现是把当前 goal 存进 `storage.session`，新页面注入后续传上下文。

但有个隐蔽的 bug：续传时我把上一次的 `recent`（最近对话历史）灌回了 `agent.history`。问题是，注入的"【任务续传】你正在协助用户完成：..."这段文本本身成了 history 里的一条 user 消息。下次提取 goal 时，倒序找 user 消息，把**续传文本本身**当成了 goal。

于是每跳一层，goal 前面就多一层"【任务续传】你正在协助用户完成：【任务续传】你正在协助用户完成：..."前缀，recent 也滚雪球，原始目标被彻底淹没，AI 越跑越懵。

修复是四点联动：

1. 新增 `_originalGoal`：只有 `indexOf('【任务续传】') !== 0` 的任务才更新它（续传指令不覆盖真实目标）
2. goal 提取链改成：`_originalGoal` 优先 → history 里非续传的 user 消息 → 输入框 → `_currentGoal`
3. `resumeIfNeeded` 不再把 `recent` 灌回 history，改成只读摘要（每条 120 字符上限）拼进续传指令
4. `cleanResumeGoal()` 兜底剥壳：消化旧格式已嵌套的 goal 残留

这个 bug 最阴间的地方在于：它不影响单页任务，只在跨页续传时才出现，而且第一次续传看不出来，要跳两三层才显形。测试覆盖不到就漏过去了。

### 坑三：MV3 的 Service Worker 会睡

MV3 的 background 是 Service Worker，空闲一段时间会被浏览器杀掉，内存里的状态全没。

最早我在 `maybeTakeoverNewTab` 里用了一个内存缓存变量 `caidNewtabEnabledCache`，配 `storage.onChanged` 监听同步。结果发现：SW 被杀重启后，缓存是空的，监听也没了，接管逻辑就失效了。

解法很朴素：**别信内存，每次实时读 storage**。

```js
async function maybeTakeoverNewTab(tab) {
  const { caidNewtabEnabled } = await chrome.storage.local.get('caidNewtabEnabled');
  // 不用缓存，每次 await 真实读
  if (!isNewTabUrl(tab.url)) return;
  // ... 接管逻辑
}
```

MV3 时代，任何"用内存缓存加速"的冲动都得忍住，SW 随时会睡，缓存随时会丢，老老实实读 storage 最稳。

## 装上试试

安装三步：

1. 下载 `caid-extension.crx`（GitHub 仓库有）
2. 打开 `chrome://extensions`（Edge 是 `edge://extensions`），开启右上角「开发者模式」
3. 把 crx 拖进页面，确认安装

新建标签页即被接管为工作台，任意网页右下角出现副驾浮动按钮。

**关于免费 Key**：副驾默认走一个免费代理（第三方部署的函数计算服务），代持了 DashScope 的 Key，所以你不用填任何 Key 就能用。代价是流量经过那个代理，模型锁死为 `qwen3.5-plus`。介意隐私或想用更强模型的，在设置里填自己的 baseURL + Key 直连。

GitHub 仓库：`CqwqY/CAID`，MIT 协议，欢迎来 star。

## 最后

CAID 的定位很明确：不是要替代 OpenClaw，也不是要和 Claude 网页版比通用能力。它要的是程序员浏览器里那块最高频的屏幕——新标签页，和那个"看到代码就想问一句"的瞬间。

免费、零配置、装上就能用、AI 还能给你造工具。如果你也是每天在浏览器里写代码的人，试试看。

<!-- 配图：GitHub 仓库截图 + star 按钮 -->

---

> 仓库地址：[github.com/CqwqY/CAID](https://github.com/CqwqY/CAID)
> 插件开发完整 API 见 `caid-extension/PLUGINS.md`
> 问题反馈开 issue，想要什么插件也可以在 issue 里说，说不定副驾自己就给你写了。
