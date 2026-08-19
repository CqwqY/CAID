# CAID 插件开发指南

CAID 新标签页（扩展版）支持用 JavaScript 自制侧边栏区块，**零部署、纯前端**。
你写的代码运行在「轻量沙箱」中，只暴露一组受控 API，安全可控，且代码存在你自己浏览器本地。

> 入口：扩展新标签页 → 左下角「设置」→「插件」标签页。
> 那里有「插入模板」按钮和「插件开发指南」，可以边看边写。

---

## 一个插件长什么样

一个插件就是调用一次 `CAID.plugin(def)`。最小例子：

```js
CAID.plugin({
  id: 'my-clock',          // 唯一标识，英文，如 my-clock
  name: '我的时钟',         // 侧边栏显示的名称
  icon: 'clock',           // lucide 图标名（留空用 puzzle）
  mount(api) {             // 渲染函数，注入时调用一次
    const box = api.el('div', { className: 'plugin-row' });
    api.container.appendChild(box);
    const tick = () => { box.textContent = new Date().toLocaleTimeString('zh-CN'); };
    tick();
    api.setInterval(tick, 1000);
  }
});
```

保存后会自动出现在左侧边栏一个新的区块里，点标题可折叠/展开。

---

## def 字段

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | ✅ | 唯一标识，英文数字与 `-`。重复会提示冲突 |
| `name` | ✅ | 侧边栏显示的名称 |
| `icon` | ⬜ | lucide 图标名（[图标列表](https://lucide.dev/icons)），如 `clock` / `notebook` / `rss`，留空用 `puzzle` |
| `mount(api)` | ⬜ | **侧边栏视图**。渲染函数，注入时调用一次，用 `api` 操作你的区块 |
| `panel(api)` | ⬜ | **右侧面板视图**。定义了它，插件内容会显示在主页面右侧的面板栏（顶部有移除按钮） |
| `modal(api)` | ⬜ | **弹窗视图**。定义了它，插件才能用 `api.modal()` 打开弹窗，内容渲染在弹窗里 |

> `mount` / `panel` / `modal` 至少实现一个，否则插件不会被加载。
> 每个视图函数都会收到独立的新 `api`（各自的 `container`，各自独立运行），但 `storage` 与 `shared` 是共享的——同一个插件 id 的持久数据和内存变量在三个视图里都能读到。

> 设置面板里的「名称 / 图标」输入框可以覆盖代码里的 `name` / `icon`，方便不改代码就改名。

---

## 受控 API（`mount(api)` 收到的 `api`）

| API | 说明 |
|-----|------|
| `api.container` | 你的内容容器（DOM 节点），往里 `appendChild` 即可 |
| `api.el(tag, props?)` | 创建 DOM 节点。`props` 支持 `className` / `text` / `html` / `onClick` / `style`(对象) / `dataset`(对象) / 其他属性 `setAttribute` |
| `api.storage.get(key)` / `api.storage.set(key, val)` | 按**插件 id 隔离**的本地存储（异步，返回 Promise），不会和别的插件或 CAID 本身冲突 |
| `api.fetch(url, opt?)` | 发起网络请求（继承扩展的跨域权限，`<all_urls>`）。**返回标准 `Response` 对象**：`res.ok` / `res.status` / `await res.text()` / `await res.json()` 与浏览器一致；另附 `res.raw`（`{ ok, status, statusText, text, json, headers }`）兼容旧版字段 |
| `api.shared` | 跨视图共享的内存对象（见下文「多视图共享变量」） |
| `api.md(text)` | 把 Markdown 文本渲染成**安全 HTML 字符串**（见下文「富文本渲染」）。用法：`api.container.innerHTML = api.md('**你好**')` |
| `api.toast(msg)` | 弹出一个提示 |
| `api.setInterval(fn, ms)` / `api.setTimeout(fn, ms)` | 被自动追踪的定时器，插件停用/删除时会自动清理，**优先用这两个而非全局定时器** |
| `api.onUnmount(fn)` | 插件被停用/删除时执行的一次性清理函数（如取消订阅、移除监听） |
| `api.modal(opts?)` | 打开本插件的弹窗（需定义 `modal(api)` 视图）。`opts`：`{ title, width }`，返回 Promise |
| `api.closeModal()` | 关闭当前弹窗（在 `modal` 视图内调用） |

### 沙箱说明（轻量）

插件代码运行在 `new Function` 中，`chrome` 与 `localStorage` 被屏蔽为 `undefined`——
插件**必须**通过 `api.storage` 读写持久数据，不能直接碰扩展内部存储。
`document` / `fetch` / 全局定时器仍然可用（插件渲染和网络请求需要它们）。
这不是安全隔离边界，而是便利性沙箱；因为代码是你自己写的，风险可控。

三个视图（mount / panel / modal）各自运行在独立的沙箱帧里，**JS 变量天然隔离**——
视图间要传数据请用共享 API，不要依赖全局变量：

| 需求 | 用什么 |
|------|--------|
| 持久化数据（刷新后还在） | `api.storage`（按插件 id 隔离） |
| 会话内共享变量（刷新即清空） | `api.shared`（见下） |

---

## 多视图共享变量（`api.shared`）

`api.shared` 是同一插件三个视图**共享的同一个内存对象**：任一视图改了它的属性，其他视图立刻能读到（父页面中转 + 广播）。适合「侧边栏点按钮 → 右侧面板更新」这类联动。

```js
CAID.plugin({
  id: 'shared-demo',
  name: '共享计数',
  icon: 'share-2',
  mount(api) {
    // 侧边栏：点击加一
    api.shared.count = api.shared.count || 0;      // 初始化（幂等）
    const box = api.el('div', { className: 'plugin-row' });
    api.container.appendChild(box);
    const btn = api.el('button', {
      text: '加一（当前 ' + api.shared.count + '）',
      onClick: () => {
        api.shared.count = (api.shared.count || 0) + 1;   // 广播给其他视图
        btn.textContent = '加一（当前 ' + api.shared.count + '）';
      }
    });
    api.container.appendChild(btn);
  },
  panel(api) {
    // 右侧面板：实时显示共享计数
    const box = api.el('div', { className: 'plugin-row', text: '计数：0' });
    api.container.appendChild(box);
    api.setInterval(() => {
      box.textContent = '计数：' + (api.shared.count || 0);
    }, 500);
  }
});
```

> `api.shared` 只存内存：刷新页面后清空。需要跨刷新保留的数据请用 `api.storage`。

---

## 富文本渲染（`api.md`）

插件经常要展示格式化的文本（AI 回复、日志、说明……）。`api.md(text)` 把 Markdown 渲染成**安全 HTML 字符串**，直接赋给容器的 `innerHTML` 即可，样式已内置（暗色主题）：

```js
CAID.plugin({
  id: 'md-demo',
  name: '富文本示例',
  icon: 'file-text',
  mount(api) {
    api.container.innerHTML = api.md([
      '# 你好，CAID',
      '',
      '支持 **加粗**、*斜体*、`行内代码` 和 [链接](https://example.com)：',
      '',
      '- 列表项一',
      '- 列表项二',
      '',
      '```js',
      'console.log("代码块");',
      '```',
      '',
      '> 引用块，以及表格：',
      '',
      '| 列A | 列B |',
      '|-----|-----|',
      '| 1   | 2   |'
    ].join('\n'));
  }
});
```

支持语法：围栏代码块、行内代码、标题 1-4、有序/无序列表、引用块、表格、分隔线、加粗、斜体、链接。

> **安全说明**：`api.md` 内部先转义再替换，链接只放行 `http(s)` 协议（`javascript:` 等一律不会渲染成可点击链接），可以放心把**不可信文本**（如用户输入、远程返回的内容）交给它渲染。**不要**用它返回的 HTML 再拼字符串二次插入。

---

## 完整示例

### 1. 实时时钟（模板同款）

```js
CAID.plugin({
  id: 'my-clock',
  name: '我的时钟',
  icon: 'clock',
  mount(api) {
    const box = api.el('div', { className: 'plugin-row' });
    api.container.appendChild(box);
    const tick = () => {
      const d = new Date();
      box.textContent = d.toLocaleTimeString('zh-CN');
      box.style.color = 'var(--muted)';
    };
    tick();
    api.setInterval(tick, 1000);
  }
});
```

### 2. 速记便签（带本地存储）

```js
CAID.plugin({
  id: 'quick-note',
  name: '速记便签',
  icon: 'notebook',
  async mount(api) {
    const ta = api.el('textarea', {
      className: 'plugin-row',
      style: { width: '100%', minHeight: '64px', background: 'var(--bg3,#16202c)',
               color: 'var(--text)', border: '1px solid var(--rule)', borderRadius: '8px',
               padding: '8px', resize: 'vertical', font: '12px monospace' }
    });
    ta.value = (await api.storage.get('note')) || '';
    ta.addEventListener('input', () => api.storage.set('note', ta.value));
    api.container.appendChild(ta);
  }
});
```

### 3. 外部探活卡（复用 URL 监控思路）

```js
CAID.plugin({
  id: 'site-ping',
  name: '博客在线',
  icon: 'globe',
  mount(api) {
    const box = api.el('div', { className: 'plugin-row' });
    api.container.appendChild(box);
    const url = 'https://www.baidu.com';   // 换成你想盯的网址
    const check = async () => {
      const t0 = Date.now();
      try {
        await api.fetch(url, { mode: 'no-cors' });
        box.innerHTML = '<span style="color:var(--success,#3DD68C)">● 在线</span> ' + (Date.now() - t0) + 'ms';
      } catch (e) {
        box.innerHTML = '<span style="color:var(--danger)">● 离线</span>';
      }
    };
    check();
    api.setInterval(check, 30000);
  }
});
```

### 4. 多视图：侧边栏 + 右侧面板 + 弹窗

`mount` 管侧边栏，`panel` 管右侧面板，`modal` 管弹窗——三个视图共用同一份 `storage`（持久数据）和 `shared`（内存变量）：

```js
CAID.plugin({
  id: 'multi-view-demo',
  name: '多视图示例',
  icon: 'layout-dashboard',
  // 侧边栏：一个按钮
  mount(api) {
    const btn = api.el('button', {
      text: '打开设置弹窗',
      onClick: () => api.modal({ title: '我的弹窗', width: 480 }),
      style: { width: '100%', padding: '8px', borderRadius: '8px',
               border: '1px solid var(--rule)', background: 'var(--bg3,#16202c)',
               color: 'var(--text)', cursor: 'pointer' }
    });
    api.container.appendChild(btn);
  },
  // 右侧面板：显示当前时间，可手动移除
  panel(api) {
    const box = api.el('div', { className: 'plugin-row', text: '--:--' });
    api.container.appendChild(box);
    const tick = () => { box.textContent = new Date().toLocaleTimeString('zh-CN'); };
    tick();
    api.setInterval(tick, 1000);
  },
  // 弹窗：倒计时关闭（调 api.closeModal 主动关闭）
  modal(api) {
    const box = api.el('div', { className: 'plugin-row', text: '3 秒后自动关闭…' });
    api.container.appendChild(box);
    let n = 3;
    const timer = api.setInterval(() => {
      n--;
      box.textContent = n + ' 秒后自动关闭…';
      if (n <= 0) { clearInterval(timer); api.closeModal(); }
    }, 1000);
  }
});
```

---

## 提示

- 改代码后点「更新插件」（或保存为新插件），侧边栏会自动重新挂载。
- 插件列表里有「启用/停用」开关和「删除」，删除会同时清理侧边栏区块与运行时。
- 报错会在侧边栏区块里显示具体原因；语法错误会在保存时提示。
- 想要更多灵感：时钟、速记、计数器、番茄钟、RSS 标题、GitHub 通知数……都可以用上面的 API 拼出来。
