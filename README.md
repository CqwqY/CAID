# CAID · 浏览器扩展 · 程序员工作台（纯净版）

> **C**opilot + **A**I + **I**ntegrated **D**ashboard —— 装进浏览器的程序员工作台，更是一个可编程的浏览器插件平台。

Chromium 扩展（MV3，Chrome + Edge 双发），纯前端、零构建、零后端。**不接管浏览器原生新标签页**，在任意网页可唤出 AI 副驾；侧边栏区块 / 主面板 / 弹窗，全部可由你手写 JavaScript 插件自由扩展。

---

## ⚠️ 开发重心

- **纯净版 `caid-extension-lite/` 是唯一迭代版本**：保留浏览器原生新标签页（不接管），仅提供「选项」入口打开工作台设置页，并在任意网页提供跨页智能体副驾。
- **完整版 `caid-extension/` 已不再迭代**（曾接管新标签页的旧版），保留作参考。
- 所有改版、版本记录都只维护在纯净版 `caid-extension-lite/CHANGELOG.md`。

---

## ✨ 纯净版特性

- **不占用新标签页**：保留浏览器原生新标签页，零侵入。右键点扩展图标 →「选项」即可打开工作台设置页。
- **跨页 AI 副驾**：任意网页右下角浮球唤起副驾，MAIN world 运行、绕过页面脚本干扰；选中文本 → 右键 → 附带上文启动。支持 **AI 回答** 与 **Bing 搜索** 双模式、待办、长期记忆。
- **第六感 · 主动协助**（测试版）：采集行为信号（停留、滚动、复制、搜索）在本地推断意图，弹一条轻量气泡建议，点击即唤醒副驾执行对应任务；内置 17 个场景 + 规则表化可扩展，触发场景逐项可开关。全程本机处理，不记录页面正文。
- **轻量插件系统**：用 JavaScript 自制功能区块，零部署、代码存你自己浏览器本地。
- **服务器监控卡片**：填一个可访问地址，零部署探测在线状态与响应速度。
- **数据本地化**：设置、插件、副驾配置全部存于浏览器本地，不依赖任何后端。

## 🧩 插件系统

用 JavaScript 自制功能区块，**零部署、纯前端、代码存你自己浏览器本地**。入口：扩展「选项」→「设置」→「插件」。

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

保存后自动出现在工作台对应视图区块，点标题可折叠/展开。

### 三种视图

| 视图      | 字段           | 说明                       |
| -------- | ------------ | ------------------------ |
| 区块       | `mount(api)` | 主视图，内容渲染在工作台区块            |
| 主面板内容  | `panel(api)` | 内容直接平铺显示在面板内（无需点击展开）   |
| 弹窗       | `modal(api)` | 定义后可用 `api.modal()` 打开弹窗 |

> `mount` / `panel` / `modal` 至少实现一个，否则插件不会被加载。每个视图收到独立的 `api`，但 `storage` 与 `shared` 跨视图共享。

### 受控 API（节选）

| API                                                          | 说明                                            |
| ------------------------------------------------------------ | --------------------------------------------- |
| `api.container` / `api.el()`                                 | DOM 容器与元素创建                                |
| `api.storage.get/set`                                        | 按插件 id 隔离的本地存储（异步）                           |
| `api.fetch()`                                                | 网络请求（继承扩展 `<all_urls>` 跨域权限，返回标准 `Response`） |
| `api.md()`                                                   | Markdown 渲染为安全 HTML                          |
| `api.modal()` / `api.closeModal()`                           | 弹窗控制                                       |
| `api.setInterval` / `api.setTimeout`                         | 自动追踪的定时器，插件停用/删除时自动清理                        |
| `api.toast()` / `api.confirm()`                              | 提示与自定义确认对话框                                  |
| `api.copyToClipboard()` / `api.openURL()`                    | 剪贴板与打开链接（`javascript:` 拒绝）                    |
| `api.onPluginEvent()` / `api.emitPluginEvent()`              | 插件间事件广播/监听                                   |
| `api.exportData()` / `api.importData()`                      | 插件数据备份 / 恢复                                  |
| `api.getVersion()` / `api.getLocale()` / `api.isDarkMode()`  | 环境信息                                        |
| `api.onUnmount()`                                            | 停用/删除时的一次性清理                                |

### 安全设计

