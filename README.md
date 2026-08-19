# CAID · 浏览器扩展 · 插件系统

> **C**opilot + **A**I + **I**ntegrated **D**ashboard —— 装进新标签页的程序员工作台，更是一个可编程的浏览器插件平台。

Chromium 扩展（MV3，Chrome + Edge 双发），纯前端、零构建、零后端。新标签页即工作台，任意网页可唤出 AI 副驾；侧边栏区块 / 右侧面板 / 弹窗，全部可由你手写 JavaScript 插件自由扩展。

---

## ⚠️ 开发重心

- **主站**（`index.html` 单文件版，GitHub Pages）**已暂停维护**，仅作存档展示：<https://graduate.dpdns.org/>
- **全力开发扩展**：所有新特性都在 `caid-extension/` 落地，**插件系统是当前的核心方向**

---

## ✨ 扩展特性

- **新标签页接管**：新建标签页自动打开 CAID 工作台（常驻开启；需恢复默认请在扩展管理页停用/卸载）
- **跨页 AI 副驾**：任意网页右下角浮动按钮唤起副驾，MAIN world 运行、绕过页面脚本干扰；选中文本 → 右键 → 附带上文启动
- **轻量插件系统**：见下一节，这是扩展的灵魂
- **数据本地化**：设置、插件、副驾配置全部存于浏览器本地，不依赖任何后端

## 🧩 插件系统（核心）

用 JavaScript 自制功能区块，**零部署、纯前端、代码存你自己浏览器本地**。入口：新标签页 → 左下角「设置」→「插件」。

一个插件就是一次 `CAID.plugin(def)`：

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

| 视图 | 字段 | 说明 |
|---|---|---|
| 侧边栏区块 | `mount(api)` | 主视图，内容渲染在左侧边栏可折叠区块 |
| 右侧面板 | `panel(api)` | 内容显示在主页面右侧的面板栏（顶部有移除按钮） |
| 弹窗 | `modal(api)` | 定义后可用 `api.modal()` 打开弹窗 |

> `mount` / `panel` / `modal` 至少实现一个，否则插件不会被加载。每个视图收到独立的 `api`，但 `storage` 与 `shared` 跨视图共享。

### 受控 API（节选）

| API | 说明 |
|---|---|
| `api.container` / `api.el()` | DOM 容器与元素创建 |
| `api.storage.get/set` | 按插件 id 隔离的本地存储（异步） |
| `api.fetch()` | 网络请求（继承扩展 `<all_urls>` 跨域权限，返回标准 `Response`） |
| `api.md()` | Markdown 渲染为安全 HTML |
| `api.modal()` / `api.closeModal()` | 弹窗控制 |
| `api.setInterval` / `api.setTimeout` | 自动追踪的定时器，插件停用/删除时自动清理 |
| `api.toast()` / `api.confirm()` | 提示与自定义确认对话框 |
| `api.copyToClipboard()` / `api.openURL()` | 剪贴板与打开链接（`javascript:` 拒绝） |
| `api.onPluginEvent()` / `api.emitPluginEvent()` | 插件间事件广播/监听 |
| `api.exportData()` / `api.importData()` | 插件数据备份 / 恢复 |
| `api.getVersion()` / `api.getLocale()` / `api.isDarkMode()` | 环境信息 |
| `api.onUnmount()` | 停用/删除时的一次性清理 |

完整 API 见 [插件开发指南](caid-extension/PLUGINS.md)。

### 安全设计

- 插件代码在 **null 源 sandbox iframe** 中用 `new Function` 执行（扩展页 CSP 禁 eval），接触不到父页面 DOM 与 `chrome.*`
- 仅暴露受控 API；存储按 `caidPlugin:<id>:<key>` 命名空间隔离，插件之间互不可见（事件广播除外）
- 设置回调脱敏（`apiKey` 打码），插件拿不到完整密钥

---

## 🚀 快速开始

### 安装扩展

**直接下载（推荐）**：[📦 下载 caid-extension.crx](caid-extension.crx?raw=1)（已签名打包，~500KB）

