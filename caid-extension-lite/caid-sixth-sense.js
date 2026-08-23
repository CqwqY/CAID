// CAID 扩展 content script ——「第六感」
// ISOLATED world，随页面加载即运行（不依赖用户点击副驾圆球）。
//
// 职责：
//   1. 事件采集：停留 / 滚动 / 复制 / 搜索行为
//   2. 本地规则引擎：基于「模式化信号」推断意图（全程不记录页面正文，只算模式）
//   3. 降频：同一站点同一意图在冷却期内不再重复打扰
//   4. 主动提示气泡：轻量、无 emoji、可忽略
//   5. 一键唤醒副驾：点击后投递任务给 MAIN world 的 caid-copilot.js 执行
//
// 隐私：本脚本仅在本机用「行为信号」触发建议，不把任何正文内容上传。
(function () {
  if (window.__CAID_SIXTH_SENSE) return;
  window.__CAID_SIXTH_SENSE = true;

  var HOST = location.hostname || '';
  var url = location.href || '';

  // ---------- 配置（chrome.storage.local.caidSixth）----------
  var CFG = {
    enabled: true,
    cooldownMin: 10,   // 同一站点同一提示的冷却（分钟）
    dwellSec: 6,       // 停止交互多少秒视为「在读」
    depthPct: 40,      // 滚动深度阈值 %
    rules: { product: true, copy: true, search: true }
  };

  function loadCfg() {
    return new Promise(function (resolve) {
      try {
        if (chrome && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get('caidSixth', function (got) {
            var c = (got && got.caidSixth) || {};
            if (typeof c.enabled === 'boolean') CFG.enabled = c.enabled;
            if (typeof c.cooldownMin === 'number' && c.cooldownMin >= 0) CFG.cooldownMin = c.cooldownMin;
            if (typeof c.dwellSec === 'number' && c.dwellSec >= 1) CFG.dwellSec = c.dwellSec;
            if (typeof c.depthPct === 'number') CFG.depthPct = Math.max(1, Math.min(100, c.depthPct));
            if (c.rules) { CFG.rules.product = c.rules.product !== false; CFG.rules.copy = c.rules.copy !== false; CFG.rules.search = c.rules.search !== false; }
            resolve();
          });
        } else { resolve(); }
      } catch (e) { resolve(); }
    });
  }

  // 站点黑名单：扩展自身页、浏览器内置页、编辑器等一律不打扰
  function isExcluded() {
    if (!CFG.enabled) return true;
    if (!location.host) return true;
    if (/^chrome:\/\//i.test(location.protocol)) return true;
    if (HOST === 'chromewebstore.google.com') return true;
    if (HOST.indexOf('caid') !== -1 || HOST.indexOf('extension') !== -1) return true;
    if (/^about:|^chrome-extension:\/\//i.test(location.href)) return true;
    // 副驾面板已打开时不打扰
    var cp = document.getElementById('caidExtCopilot');
    if (cp && cp.classList && cp.classList.contains('open')) return true;
    return false;
  }

  // ---------- 规则表（声明式，开发者在此扩展更多场景）----------
  // 每个规则 = 一次主动协助。新增场景只需往 RULES 里 push 一条。
  // 字段说明：
  //   id     规则唯一标识；配合冷却降频（host|id）
  //   signal 触发信号：'dwell'=停留+滚动深度；'copy'=复制内容
  //   match  意图匹配（纯模式，不碰正文）：
  //          host  匹配 hostname 的正则（任意命中即符合）
  //          path  匹配 pathname 的正则
  //          meta  匹配文档 meta 标签属性的数组 [{prop:'property|name', re:/.../}]，全部满足才算
  //   dwellSec / depthPct  signal='dwell' 时生效（可省略，默认取 CFG）
  //   bubble 气泡文案 + 点击后交给副驾执行的任务描述
  var RULES = [
    {
      id: 'product',
      signal: 'dwell',
      match: {
        host: /(taobao|tmall|jd\.com|360buy|suning|gome|yihaodian|amazon|ebay|official\s*store|mall)/i,
        path: /\/(item\/|product\/|goods\/|store\/|shop\/|p\/\d)/i,
        meta: [{ prop: 'property', re: /product/i }]
      },
      bubble: {
        title: '发现你在查看某个商品页面',
        hint: '要不要我帮你提炼一下品牌、型号、关键参数和价格，整理成要点？',
        action: '帮我整理',
        task: '总结当前网页中的商品信息：品牌与型号、外观尺寸、核心配置与参数、价格以及用户评价要点，整理成简明要点输出。'
      }
    },
    {
      id: 'search',
      signal: 'dwell',
      match: {
        host: /(baidu\.com|bing\.com|google\.com|sogou\.com|so\.com|sm\.cn|360\.cn|yahoo\.com|duckduckgo\.com)/i,
        urlHasQuery: true,
        and: true
      },
      bubble: {
        title: '你正在浏览搜索结果',
        hint: '需要我汇总前几条结果的要点和差异，帮你快速判断吗？',
        action: '帮我整理',
        task: '整理当前搜索结果的要点：汇总前几条结果各自的结论、价格或关键信息，并对比它们的差异，给出一句话建议。'
      }
    },
    {
      id: 'copy',
      signal: 'copy',
      // 站点识别：仅「内容类」站点（学校/新闻/博客/百科/文档）触发，避免任意页面过度协助。
      // 想覆盖某个站，往 host 正则里补域名即可。
      match: {
        host: /(\.edu($|\.)|ac\.(cn|uk|jp|au|in)$|(zhihu|jianshu|csdn|cnblogs|segmentfault|wikipedia|baike|wiki|notion|shimo|medium|gitbook|readthedocs|doc|docs|feishu|yuque|wangdoc)\.|(news|daily|cnn|bbc|nytimes|guardian|thepaper|yicai|36kr|ithome|ifeng|sina|sohu|163|xinhua|people|chinadaily)\.)/i,
        and: true
      },
      copyLen: [50, 3000],
      summarizable: true,
      bubble: {
        title: '你刚刚复制了一段内容',
        hint: '要我把这段内容的中心思想和关键点串成一段小结吗？',
        action: '帮我总结',
        task: '基于当前页面上刚复制的那段内容进行总结：提炼中心思想、关键论点和要点，输出简洁小结。'
      }
    },
    {
      id: 'news_article',
      signal: 'dwell',
      match: {
        host: /(news|bbc|cnn|nytimes|theguardian|reuters|bloomberg|ft|wsj|caixin|thepaper|guancha|jiemian|163|sina|sohu|ifeng)/i,
        path: /\/(article|news|story|post|202[4-6]|\d{4}\/\d{2}\/\d{2})/i,
        meta: [{ prop: 'property', re: /article/i }]
      },
      bubble: {
        title: '你正在阅读一篇新闻/文章',
        hint: '需要我提炼核心事实、关键数据和各方观点吗？',
        action: '帮我梳理',
        task: '总结当前新闻文章：提炼时间、地点、人物、核心事件、关键数据（金额/数量/日期）、各方表态或争议点，按"事实-分析-影响"三段式输出。'
      }
    },
    {
      id: 'tutorial',
      signal: 'dwell',
      match: {
        host: /(github\.io|medium|dev\.to|stackoverflow|w3schools|mdn|runoob|csdn|jianshu|zhihu|geeksforgeeks)/i,
        path: /\/(tutorial|guide|how-to|learn|docs|wiki|manual|api|reference)/i
      },
      bubble: {
        title: '检测到你在学习教程或技术文档',
        hint: '需要我帮你整理核心步骤、代码要点和常见坑点吗？',
        action: '帮我萃取',
        task: '总结当前教程/文档：提取前置条件、核心步骤（分步骤）、关键代码片段（仅核心逻辑）、常见错误与解决方案、最佳实践建议，输出操作清单。'
      }
    },
    {
      id: 'long_read',
      signal: 'dwell',
      match: {
        host: /.*/,
        path: /.*/,
        meta: [{ prop: 'property', re: /article|post|story|blog/i }],
        and: true
      },
      dwellSec: 120,  // 停留超过2分钟
      depthPct: 70,   // 滚动超过70%
      bubble: {
        title: '你在这篇文章上花了不少时间',
        hint: '要不要我生成一份思维导图式的要点大纲，方便你回顾？',
        action: '生成大纲',
        task: '基于当前长文生成层级大纲：提取所有H1/H2/H3标题，每个标题下用1句话概括核心观点，形成树状结构输出。'
      }
    },
    {
      id: 'email',
      signal: 'dwell',
      match: {
        host: /(mail\.|outlook|gmail|yahoo\.mail|163\.com|qq\.com|foxmail|office\.com)/i,
        path: /\/(mail|inbox|compose|message|email)/i
      },
      bubble: {
        title: '你在处理邮件',
        hint: '需要我帮你起草回复、提炼待办事项，或整理邮件中的关键信息吗？',
        action: '帮我处理邮件',
        task: '基于当前邮件内容（或邮件列表）执行：1. 提炼发件人、主题、核心诉求；2. 列出邮件中提及的待办事项（带截止日期）；3. 生成3条回复建议或草稿模板。'
      }
    },
    {
      id: 'meeting_notes',
      signal: 'dwell',
      match: {
        host: /(notion|feishu|yuque|confluence|google\.com\/docs|office\.com\/word|wps|evernote)/i,
        path: /\/(meeting|会议|minutes|纪要|notes|agenda)/i
      },
      bubble: {
        title: '你在记录或查看会议纪要',
        hint: '需要我帮你提取行动项、负责人和截止时间，生成一份清晰的待办列表吗？',
        action: '提取行动项',
        task: '解析当前会议纪要内容：提取所有行动项（Action Items），标注负责人（@人名）、截止时间（日期/时间）、优先级（高/中/低），按"待办-进行中-已完成"分类输出。'
      }
    },
    {
      id: 'travel_booking',
      signal: 'dwell',
      match: {
        host: /(携程|ctrip|去哪儿|qunar|飞猪|fliggy|booking|agoda|expedia|airbnb|tripadvisor)/i,
        path: /\/(hotel|flight|机票|酒店|trip|vacation|package)/i
      },
      bubble: {
        title: '你在查看旅行产品',
        hint: '需要我帮你对比价格、分析性价比、提醒隐藏费用或推荐替代方案吗？',
        action: '帮我比价',
        task: '整理当前旅行产品：1. 关键信息提取（目的地/日期/人数/房型/航班号/价格明细）；2. 性价比分析（含税费、退改政策、评分、评价数量）；3. 同平台/跨平台替代方案建议；4. 历史价格趋势提醒（是否处于合理区间）。'
      }
    },
    {
      id: 'restaurant',
      signal: 'dwell',
      match: {
        host: /(大众点评|dianping|美团|meituan|饿了么|ele\.me|yelp|tripadvisor|google\.com\/maps)/i,
        path: /\/(shop|restaurant|food|review|menu|store)/i
      },
      bubble: {
        title: '你在查看餐厅或美食',
        hint: '需要我帮你总结菜品特色、人均消费、网友评价亮点和推荐指数吗？',
        action: '帮我划重点',
        task: '分析当前餐厅页面：1. 核心标签（菜系/特色菜/人均/评分/排队情况）；2. 好评关键词TOP5和差评关键词TOP3；3. 性价比判断；4. 推荐点单组合（2人/4人/多人）。'
      }
    },
    {
      id: 'job_search',
      signal: 'dwell',
      match: {
        host: /(linkedin|boss直聘|zhipin|拉勾|lagou|猎聘|liepin|51job|智联招聘|前程无忧)/i,
        path: /\/(job|position|posting|candidate|recruit|职位|招聘)/i
      },
      bubble: {
        title: '你在浏览招聘职位',
        hint: '需要我帮你分析岗位要求、提炼简历匹配点、预估薪资合理性吗？',
        action: '分析岗位',
        task: '分析当前职位描述：1. 硬性要求（学历/年限/技能栈/证书）；2. 软性要求（沟通/管理/抗压等）；3. 薪资区间与市场水平的匹配度；4. 根据岗位要求提炼出3个简历应该突出的核心匹配点；5. 面试准备建议（最可能问的3个方向）。'
      }
    },
    {
      id: 'social_media_post',
      signal: 'dwell',
      match: {
        host: /(weibo|twitter|x\.com|facebook|instagram|reddit|v2ex|zhihu|douban)/i,
        path: /\/(status|post|tweet|thread|feed|p\/)/i
      },
      dwellSec: 15,  // 短停留即可触发
      bubble: {
        title: '你在浏览社交媒体动态',
        hint: '需要我帮你提炼这段内容的情绪倾向、关键观点和热门评论风向吗？',
        action: '帮我解读',
        task: '分析当前社交动态：1. 内容情绪分析（正向/负向/中性）及其置信度；2. 核心观点提炼（1句话）；3. 评论区观点聚类（支持/反对/中立）和风向标；4. 是否值得深入阅读的快速判断。'
      }
    },
    {
      id: 'group_chat',
      signal: 'dwell',
      match: {
        host: /(微信|weixin|钉钉|dingtalk|飞书|feishu|slack|discord|teams)/i,
        path: /\/(chat|message|group|channel|会话)/i
      },
      dwellSec: 60,
      bubble: {
        title: '你在看群聊消息',
        hint: '群消息太多了？需要我帮你总结未读消息的关键讨论点、待办事项和投票结论吗？',
        action: '总结群聊',
        task: '基于当前群聊页面（或最近的未读消息）：1. 核心讨论主题（TOP3）；2. 已达成一致的结论；3. 待办事项及责任人（如果有）；4. 需要你回复/决策的关键问题。'
      }
    },
    {
      id: 'financial_report',
      signal: 'dwell',
      match: {
        host: /(eastmoney|sina\.com\.cn\/stock|cnstock|cninfo|巨潮|juchao|sec|edgar|investing|yahoo\.finance|bloomberg|reuters\/finance)/i,
        path: /\/(stock|fund|bond|report|financial|earning|财报|公告|研报)/i
      },
      dwellSec: 45,
      bubble: {
        title: '你在查看财报/金融公告',
        hint: '需要我帮你提炼核心财务数据、关键风险点和机构评级变化吗？',
        action: '解读财报',
        task: '分析当前财报/公告：1. 核心财务指标（营收/利润/毛利/现金流/负债率，同比变化）；2. 超预期/低于预期的关键点；3. 管理层展望与风险提示；4. 机构最新评级与目标价变动；5. 短期事件催化与长期投资逻辑。'
      }
    },
    {
      id: 'crypto',
      signal: 'dwell',
      match: {
        host: /(coinmarketcap|coingecko|binance|coinbase|okx|huobi|bybit|dextools)/i,
        path: /\/(coin|token|price|chart|market|currency)/i
      },
      bubble: {
        title: '你在查看加密货币行情',
        hint: '需要我帮你分析价格走势、链上数据和市场情绪，生成快速判断吗？',
        action: '分析行情',
        task: '整理当前币种数据：1. 价格/市值/交易量/流通量（7日变化）；2. 技术指标简评（RSI/MACD/支撑位/阻力位）；3. 链上数据（巨鲸动向/持币分布）；4. 新闻情绪面（最近24小时正负面舆情）；5. 短期风险提示（合约爆仓/解锁/监管）。'
      }
    },
    {
      id: 'code_browsing',
      signal: 'dwell',
      match: {
        host: /(github|gitlab|bitbucket|gitee|sourcegraph)/i,
        path: /\/(tree|blob|src|lib|packages|modules)/i
      },
      bubble: {
        title: '你在浏览项目源码',
        hint: '需要我帮你梳理项目结构、技术栈和核心模块的职责吗？',
        action: '解读项目',
        task: '分析当前项目：1. 项目整体架构与目录结构；2. 技术栈识别（语言/框架/数据库/中间件）；3. 核心模块职责说明；4. 关键业务流程梳理（从入口到出口）；5. 快速定位建议（从哪里开始看最省力）。'
      }
    },
    {
      id: 'readme_guide',
      signal: 'dwell',
      match: {
        host: /(github|gitlab|gitee)/i,
        path: /\/(README|readme|wiki|docs|homepage)/i
      },
      dwellSec: 15,
      bubble: {
        title: '你在看项目介绍页面',
        hint: '需要我帮你萃取这个项目的核心价值、快速上手步骤和常见坑吗？',
        action: '快速了解',
        task: '提炼项目信息：1. 项目定位（解决什么问题）；2. 核心功能列表；3. 快速开始步骤（3步以内）；4. 配置要求与依赖清单；5. 社区活跃度评估；6. 学习路径建议（从哪儿开始）。'
      }
    }
  ];
  // 开发者自定义规则（可选）：存 chrome.storage.local.caidSixthRules，数组形式，结构与上面一致，追加到内置规则之后。
  var customRulesLoaded = false;
  function loadCustomRules() {
    return new Promise(function (resolve) {
      if (customRulesLoaded) { resolve(); return; }
      customRulesLoaded = true;
      try {
        if (chrome && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get('caidSixthRules', function (got) {
            var list = (got && Array.isArray(got.caidSixthRules)) ? got.caidSixthRules : [];
            for (var i = 0; i < list.length; i++) {
              var r = list[i];
              if (r && r.id && r.signal && r.bubble) {
                try {
                  if (r.match && typeof r.match.host === 'string') r.match.host = new RegExp(r.match.host, 'i');
                  if (r.match && typeof r.match.path === 'string') r.match.path = new RegExp(r.match.path, 'i');
                } catch (e) {}
                RULES.push(r);
              }
            }
          });
        }
      } catch (e) {}
      resolve();
    });
  }

  // 规则匹配（纯模式，不读正文）：
  // AND 模式（match.and===true）：host/path/meta/urlHasQuery 全部满足才算；
  // OR 模式（默认）：任一命中即可。
  function matchRule(r) {
    var m = r && r.match;
    if (!m) return false;
    function hitHost() { try { return !!(m.host && m.host.test(HOST)); } catch (e) { return false; } }
    function hitPath() { try { return !!(m.path && m.path.test(location.pathname || '')); } catch (e) { return false; } }
    function hitQuery() { try { return !!(m.urlHasQuery && /[?&](q|wd|query|search)=/i.test(url)); } catch (e) { return false; } }
    function hitMeta() {
      if (!m.meta || !m.meta.length) return false;
      for (var i = 0; i < m.meta.length; i++) {
        var sel = m.meta[i];
        var el = null;
        try {
          if (sel.prop === 'property') el = document.querySelector('meta[property="' + (sel.val || 'og:type') + '"]');
          else el = document.querySelector('meta[name="' + (sel.val || sel.name || '') + '"]');
        } catch (e) {}
        var content = el ? (el.getAttribute('content') || '') : '';
        if (!sel.re.test(content)) return false;
      }
      return true;
    }
    if (m.host == null && m.path == null && !m.meta && !m.urlHasQuery) return false;
    if (m.and === true) {
      var checks = [];
      if (m.host) checks.push(hitHost());
      if (m.path) checks.push(hitPath());
      if (m.meta) checks.push(hitMeta());
      if (m.urlHasQuery) checks.push(hitQuery());
      if (!checks.length) return false;
      for (var k = 0; k < checks.length; k++) if (!checks[k]) return false;
      return true;
    }
    return hitHost() || hitPath() || hitQuery() || hitMeta();
  }

  // 由规则生成气泡（直接取 r.bubble）
  function makeBubble(r) {
    return r && r.bubble || null;
  }

  // 评估 dwell 类规则（按顺序命中第一个即可，避免多规则同时弹）
  // 每规则可用自己的 dwellSec/depthPct（未填则回退全局 CFG）
  function evaluateDwellRules(idleMs, depth) {
    for (var i = 0; i < RULES.length; i++) {
      var r = RULES[i];
      if (r.signal !== 'dwell') continue;
      var dw = (typeof r.dwellSec === 'number' ? r.dwellSec : CFG.dwellSec) || CFG.dwellSec;
      var dp = (typeof r.depthPct === 'number' ? r.depthPct : CFG.depthPct) || CFG.depthPct;
      if (idleMs < dw * 1000) continue;
      if (depth < dp) continue;
      if (!matchRule(r)) continue;
      if (!shouldFire(r)) continue;
      var s = makeBubble(r);
      if (s) { showBubble(s, r); return; }
    }
  }
  // 判断复制内容是否「可总结」：剔除整段 URL、纯数字/符号、过短碎片（纯本地判断，不记录、不上传内容）
  function isSummarizable(text) {
    var t = String(text || '').trim();
    if (!t) return false;
    if (/^https?:\/\/\S+$/i.test(t)) return false;                        // 整段只是个链接 → 不值得总结
    if (/^[\s\d，。,.、;；:：()（）!?！？\-]+$/.test(t)) return false;     // 纯数字/符号/标点
    // 至少 1 个完整句子（句号/问号/感叹号/换行分隔），或较多中文字符，或较多西文单词
    var sentences = t.split(/[。！？!?\n]{1,}/).filter(function (s) { return s.trim().length >= 3; }).length;
    var cn = (t.match(/[\u4e00-\u9fa5]/g) || []).length;
    var words = (t.match(/[A-Za-z0-9]{2,}/g) || []).length;
    return sentences >= 1 || cn >= 20 || words >= 8;
  }
  // 评估 copy 类规则：长度落在 copyLen 区间（若声明 summarizable 还需通过「可总结性」判断）才触发
  function evaluateCopyRules(txt) {
    var len = String(txt || '').length;
    for (var i = 0; i < RULES.length; i++) {
      var r = RULES[i];
      if (r.signal !== 'copy') continue;
      if (!matchRule(r)) continue;
      if (r.copyLen) {
        var lo = r.copyLen[0] || 0, hi = r.copyLen[1] || 1e9;
        if (len < lo || len > hi) continue;
      }
      if (r.summarizable && !isSummarizable(txt)) continue;
      if (!shouldFire(r)) continue;
      var s = makeBubble(r);
      if (s) { showBubble(s, r); return; }
    }
  }

  var lastShown = {}; // host|id -> ts
  function shouldFire(rule) {
    var kind = rule && rule.id;
    if (!kind) return false;
    // 设置页场景开关：CFG.rules[id] 显式为 false 时禁用（默认开启）
    if (CFG.rules && CFG.rules[kind] === false) return false;
    // 会话内全局节流：每分钟至多一次
    if (window.__caidSixthLastGlobal && Date.now() - window.__caidSixthLastGlobal < 60000) return false;
    var key = HOST + '|' + kind;
    if (lastShown[key]) {
      var el = Date.now() - lastShown[key];
      if (el < (CFG.cooldownMin || 10) * 60000) return false;
    }
    lastShown[key] = Date.now();
    window.__caidSixthLastGlobal = Date.now();
    return true;
  }

  // ---------- 气泡 ----------
  function caidSixthIcon() {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#5B8DFF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:6px;">' +
      '<path d="M12 3l1.9 4.6L18.5 9l-4.6 1.4L12 15l-1.9-4.6L5.5 9l4.6-1.4z"/><circle cx="18.5" cy="17" r="1.6"/><circle cx="6" cy="16" r="1.4"/>' +
      '</svg>';
  }

  function showBubble(sug) {
    try {
      var old = document.getElementById('caidSixthBubble');
      if (old) old.remove();
      var b = document.createElement('div');
      b.id = 'caidSixthBubble';
      b.style.cssText = 'position:fixed;right:80px;bottom:90px;z-index:2147483645;max-width:320px;width:auto;' +
        'background:rgba(23,38,66,.96);border:1px solid rgba(255,255,255,.14);border-radius:14px;' +
        'box-shadow:0 12px 34px rgba(0,0,0,.4);backdrop-filter:blur(8px);' +
        'padding:12px 14px;color:#e8eef7;font-size:14px;line-height:1.5;' +
        'display:flex;align-items:flex-start;gap:10px;';
      var left = document.createElement('div');
      left.style.cssText = 'flex:1;min-width:0;';
      left.innerHTML = '<div style="display:flex;align-items:center;font-weight:700;margin-bottom:4px;color:#fff;">' + caidSixthIcon() + '<span>第六感</span></div>' +
        '<div style="font-size:13px;color:#cfd9e6;">' + sug.hint + '</div>';
      var btns = document.createElement('div');
      btns.style.cssText = 'display:flex;flex-direction:column;gap:6px;flex-shrink:0;';
      var go = document.createElement('button');
      go.textContent = sug.action;
      go.style.cssText = 'border:none;background:#2f6fc0;color:#fff;font-size:12px;padding:5px 10px;border-radius:8px;cursor:pointer;white-space:nowrap;';
      go.addEventListener('click', function () { try { b.remove(); } catch (e) {} wakeCopilot(sug.task); });
      var x = document.createElement('button');
      x.textContent = '忽略';
      x.title = '忽略本次提示';
      x.style.cssText = 'border:1px solid rgba(255,255,255,.18);background:transparent;color:#aeb9c8;font-size:12px;padding:4px 10px;border-radius:8px;cursor:pointer;white-space:nowrap;';
      x.addEventListener('click', function () { try { b.remove(); } catch (e) {} });
      btns.appendChild(go);
      btns.appendChild(x);
      b.appendChild(left);
      b.appendChild(btns);
      document.body.appendChild(b);
      // 自动收起
      var t = setTimeout(function () { try { b.remove(); } catch (e) {} }, 12000);
      b.addEventListener('mouseenter', function () { clearTimeout(t); });
      b.addEventListener('mouseleave', function () { t = setTimeout(function () { try { b.remove(); } catch (e) {} }, 4000); });
    } catch (e) {}
  }

  // ---------- 唤醒副驾 ----------
  function wakeCopilot(task) {
    if (!task) return;
    var pending = { task: String(task), host: HOST, ts: Date.now() };
    try {
      // 副驾已注入（MAIN world）→ 直接投递任务
      var cp = document.getElementById('caidExtCopilot');
      if (cp && cp.getAttribute('data-caid-ready') === '1') {
        window.postMessage({ __caidType: 'CAID_SIXTH_SENSE', task: pending.task }, '*');
        return;
      }
      // 未注入 → 写 DOM dataset 兜底 + 触发布局（MAIN world 初始化时消费）
      document.documentElement.setAttribute('data-caid-sixth-pending', JSON.stringify(pending));
      try { chrome.runtime.sendMessage({ type: 'BOOT_COPILOT' }); } catch (e2) {}
      // 轮询等待注入完成，完成后再广播一次确保消费
      var tries = 0;
      var iv = setInterval(function () {
        tries++;
        var p = document.getElementById('caidExtCopilot');
        if (p && p.getAttribute('data-caid-ready') === '1') {
          clearInterval(iv);
          try { window.postMessage({ __caidType: 'CAID_SIXTH_SENSE', task: pending.task }, '*'); } catch (e3) {}
        } else if (tries > 40) clearInterval(iv);
      }, 250);
    } catch (e) {}
  }

  // ---------- 事件采集 ----------
  function start() {
    if (!document.body) { setTimeout(start, 300); return; }
    if (isExcluded()) return;

    var maxDepth = 0;
    var lastActivity = Date.now();

    // 滚动深度
    window.addEventListener('scroll', function () {
      lastActivity = Date.now();
      try {
        var max = document.documentElement.scrollHeight - window.innerHeight;
        if (max > 60) {
          var d = Math.round(((window.scrollY || document.documentElement.scrollTop || 0) / max) * 100);
          if (d > maxDepth) maxDepth = d;
        }
      } catch (e) {}
    }, { passive: true });
    document.addEventListener('mousemove', function () { lastActivity = Date.now(); }, { passive: true });
    document.addEventListener('keydown', function () { lastActivity = Date.now(); }, { passive: true });
    // 点击也算交互（避免点击后就立刻判定 idle）
    document.addEventListener('pointerdown', function () { lastActivity = Date.now(); }, { passive: true });

    // 复制：交给 copy 类规则（含长度区间、站点匹配、降频）
    document.addEventListener('copy', function (e) {
      lastActivity = Date.now();
      try {
        var txt = '';
        if (e.clipboardData && e.clipboardData.getData) txt = e.clipboardData.getData('text') || '';
        if (!txt && window.getSelection) txt = String(window.getSelection() || '').trim();
        evaluateCopyRules(txt);
      } catch (e2) {}
    });

    // 停留检测：连续 dwellSec 无交互且已滚动 → 视为「在读」，交给 dwell 类规则。
    // 各规则可用自己的 dwellSec/depthPct；同一次「在读」由 shouldFire 冷却，不再全局只放行一次。
    setInterval(function () {
      if (isExcluded()) return;
      var idleMs = Date.now() - lastActivity;
      evaluateDwellRules(idleMs, maxDepth);
    }, 1500);

    // 响应配置变更：页面上实时开/关
    try {
      if (chrome && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener(function (changes, area) {
          if (area === 'local' && changes.caidSixth) {
            var c = changes.caidSixth.newValue || {};
            CFG.enabled = typeof c.enabled === 'boolean' ? c.enabled : CFG.enabled;
            if (typeof c.cooldownMin === 'number') CFG.cooldownMin = c.cooldownMin;
          }
        });
      }
    } catch (e) {}
  }

  // 启动：先读配置 + 自定义规则，再采集（读取失败也照常，用默认值）
  Promise.all([loadCfg(), loadCustomRules()]).then(function () {
    // 预留少量时间让 DOM/标题就绪，避免开头误判
    setTimeout(start, 800);
  }).catch(function () { setTimeout(start, 800); });
})();