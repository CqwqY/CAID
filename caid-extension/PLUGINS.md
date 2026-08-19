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
| `mount(api)` | ✅ | 渲染函数，注入时调用一次，用 `api` 操作你的区块 |

> 设置面板里的「名称 / 图标」输入框可以覆盖代码里的 `name` / `icon`，方便不改代码就改名。

---

## 受控 API（`mount(api)` 收到的 `api`）

| API | 说明 |
|-----|------|
| `api.container` | 你的内容容器（DOM 节点），往里 `appendChild` 即可 |
| `api.el(tag, props?)` | 创建 DOM 节点。`props` 支持 `className` / `text` / `html` / `onClick` / `style`(对象) / `dataset`(对象) / 其他属性 `setAttribute` |
| `api.storage.get(key)` / `api.storage.set(key, val)` | 按**插件 id 隔离**的本地存储（异步，返回 Promise），不会和别的插件或 CAID 本身冲突 |
| `api.fetch(url, opt?)` | 发起网络请求（继承扩展的跨域权限，`<all_urls>`） |
| `api.toast(msg)` | 弹出一个提示 |
| `api.setInterval(fn, ms)` / `api.setTimeout(fn, ms)` | 被自动追踪的定时器，插件停用/删除时会自动清理，**优先用这两个而非全局定时器** |
| `api.onUnmount(fn)` | 插件被停用/删除时执行的一次性清理函数（如取消订阅、移除监听） |

### 沙箱说明（轻量）

插件代码运行在 `new Function` 中，`chrome` 与 `localStorage` 被屏蔽为 `undefined`——
插件**必须**通过 `api.storage` 读写持久数据，不能直接碰扩展内部存储。
`document` / `fetch` / 全局定时器仍然可用（插件渲染和网络请求需要它们）。
这不是安全隔离边界，而是便利性沙箱；因为代码是你自己写的，风险可控。

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

---

## 提示

- 改代码后点「更新插件」（或保存为新插件），侧边栏会自动重新挂载。
- 插件列表里有「启用/停用」开关和「删除」，删除会同时清理侧边栏区块与运行时。
- 报错会在侧边栏区块里显示具体原因；语法错误会在保存时提示。
- 想要更多灵感：时钟、速记、计数器、番茄钟、RSS 标题、GitHub 通知数……都可以用上面的 API 拼出来。
