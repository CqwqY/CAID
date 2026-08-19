# CAID · 程序员工作台

> **C**opilot + **A**I + **I**ntegrated **D**ashboard —— 把 AI 副驾、搜索、快捷入口、代码片段和待办收进一个页面，装进你的新标签页。

纯前端单文件 SPA，零构建、零后端、零 npm 依赖。新标签页即工作台，任意网页可唤出 AI 副驾。

🌐 在线体验：<https://graduate.dpdns.org/>

---

## ✨ 特性

### 🖥️ 程序员工作台
- **多引擎搜索**：Bing / Google / DuckDuckGo 一键切换，回车直达
- **AI 回答**：搜索框直接提问，LLM 流式回答（DashScope 免费代理或自定义 API）
- **快捷方式**：自定义常用站点入口，图标 + 颜色 + 分组
- **代码片段**：多语言标签管理、全文检索、一键复制、自动补全
- **待办清单**：优先级、进度条、持久化本地
- **整页时钟问候**、沉浸深色玻璃态 UI

### 🤖 AI 副驾（魔改 Page-Agent，最大特色）
- **双模式**：
  - `自动模式`：Agent 自主规划 + 调用工具闭环执行（`agent.execute()`）
  - `手动模式`：自建 LLM 循环，逐步确认
- **12 个内置工具**：导航、搜索、填表、取数、爬取等
- **跨页注入**：Bookmarklet 一键把副驾带到任意网页
- **快捷开关**：`Ctrl + I + L`
- **LLM 配置**：DashScope 免费代理（无需 Key）或自定义 BaseURL/Key；无 Key 时规则引擎兜底

### 🧩 浏览器扩展（Chromium MV3，`caid-extension/`）
- **新标签页接管**：新建标签页自动打开工作台（常驻开启；需恢复默认请在扩展管理页停用/卸载）
- **跨页副驾**：任意网页右下角浮动按钮唤起副驾，MAIN world 运行时，绕过页面脚本干扰
- **右键启动**：选中文本 → 右键 → CAID 副驾（附带上文）
- **轻量插件系统**：侧边栏区块 / 右侧面板 / 弹窗三种视图，纯 JS 编写、沙箱运行、本地存储，详见 [插件开发指南](caid-extension/PLUGINS.md)
- **数据双写**：`localStorage` + `chrome.storage`，主页与扩展状态互通

---

## 🚀 快速开始

### 方式一：直接用（推荐）
访问 <https://graduate.dpdns.org/>，或安装扩展把它变成你的新标签页。

### 方式二：本地运行
```bash
git clone https://github.com/CqwqY/CAID.git
cd CAID
python -m http.server 8000
# 打开 http://localhost:8000
```

### 方式三：安装浏览器扩展
1. 克隆仓库，打开浏览器扩展管理页：
   - Chrome：`chrome://extensions`
   - Edge：`edge://extensions`
2. 开启「开发者模式」→「加载已解压的扩展程序」→ 选择 `caid-extension/` 目录
3. 新建标签页即被接管为 CAID 工作台；任意网页右下角出现副驾浮动按钮

---

## 🏗️ 架构

```
┌───────────────────────── 浏览器 ─────────────────────────┐
│                                                          │
│  ┌── CAID 工作台（index.html / newtab.html）──────────┐  │
│  │  搜索 · 快捷方式 · 片段 · 待办 · AI 回答           │  │
│  │  └── 副驾运行时（caid-copilot.js，MAIN world）──┐  │  │
│  │      12 tools + Zod v4 输入校验 + 双模式         │  │  │
│  │  └── 插件沙箱（sandbox iframe，null 源）────────┐  │  │
│  │      new Function 执行 · storage/fetch 桥接     │  │  │
│  └──────────────────────────────────────────────────┘  │
│                          │ postMessage                  │
│  ┌── content.js（ISOLATED，页面中继）────────────────┐  │
│  └──────────────────────┬────────────────────────────┘  │
│                          │ chrome.runtime.sendMessage    │
│  ┌── background.js（MV3 Service Worker）────────────┐  │
│  │  新标签页接管 · 右键菜单 · 跨页注入 · LLM 代理    │  │
│  └──────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

**关键设计**
- **单文件无构建**：工作台是一个 `index.html`（含全部 CSS/JS），`lib/` 放依赖，改完即生效
- **Zod v4 真实 schema**：customTools 输入校验使用真 v4（`window.ZodV4.z`），非法调用在工具入口即被拦截
- **MAIN / ISOLATED 隔离**：副驾在页面 MAIN world 运行（避免被页面脚本干扰）；`chrome.*` 等特权调用一律 `postMessage → content.js → background` 桥接
- **插件沙箱**：插件代码在 null 源 sandbox iframe 中用 `new Function` 执行（扩展页 CSP 禁 eval），仅暴露受控 API，存储按 `caidPlugin:<id>:<key>` 隔离

---

## 📁 目录结构

```
├── index.html                 # 主站工作台（单文件 SPA，约 5.7k 行）
├── favicon.svg                # 站点图标
├── CNAME                      # GitHub Pages 自定义域名
├── lib/                       # 主站依赖
│   ├── page-agent.headless.js # 魔改版 Page-Agent（副驾内核）
│   ├── zod-v4.umd.js          # Zod v4（工具输入校验）
│   └── zod3.umd.js / zod3.esm.js
├── caid-extension/            # Chromium 扩展（Chrome + Edge 双发）
│   ├── manifest.json          # MV3 清单
│   ├── newtab.html            # 扩展版工作台（= 主站副本）
│   ├── newtab-main.js         # 扩展版逻辑
│   ├── background.js          # Service Worker：接管/右键/注入/桥
│   ├── content.js             # 站外页面中继（浮动按钮、消息桥）
│   ├── caid-copilot.js        # 副驾运行时（MAIN world）
│   ├── caid-bridge.js         # 主站页桥（扩展内）
│   ├── sandbox/               # 插件沙箱页
│   ├── PLUGINS.md             # 插件开发指南
│   └── CHANGELOG.md           # 版本历史
└── vendor/                    # 第三方参考实现
```

---

## 📚 文档

| 文档 | 说明 |
|---|---|
| [插件开发指南](caid-extension/PLUGINS.md) | 手写插件的完整 API 与示例（零部署、纯前端） |
| [更新日志](caid-extension/CHANGELOG.md) | 扩展版本历史（Keep a Changelog 风格） |

---

## 🛠️ 技术栈

纯前端，无构建步骤：

- **运行时**：原生 HTML/CSS/JS（ES2020+）
- **副驾内核**：[Page-Agent](https://github.com/xing1/Page-Agent)（魔改 headless 版）
- **校验**：Zod v4
- **图标**：Lucide
- **持久化**：localStorage + IndexedDB（Dexie）
- **渲染**：Marked + highlight.js
- **部署**：GitHub Pages（push `main` 自动发布到 `graduate.dpdns.org`）

---

## 🤝 参与开发

- 工作台与扩展均为纯前端，改代码 → `node --check` 校验语法 → 提交
- 主站功能命名统一 `caid*` 前缀
- 每次提交扩展相关改动，请同步更新 `caid-extension/CHANGELOG.md`
- 详细架构结论与踩坑记录见项目记忆（`.workbuddy/memory/`）

---

## 📄 License

MIT