1. 打开浏览器扩展管理页：Chrome `chrome://extensions` / Edge `edge://extensions`
2. 开启右上角「开发者模式」
3. 把下载好的 `.crx` 文件直接拖进页面，确认安装
4. 新建标签页即被接管为 CAID 工作台；任意网页右下角出现副驾浮动按钮

> 若拖拽安装被浏览器拦截或提示包无效，改用源码加载：克隆仓库 → 开发者模式 →「加载已解压的扩展程序」→ 选择 `caid-extension/` 目录。

### 写第一个插件

新标签页 → 左下角「设置」→「插件」→「插入模板」，在编辑框里改代码，保存即生效。详细教程、完整 API 与插件间通信示例见 [插件开发指南](caid-extension/PLUGINS.md)。

---

## 🏗️ 架构

```
┌───────────────────────── 浏览器 ─────────────────────────┐
│                                                          │
│  ┌── newtab.html（工作台 + 设置 + 插件中心）──────────┐  │
│  │  └── 插件沙箱（sandbox iframe，null 源）────────┐  │  │
│  │      new Function 执行 · 受控 API · 存储隔离    │  │  │
│  │  └── 副驾运行时（caid-copilot.js，MAIN world）─┐  │  │
│  │      工具 + Zod v4 输入校验 + 双模式           │  │  │
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

**关键设计**

- **MAIN / ISOLATED 隔离**：副驾在页面 MAIN world 运行（避免被页面脚本干扰）；`chrome.*` 特权调用一律 `postMessage → content.js → background` 桥接
- **Zod v4 真实 schema**：副驾工具输入校验使用真 v4（`window.ZodV4.z`），非法调用在工具入口即被拦截
- **插件沙箱**：null 源 iframe + `new Function`，不暴露 `chrome.*`，存储按插件 id 隔离
- **单文件无构建**：`newtab.html` 是主站 `index.html` 的扩展版副本，改完刷新即生效

---

## 📁 目录结构

```
├── caid-extension/            # ★ 当前开发重心：Chromium 扩展（Chrome + Edge）
│   ├── manifest.json          # MV3 清单
│   ├── newtab.html            # 扩展版工作台（含设置 / 插件中心）
│   ├── newtab-main.js         # 扩展版逻辑
│   ├── background.js          # Service Worker：接管 / 右键 / 注入 / 桥
│   ├── content.js             # 站外页面中继（浮动按钮、消息桥）
│   ├── caid-copilot.js        # 副驾运行时（MAIN world）
│   ├── caid-bridge.js         # 主站页桥（扩展内）
│   ├── sandbox/               # 插件沙箱页
│   ├── icons/                 # 扩展图标
│   ├── PLUGINS.md             # ★ 插件开发指南（完整 API）
│   └── CHANGELOG.md           # 版本历史
├── index.html                 # 主站工作台（单文件 SPA，已暂停维护）
├── lib/                       # 主站依赖（zod-v4 / page-agent.headless 等）
├── favicon.svg / CNAME        # GitHub Pages 存档
└── vendor/                    # 第三方参考实现
```

---

## 📚 文档

| 文档 | 说明 |
|---|---|
| [插件开发指南](caid-extension/PLUGINS.md) | 手写插件的完整 API、三视图、插件间通信与示例 |
| [更新日志](caid-extension/CHANGELOG.md) | 扩展版本历史（Keep a Changelog 风格） |

---

## 🛠️ 技术栈

- **运行时**：原生 HTML/CSS/JS（ES2020+），Chromium MV3
- **副驾内核**：[Page-Agent](https://github.com/xing1/Page-Agent)（魔改 headless 版）
- **校验**：Zod v4
- **持久化**：`chrome.storage.local` + `localStorage`（双写互通）

---

## 🤝 参与开发

- 改代码 → `node --check` 校验语法 → 提交；主站已暂停维护，新功能一律进扩展
- 每次提交扩展改动，请同步更新 `caid-extension/CHANGELOG.md`
- 插件 API 变更请同步更新 `caid-extension/PLUGINS.md`

---

## 📄 License

MIT