- 插件代码在 **null 源 sandbox iframe** 中用 `new Function` 执行（扩展页 CSP 禁 eval），接触不到父页面 DOM 与 `chrome.*`
- 仅暴露受控 API；存储按 `caidPlugin:<id>:<key>` 命名空间隔离，插件之间互不可见（事件广播除外）
- 设置回调脱敏（`apiKey` 打码），插件拿不到完整密钥

---

## 🚀 快速开始

### 安装扩展

详细图文步骤见 [docs/安装教程.md](docs/安装教程.md)。要点：

1. 克隆仓库到本地；
2. 打开浏览器扩展管理页：Chrome `chrome://extensions` / Edge `edge://extensions`；
3. 开启右上角「开发者模式」；
4. 点「加载已解压的扩展程序」，选择 `caid-extension-lite/` 目录；
5. 工具栏出现 CAID 图标即安装成功：右键图标 →「选项」打开工作台设置页，任意网页右下角浮球唤起副驾。

### 写第一个插件

扩展「选项」→「设置」→「插件」→「插入模板」，在编辑框里改代码，保存即生效。

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
│  ┌── content.js（ISOLATED，页面中继 + 浮球）──────────┐  │
│  ┌── caid-sixth-sense.js（ISOLATED，第六感）─────────┐  │
│  │      行为信号 → 本地规则引擎 → 气泡 → 唤醒副驾      │  │
│  └──────────────────────┬────────────────────────────┘  │
│                          │ chrome.runtime.sendMessage    │
│  ┌── background.js（MV3 Service Worker）────────────┐  │
│  │  选项页 · 右键菜单 · 跨页注入 · 消息桥            │  │
│  └──────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

**关键设计**

- **MAIN / ISOLATED 隔离**：副驾在页面 MAIN world 运行（避免被页面脚本干扰）；`chrome.*` 特权调用一律 `postMessage → content.js → background` 桥接
- **第六感独立脚本**：`caid-sixth-sense.js` 在 ISOLATED world 随页面加载，纯本机「行为信号」推断意图，通过 `postMessage` 唤醒 MAIN world 副驾执行任务
- **Zod v4 真实 schema**：副驾工具输入校验使用真 v4（`window.ZodV4.z`），非法调用在工具入口即被拦截
- **插件沙箱**：null 源 iframe + `new Function`，不暴露 `chrome.*`，存储按插件 id 隔离
- **单文件无构建**：改完直接刷新 「选项」页即生效

---

## 📁 目录结构

```
├── caid-extension-lite/        # ★ 纯净版：当前唯一迭代版本
│   ├── manifest.json           # MV3 清单（options_ui 打开工作台，不接管新标签页）
│   ├── newtab.html             # 工作台（含设置 / 插件中心）
│   ├── newtab-main.js          # 工作台逻辑
│   ├── background.js           # Service Worker：选项页 / 右键 / 注入 / 桥
│   ├── content.js              # 站外页面中继（浮球、消息桥）
│   ├── caid-sixth-sense.js     # 第六感：行为信号 + 本地规则引擎 + 气泡（测试版）
│   ├── caid-copilot.js         # 副驾运行时（MAIN world）
│   ├── sandbox/                # 插件沙箱页
│   ├── lib/                    # 依赖（page-agent.headless / zod-v4 / zod3）
│   ├── icons/                  # 扩展图标
│   └── CHANGELOG.md            # ★ 唯一版本历史
├── caid-extension/             # 完整版（曾接管新标签页，已停迭代，存参考）
├── docs/安装教程.md            # 纯净版安装 / 加载教程
├── index.html                  # 旧主站 SPA（已暂停维护，GitHub Pages 存档）
├── lib/  favicon.svg / CNAME   # 主站存档依赖
├── pageimg/  outputs/          # 资源 / 图标设计稿
└── vendor/                     # 第三方参考实现
```

---

## 🛠️ 技术栈

- **运行时**：原生 HTML/CSS/JS（ES2020+），Chromium MV3
- **副驾内核**：[Page-Agent](https://github.com/xing1/Page-Agent)（魔改 headless 版）
- **校验**：Zod v4
- **持久化**：`chrome.storage.local` + `localStorage`（双写互通）

---

## 🤝 参与开发

- 改代码 → `node --check` 校验语法 → 提交
- **每次版本更新只维护 `caid-extension-lite/CHANGELOG.md`**，并同步修改 `manifest.json` 版本号与后端版本检查接口（`changelog` 仓库的 `LATEST`）
- 插件 API 变更请同步更新插件开发说明
- 完整版 `caid-extension/` 不再迭代，请勿往其中加新特性

---

## 📄 License

MIT