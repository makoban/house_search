// ========================================
// 不動産市場把握AI v3.8 - Cloudflare Workers Proxy
// ブラウザから直接Gemini API + e-Stat APIを呼び出す
// ========================================

// Cloudflare Worker Proxy (APIキー秘匿)
var WORKER_BASE = 'https://house-search-proxy.ai-fudosan.workers.dev';
var CORS_PROXIES = [
  { name: 'corsproxy.io', build: function(u) { return 'https://corsproxy.io/?' + encodeURIComponent(u); } },
  { name: 'allorigins', build: function(u) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u); } },
  { name: 'codetabs', build: function(u) { return 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u); } }
];
var _crawledAddresses = [];
var _crawlDebugInfo = { pages: [], scoredLinks: [], addresses: [] };
var _activeProxy = '';

// ---- Prefecture Codes ----
var PREFECTURE_CODES = {
  '北海道':'01','青森県':'02','岩手県':'03','宮城県':'04','秋田県':'05',
  '山形県':'06','福島県':'07','茨城県':'08','栃木県':'09','群馬県':'10',
  '埼玉県':'11','千葉県':'12','東京都':'13','神奈川県':'14','新潟県':'15',
  '富山県':'16','石川県':'17','福井県':'18','山梨県':'19','長野県':'20',
  '岐阜県':'21','静岡県':'22','愛知県':'23','三重県':'24','滋賀県':'25',
  '京都府':'26','大阪府':'27','兵庫県':'28','奈良県':'29','和歌山県':'30',
  '鳥取県':'31','島根県':'32','岡山県':'33','広島県':'34','山口県':'35',
  '徳島県':'36','香川県':'37','愛媛県':'38','高知県':'39','福岡県':'40',
  '佐賀県':'41','長崎県':'42','熊本県':'43','大分県':'44','宮崎県':'45',
  '鹿児島県':'46','沖縄県':'47'
};

// ---- State ----
var analysisData = null;

// ---- DOM References ----
var urlInput = document.getElementById('url-input');
var analyzeBtn = document.getElementById('analyze-btn');
var errorMsg = document.getElementById('error-msg');
var progressSection = document.getElementById('progress-section');
var resultsSection = document.getElementById('results-section');
var resultsContent = document.getElementById('results-content');
var progressLogContent = document.getElementById('progress-log-content');

// ---- Settings Modal ----
var settingsModal = document.getElementById('settings-modal');
// Workerプロキシ経由のため、API設定モーダルは不要
// ステータス表示のみ

// ---- Gemini API via Cloudflare Worker Proxy (with throttle + auto-retry) ----
var _lastGeminiCall = 0;
var _geminiMinInterval = 6000; // 最低6秒間隔（課金反映前の15RPM対策）

async function callGemini(prompt) {
  // スロットリング: 前回呼び出しから最低4秒空ける
  var now = Date.now();
  var elapsed = now - _lastGeminiCall;
  if (_lastGeminiCall > 0 && elapsed < _geminiMinInterval) {
    var waitMs = _geminiMinInterval - elapsed;
    addLog('  ⏳ API間隔調整 ' + Math.ceil(waitMs/1000) + '秒...', 'info');
    await new Promise(function(r) { setTimeout(r, waitMs); });
  }
  _lastGeminiCall = Date.now();

  var maxRetries = 5;
  for (var attempt = 0; attempt <= maxRetries; attempt++) {
    var res = await fetch(WORKER_BASE + '/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: prompt })
    });

    if (res.status === 429 && attempt < maxRetries) {
      var waitSec = 10 * (attempt + 1);
      addLog('  API制限検知、' + waitSec + '秒後にリトライ... (' + (attempt + 1) + '/' + maxRetries + ')', 'info');
      await new Promise(function(r) { setTimeout(r, waitSec * 1000); });
      _lastGeminiCall = Date.now();
      continue;
    }

    var data = await res.json();
    if (!res.ok) {
      var errMessage = (data.error && typeof data.error === 'string') ? data.error : (data.error && data.error.message) || ('API Error: ' + res.status);
      throw new Error(errMessage);
    }

    return data.text || '';
  }
}

// ---- e-Stat API via Cloudflare Worker Proxy ----
async function fetchEstatPopulation(prefecture, city) {
  var prefCode = PREFECTURE_CODES[prefecture];
  if (!prefCode) return null;

  addLog('e-Stat APIから人口データを取得中...', 'info');

  try {
    var url = WORKER_BASE + '/api/estat/population' +
      '?statsDataId=0003448233' +
      '&cdArea=' + prefCode + '000' +
      '&limit=100';

    var res = await fetch(url);
    if (!res.ok) throw new Error('e-Stat API HTTP ' + res.status);
    var data = await res.json();

    var result = data.GET_STATS_DATA && data.GET_STATS_DATA.STATISTICAL_DATA;
    if (!result || !result.DATA_INF || !result.DATA_INF.VALUE) {
      url = WORKER_BASE + '/api/estat/population' +
        '?statsDataId=0003448233' +
        '&cdArea=' + prefCode +
        '&limit=100';
      res = await fetch(url);
      data = await res.json();
      result = data.GET_STATS_DATA && data.GET_STATS_DATA.STATISTICAL_DATA;
    }

    if (!result || !result.DATA_INF || !result.DATA_INF.VALUE) {
      addLog('e-Stat: 該当データがありません。AI推計に切り替えます。', 'info');
      return null;
    }

    var values = result.DATA_INF.VALUE;
    var population = null;
    var households = null;

    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      var val = parseInt(v.$, 10);
      if (isNaN(val)) continue;
      if (v['@tab'] === '020' || (v['@cat01'] && v['@cat01'].indexOf('0010') >= 0)) {
        if (!population || val > 100) population = val;
      }
      if (v['@tab'] === '040' || (v['@cat01'] && v['@cat01'].indexOf('0020') >= 0)) {
        if (!households || val > 100) households = val;
      }
    }

    if (population) {
      addLog('e-Stat: 人口データ取得成功 (' + formatNumber(population) + '人)', 'success');
      return {
        total_population: population,
        households: households || Math.round(population / 2.3),
        source: 'e-Stat 国勢調査',
        from_estat: true
      };
    }

    return null;
  } catch (e) {
    console.warn('[e-Stat] Error:', e);
    addLog('e-Stat API接続エラー: ' + e.message + '。AI推計に切り替えます。', 'info');
    return null;
  }
}

async function fetchEstatHousing(prefecture) {
  var prefCode = PREFECTURE_CODES[prefecture];
  if (!prefCode) return null;

  try {
    var url = WORKER_BASE + '/api/estat/housing' +
      '?statsDataId=0003445078' +
      '&cdArea=' + prefCode +
      '&limit=50';

    var res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    var data = await res.json();

    var result = data.GET_STATS_DATA && data.GET_STATS_DATA.STATISTICAL_DATA;
    if (!result || !result.DATA_INF || !result.DATA_INF.VALUE) return null;

    var values = result.DATA_INF.VALUE;
    var ownershipCount = 0;
    var totalHousing = 0;

    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      var val = parseInt(v.$, 10);
      if (isNaN(val)) continue;
      if (val > totalHousing) totalHousing = val;
    }

    if (totalHousing > 0) {
      addLog('e-Stat: 住宅統計データ取得成功', 'success');
      return { total_housing: totalHousing, source: 'e-Stat 住宅・土地統計', from_estat: true };
    }

    return null;
  } catch (e) {
    console.warn('[e-Stat Housing] Error:', e);
    return null;
  }
}

// ---- Fetch Page via CORS Proxy ----
// 重要なサブページを特定するキーワード
var IMPORTANT_PATH_KEYWORDS = [
  'company', 'about', 'corporate', 'profile', 'access', 'overview',
  'summary', 'gaiyou', 'kaisya', 'info', 'office',
  '会社概要', '会社案内', '企業情報', '事業所', 'greeting'
];

var _stickyProxyIdx = -1; // 成功したプロキシを記憶

async function fetchSinglePage(url) {
  // 以前成功したプロキシを最優先で試行
  var order = [];
  if (_stickyProxyIdx >= 0) {
    order.push(_stickyProxyIdx);
    for (var i = 0; i < CORS_PROXIES.length; i++) {
      if (i !== _stickyProxyIdx) order.push(i);
    }
  } else {
    for (var i = 0; i < CORS_PROXIES.length; i++) order.push(i);
  }

  for (var oi = 0; oi < order.length; oi++) {
    var p = order[oi];
    var proxy = CORS_PROXIES[p];
    try {
      var proxyUrl = proxy.build(url);
      var timeout = (oi === 0 && _stickyProxyIdx >= 0) ? 15000 : 10000;
      var res = await fetch(proxyUrl, { signal: AbortSignal.timeout(timeout) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var html = await res.text();
      if (html && html.length > 100) {
        _stickyProxyIdx = p;
        _activeProxy = proxy.name;
        return html;
      }
    } catch (e) {
      console.warn('[Fetch/' + proxy.name + '] Failed: ' + url + ' - ' + e.message);
      if (oi === 0 && _stickyProxyIdx >= 0) {
        addLog('  プロキシ ' + proxy.name + ' 失敗、代替を試行...', 'info');
        _stickyProxyIdx = -1; // リセット
      }
    }
  }
  console.warn('[Fetch] All proxies failed for: ' + url);
  return null;
}

function extractTextFromHtml(html) {
  var parser = new DOMParser();
  var doc = parser.parseFromString(html, 'text/html');
  // script/styleのみ除外（nav/footer/headerは住所等重要情報を含む場合があるため残す）
  doc.querySelectorAll('script, style, noscript, iframe, svg').forEach(function(el) { el.remove(); });
  var text = (doc.body && doc.body.textContent) || '';
  // 連続空白と改行を整理
  return text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
}

function extractLinks(html, baseUrl) {
  var links = [];
  var seen = {};
  var base;
  try { base = new URL(baseUrl); } catch(e) { return []; }

  // 正規表現でHTMLからaタグのhrefを直接抽出（DOMParserを使わない）
  var linkRegex = /<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  var m;

  while ((m = linkRegex.exec(html)) !== null) {
    try {
      var href = m[1];
      if (!href || href.charAt(0) === '#' || href.indexOf('mailto:') === 0 || href.indexOf('tel:') === 0) continue;
      var resolved = new URL(href, baseUrl);
      // 同じドメインのみ
      if (resolved.hostname !== base.hostname) continue;
      var path = resolved.pathname.toLowerCase();
      // 画像・PDF・外部ファイルを除外
      if (/\.(jpg|jpeg|png|gif|svg|pdf|zip|doc|mp4|mp3)$/i.test(path)) continue;
      var key = resolved.origin + resolved.pathname;
      if (seen[key]) continue;
      seen[key] = true;
      var linkText = m[2].replace(/<[^>]+>/g, '').trim();
      links.push({ url: key, path: path, text: linkText.slice(0, 50) });
    } catch(e) { /* ignore invalid URLs */ }
  }
  return links;
}

function scoreLink(link) {
  var score = 0;
  var path = link.path;
  var text = link.text;

  for (var i = 0; i < IMPORTANT_PATH_KEYWORDS.length; i++) {
    if (path.indexOf(IMPORTANT_PATH_KEYWORDS[i]) >= 0) score += 10;
    if (text.indexOf(IMPORTANT_PATH_KEYWORDS[i]) >= 0) score += 5;
  }

  // 日本語のリンクテキストでスコアリング
  if (text.indexOf('会社概要') >= 0 || text.indexOf('会社案内') >= 0) score += 20;
  if (text.indexOf('企業情報') >= 0 || text.indexOf('事業所') >= 0) score += 15;
  if (text.indexOf('アクセス') >= 0 || text.indexOf('所在地') >= 0) score += 15;
  if (text.indexOf('代表挨拶') >= 0 || text.indexOf('社長') >= 0) score += 8;
  if (text.indexOf('事業内容') >= 0 || text.indexOf('サービス') >= 0) score += 10;
  if (text.indexOf('店舗') >= 0 || text.indexOf('支店') >= 0) score += 10;
  if (text.indexOf('施工事例') >= 0 || text.indexOf('実績') >= 0) score += 5;

  // 深いパスはやや減点
  var depth = (path.match(/\//g) || []).length;
  if (depth > 4) score -= 3;

  return score;
}

async function crawlSite(url) {
  addLog('トップページを取得中...', 'info');
  var topHtml = await fetchSinglePage(url);
  if (!topHtml) {
    _crawlDebugInfo = { pages: [{ url: url, status: 'FAILED (timeout/error)', size: 0, text: 'トップページ' }], scoredLinks: [], addresses: [] };
    addLog('トップページの取得に失敗しました', 'info');
    return null;
  }

  var topText = extractTextFromHtml(topHtml);
  addLog('トップページ取得完了 (' + topText.length + '文字)', 'success');

  // デバッグ情報初期化
  _crawlDebugInfo = { pages: [{ url: url, status: 'OK (' + _activeProxy + ')', size: topHtml.length, text: 'トップページ' }], scoredLinks: [], addresses: [] };

  // 全HTMLソースから住所を抽出（HTMLのままでマッチ）
  var allHtmlSources = [topHtml];

  // トップページからリンクを抽出
  var links = extractLinks(topHtml, url);
  addLog('内部リンク ' + links.length + '件を検出', 'info');

  // リンクをスコアリングして重要順にソート（全リンクを巡回対象）
  var allLinks = links.map(function(link) {
    return { url: link.url, path: link.path, text: link.text, score: scoreLink(link) };
  }).filter(function(link) {
    return link.url !== url && link.url !== url + '/';
  }).sort(function(a, b) {
    return b.score - a.score;
  });

  // 全リンクを巡回（上限100ページ）
  var maxSubPages = Math.min(allLinks.length, 100);
  var allTexts = [
    '【トップページ】\n' + topText.slice(0, 3000)
  ];
  var _crawledPages = [{ name: 'トップページ', url: url, chars: topText.length, status: 'OK' }];

  addLog('巡回対象: ' + maxSubPages + 'ページ（全 ' + allLinks.length + 'リンク中）', 'info');

  for (var i = 0; i < maxSubPages; i++) {
    var subLink = allLinks[i];
    addLog('[' + (i+1) + '/' + maxSubPages + '] ' + (subLink.text || subLink.path));

    var subHtml = await fetchSinglePage(subLink.url);
    if (subHtml) {
      allHtmlSources.push(subHtml);
      var subText = extractTextFromHtml(subHtml);
      if (subText.length > 50) {
        var pageName = subLink.text || subLink.path;
        var summary = extractPageSummary(subHtml);
        allTexts.push('【' + pageName + '】\n' + subText.slice(0, 2000));
        _crawledPages.push({ name: pageName, url: subLink.url, chars: subText.length, status: 'OK', summary: summary });
      }
      _crawlDebugInfo.pages.push({ url: subLink.url, status: 'OK', size: subHtml.length, text: subLink.text });
    } else {
      _crawledPages.push({ name: subLink.text || subLink.path, url: subLink.url, chars: 0, status: 'FAILED' });
      _crawlDebugInfo.pages.push({ url: subLink.url, status: 'FAILED', size: 0, text: subLink.text });
    }
  }

  // ページ一覧をグローバルに保存
  _crawlDebugInfo.crawledPages = _crawledPages;

  addLog('合計 ' + _crawledPages.filter(function(p) { return p.status === 'OK'; }).length + '/' + (maxSubPages + 1) + ' ページ取得完了', 'success');

  // 全HTMLソースからページごとに住所を抽出（グローバルに保存）
  var allAddrs = [];
  var seenZips = {};
  // トップページから抽出
  var topAddrs = extractAddressesFromHtml(topHtml, 'トップページ');
  topAddrs.forEach(function(a) { if (!seenZips[a.zip]) { seenZips[a.zip] = true; allAddrs.push(a); } });
  // サブページから抽出
  allHtmlSources.forEach(function(srcHtml, idx) {
    if (idx === 0) return; // トップは処理済み
    var pName = (_crawledPages[idx] && _crawledPages[idx].name) || 'ページ' + idx;
    var pageAddrs = extractAddressesFromHtml(srcHtml, pName);
    pageAddrs.forEach(function(a) { if (!seenZips[a.zip]) { seenZips[a.zip] = true; allAddrs.push(a); } });
  });
  _crawledAddresses = allAddrs;
  addLog('HTMLソースから住所 ' + _crawledAddresses.length + '件を直接検出', _crawledAddresses.length > 0 ? 'success' : 'info');

  // 全テキストを結合（上限15000文字）
  var combined = allTexts.join('\n\n---\n\n');
  if (combined.length > 15000) combined = combined.slice(0, 15000);
  return combined;
}

// HTMLソースから直接住所を抽出（テキスト変換に依存しない）
function extractAddressesFromHtml(html, pageName) {
  if (!html) return [];
  var results = [];
  var seen = {};

  // HTMLソースから〒xxx-xxxx パターンを直接検索
  // HTMLタグを除去してプレーンテキスト化
  var plainText = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

  // 〒xxx-xxxx + その後の住所テキスト（次の〒まで）
  var regex = /〒(\d{3}-?\d{4})\s*([^〒]{5,120})/g;
  var m;

  while ((m = regex.exec(plainText)) !== null) {
    var zip = m[1].trim();
    if (seen[zip]) continue;
    seen[zip] = true;

    var rawAddr = m[2].trim();
    // 住所部分を抽出（TEL/FAXの前まで）
    var addrMatch = rawAddr.match(/^(.+?)(?:\s*(?:TEL|FAX|tel|fax|電話))/i);
    var address = addrMatch ? addrMatch[1].trim() : rawAddr;

    // 電話番号を抽出
    var telMatch = rawAddr.match(/(?:TEL|tel|電話)[\s:]*(\d[\d\-]+\d)/i);
    var tel = telMatch ? telMatch[1] : '';
    if (!tel) {
      // TELなしの場合、住所の後ろの数字列を電話番号として取得
      var numMatch = rawAddr.match(/(\d{2,4}-\d{2,4}-\d{3,4})/);
      if (numMatch && address.indexOf(numMatch[1]) < 0) {
        tel = numMatch[1];
      }
    }

    // 住所テキストを整形
    address = address.replace(/\s+/g, ' ').replace(/[\n\r]/g, '').trim();
    // 明らかに住所でないものを除外
    if (address.length < 5 || address.length > 100) continue;
    if (!address.match(/[都道府県市区町村郡]/)) continue;

    // 前後30文字のコンテキストを取得
    var matchPos = m.index;
    var ctxStart = Math.max(0, matchPos - 40);
    var ctxEnd = Math.min(plainText.length, matchPos + m[0].length + 40);
    var context = plainText.slice(ctxStart, ctxEnd).replace(/\s+/g, ' ').trim();

    results.push({
      zip: '〒' + zip,
      address: address,
      tel: tel,
      page: pageName || '',
      context: context
    });
  }

  return results;
}


// ---- Progress Log Helper ----
function addLog(message, type) {
  if (!type) type = 'normal';
  if (!progressLogContent) return;
  var div = document.createElement('div');
  div.className = 'log-item ' + type;
  div.textContent = '[' + new Date().toLocaleTimeString() + '] ' + message;
  progressLogContent.appendChild(div);
  progressLogContent.scrollTop = progressLogContent.scrollHeight;
}

function clearLogs() {
  if (progressLogContent) progressLogContent.innerHTML = '';
}

// ---- Main Analysis Flow ----
async function startAnalysis() {
  var input = urlInput.value.trim();

  if (!input) { showError('URLまたはエリア名を入力してください'); return; }

  // URL or 地名を自動判別
  if (isValidUrl(input)) {
    // URL → 従来のWebクロール + AI分析フロー
    return startUrlAnalysis(input);
  }

  // 地名として処理
  hideError();
  var candidates = searchArea(input);

  if (candidates.length === 0) {
    showError('「' + input + '」に一致するエリアが見つかりません。都道府県名や市区町村名を入力してください。');
    return;
  }

  if (candidates.length === 1) {
    // 一意に特定 → 業種選択へ
    showIndustrySelectModal(candidates[0]);
    return;
  }

  // 複数候補 → 地名選択モーダル
  showAreaSelectModal(candidates, input);
}

// ---- 地名選択モーダル ----
function showAreaSelectModal(candidates, inputText) {
  var listEl = document.getElementById('area-select-list');
  listEl.innerHTML = '';

  candidates.forEach(function(area) {
    var btn = document.createElement('button');
    btn.className = 'area-select-btn';
    btn.style.cssText = 'display:flex; align-items:center; gap:10px; padding:14px 18px; border:1px solid rgba(99,102,241,0.3); border-radius:12px; background:rgba(30,41,59,0.6); color:#fff; cursor:pointer; font-size:14px; transition:all 0.2s; text-align:left;';
    btn.innerHTML = '<span style="font-size:20px;">📍</span>' +
      '<div><div style="font-weight:700;">' + escapeHtml(area.fullLabel) + '</div>' +
      '<div style="font-size:11px; color:var(--text-muted);">' + (area.type === 'prefecture' ? '都道府県' : '市区町村') + '</div></div>';

    btn.addEventListener('mouseover', function() { btn.style.borderColor = '#6366f1'; btn.style.background = 'rgba(99,102,241,0.15)'; });
    btn.addEventListener('mouseout', function() { btn.style.borderColor = 'rgba(99,102,241,0.3)'; btn.style.background = 'rgba(30,41,59,0.6)'; });

    btn.addEventListener('click', function() {
      document.getElementById('area-select-modal').classList.remove('active');
      showIndustrySelectModal(area);
    });
    listEl.appendChild(btn);
  });

  document.getElementById('area-select-modal').classList.add('active');
}

// ---- 業種選択モーダル ----
var _pendingAreaForAnalysis = null;

function showIndustrySelectModal(area) {
  _pendingAreaForAnalysis = area;
  var gridEl = document.getElementById('industry-select-grid');
  gridEl.innerHTML = '';

  // INDUSTRY_CONFIGが未定義（v4.0ファイル未読込）の場合のフォールバック
  var config = (typeof INDUSTRY_CONFIG !== 'undefined') ? INDUSTRY_CONFIG : {
    other: { name: '汎用分析', icon: '🏢', color: '#6b7280' }
  };

  for (var id in config) {
    (function(industryId, cfg) {
      var btn = document.createElement('button');
      btn.className = 'industry-select-btn';
      btn.style.cssText = 'display:flex; flex-direction:column; align-items:center; gap:6px; padding:16px 8px; border:1px solid rgba(99,102,241,0.2); border-radius:14px; background:rgba(30,41,59,0.6); color:#fff; cursor:pointer; font-size:12px; transition:all 0.2s; min-height:80px; justify-content:center;';
      btn.innerHTML = '<span style="font-size:28px;">' + (cfg.icon || '🏢') + '</span>' +
        '<span style="font-weight:600; line-height:1.3;">' + escapeHtml(cfg.name) + '</span>';

      btn.addEventListener('mouseover', function() {
        btn.style.borderColor = cfg.color || '#6366f1';
        btn.style.background = 'rgba(99,102,241,0.15)';
        btn.style.transform = 'scale(1.05)';
      });
      btn.addEventListener('mouseout', function() {
        btn.style.borderColor = 'rgba(99,102,241,0.2)';
        btn.style.background = 'rgba(30,41,59,0.6)';
        btn.style.transform = 'scale(1)';
      });

      btn.addEventListener('click', function() {
        document.getElementById('industry-select-modal').classList.remove('active');
        startAreaOnlyAnalysis(_pendingAreaForAnalysis, industryId);
      });
      gridEl.appendChild(btn);
    })(id, config[id]);
  }

  document.getElementById('industry-select-modal').classList.add('active');
}

// ---- エリア専用分析フロー ----
async function startAreaOnlyAnalysis(area, industryId) {
  hideError();
  hideResults();
  showProgress();
  setLoading(true);
  clearLogs();

  addLog('エリア分析を開始します...', 'info');
  addLog('対象エリア: ' + area.fullLabel, 'info');

  var config = (typeof INDUSTRY_CONFIG !== 'undefined' && INDUSTRY_CONFIG[industryId])
    ? INDUSTRY_CONFIG[industryId]
    : { name: '汎用', icon: '🏢', color: '#6b7280' };
  addLog('分析業種: ' + config.icon + ' ' + config.name, 'info');
  addLog('APIプロキシ経由でGemini + e-Statを使用', 'info');

  try {
    // Step 1 skip (no web crawl)
    completeStep('step-crawl');
    addLog('Webクロールをスキップ（エリア直接分析モード）', 'info');

    // Step 2 skip (no company analysis)
    completeStep('step-analyze');
    addLog('企業分析をスキップ（エリア直接分析モード）', 'info');

    // Step 3: エリアデータ取得
    activateStep('step-market');
    addLog('[1/1] エリアデータ取得: ' + area.fullLabel);

    // e-Stat人口データ
    addLog('  e-Stat APIから人口データを取得中...', 'info');
    var estatPop = await fetchEstatPopulation(area.prefecture, area.city);

    // e-Stat住宅データ
    var estatHousing = await fetchEstatHousing(area.prefecture);

    // 業種別追加データ（v4.0 fetchEstatForIndustryがある場合）
    var extraEstatData = {};
    if (typeof fetchEstatForIndustry === 'function' && area.prefCode) {
      extraEstatData = await fetchEstatForIndustry(industryId, area.prefCode, area.city);
    }

    // AI市場分析（業種別プロンプト使用）
    var dummyAnalysis = {
      company: { name: 'エリア直接分析', business_type: config.name },
      location: { prefecture: area.prefecture, city: area.city }
    };

    var marketPrompt;
    if (typeof getIndustryPrompt === 'function') {
      var promptFns = getIndustryPrompt(industryId);
      marketPrompt = promptFns.market(dummyAnalysis, Object.assign({ population: estatPop }, extraEstatData), area);
    } else {
      marketPrompt = buildMarketPromptForArea(dummyAnalysis, estatPop, estatHousing, area);
    }

    var marketRaw = await callGemini(marketPrompt);
    var marketData = parseJSON(marketRaw);

    // e-Stat実データで上書き
    if (estatPop && estatPop.from_estat) {
      if (!marketData.population) marketData.population = {};
      marketData.population.total_population = estatPop.total_population;
      marketData.population.households = estatPop.households;
      marketData.population.source = estatPop.source;
    }

    addLog('→ ' + area.fullLabel + ' 分析完了', 'success');
    completeStep('step-market');

    // Step 4: レポート生成
    activateStep('step-report');
    addLog('レポート生成中...', 'info');

    analysisData = {
      url: '',
      isAreaOnly: true,
      company: { name: area.fullLabel + ' エリア分析', business_type: config.name, address: area.fullLabel },
      industry: { id: industryId, name: config.name, confidence: 1.0 },
      industryId: industryId,
      industryConfig: config,
      location: { prefecture: area.prefecture, city: area.city },
      markets: [{ area: { label: area.fullLabel, prefecture: area.prefecture, city: area.city, isHQ: true }, data: marketData }],
      market: marketData,
      crossAreaInsight: null,
      timestamp: new Date().toISOString(),
      data_source: 'e-Stat + Gemini',
      extracted_addresses: []
    };

    renderResults(analysisData);
    completeStep('step-report');
    addLog('✅ エリア分析完了！', 'success');

  } catch (err) {
    addLog('エラー: ' + err.message, 'error');
    showError(err.message);
  } finally {
    setLoading(false);
  }
}

// ---- URL分析フロー（従来のメインフロー） ----
async function startUrlAnalysis(url) {

  hideError();
  hideResults();
  showProgress();
  setLoading(true);
  clearLogs();

  addLog('分析を開始します...', 'info');
  addLog('APIプロキシ経由でGemini + e-Statを使用', 'info');

  try {
    // Step 1: Crawl site (top + subpages)
    activateStep('step-crawl');
    addLog('Webサイトを巡回中: ' + url);

    var pageContent = await crawlSite(url);
    if (pageContent) {
      addLog('サイト内容の取得完了 (合計 ' + pageContent.length + '文字)', 'success');
    } else {
      addLog('CORSプロキシ経由の取得に失敗。URLのみでAI分析を実行します。', 'info');
      pageContent = '';
    }
    completeStep('step-crawl');


    // Step 2: AI Business Analysis
    activateStep('step-analyze');
    addLog('Gemini 2.0 Flash で事業内容を分析中...');

    var analysisPrompt = buildAnalysisPrompt(url, pageContent);
    var analysisRaw = await callGemini(analysisPrompt);
    var analysis = parseJSON(analysisRaw);
    addLog('分析完了: ' + ((analysis.company && analysis.company.name) || '企業情報取得'), 'success');
    completeStep('step-analyze');

    // Step 2.5: AI事業所フィルタリング
    var rawAddresses = _crawledAddresses || [];
    var extractedAddresses = rawAddresses;

    if (rawAddresses.length > 1) {
      addLog('抽出住所 ' + rawAddresses.length + '件をAIで事業所判定中...');
      try {
        var companyName = (analysis.company && analysis.company.name) || '';
        var businessType = (analysis.company && analysis.company.business_type) || '';
        var addrList = rawAddresses.map(function(a, i) {
          return (i+1) + '. ' + a.zip + ' ' + a.address +
            (a.tel ? ' TEL:' + a.tel : '') +
            '\n   出現ページ: ' + (a.page || '不明') +
            '\n   前後テキスト: 「' + (a.context || '').slice(0, 80) + '」';
        }).join('\n\n');

        var filterPrompt = '■ 企業名: ' + companyName + '\n' +
          '■ 業種: ' + businessType + '\n\n' +
          '以下はこの企業のWebサイトの各ページから抽出された住所一覧です。\n' +
          '各住所には「出現ページ名」と「前後テキスト」を付記しています。\n\n' +
          addrList + '\n\n' +
          '【判定基準】\n' +
          '✅ 事業所として採用する住所:\n' +
          '- 本社・支社・支店・営業所・事務所の住所\n' +
          '- 展示場・モデルハウス・ショールームの住所\n' +
          '- 「会社概要」「アクセス」「拠点案内」ページに記載された住所\n' +
          '- ヘッダー/フッターに記載された企業住所\n\n' +
          '❌ 除外すべき住所:\n' +
          '- 施工事例・建売物件・分譲地の住所\n' +
          '- お客様の声・体験談に含まれる住所\n' +
          '- 取引先・協力会社・銀行・保険会社の住所\n' +
          '- 免許の登録先（国土交通省等）の住所\n' +
          '- 求人情報内の勤務地（他社のもの）\n\n' +
          '以下のJSON形式で回答してください:\n' +
          '{"offices":[{"no":1,"is_office":true,"reason":"本社住所（会社概要ページ）"},{"no":2,"is_office":false,"reason":"施工事例の物件住所"},...]}';

        var filterRaw = await callGemini(filterPrompt);
        // JSONレスポンスをパース
        var filterResult = parseJSON(filterRaw);
        if (filterResult && filterResult.offices && filterResult.offices.length > 0) {
          extractedAddresses = [];
          filterResult.offices.forEach(function(item) {
            var idx = item.no - 1;
            if (item.is_office && rawAddresses[idx]) {
              extractedAddresses.push(rawAddresses[idx]);
              addLog('  ✅ ' + rawAddresses[idx].address + ' → ' + (item.reason || '事業所'), 'success');
            } else if (rawAddresses[idx]) {
              addLog('  ❌ ' + rawAddresses[idx].address + ' → ' + (item.reason || '除外'), 'info');
            }
          });
          var removedCount = rawAddresses.length - extractedAddresses.length;
          if (removedCount > 0) {
            addLog('AI判定: ' + removedCount + '件の非事業所住所を除外 → 事業所 ' + extractedAddresses.length + '件', 'success');
          } else {
            addLog('AI判定: 全 ' + rawAddresses.length + '件が事業所と確認', 'success');
          }
        } else {
          // フォールバック: 旧フォーマット [1,3,5]
          var filterMatch = filterRaw.match(/\[[\d\s,]+\]/);
          if (filterMatch) {
            var officeIndices = JSON.parse(filterMatch[0]);
            extractedAddresses = officeIndices.map(function(idx) { return rawAddresses[idx - 1]; }).filter(function(a) { return !!a; });
            addLog('AI判定: 事業所 ' + extractedAddresses.length + '/' + rawAddresses.length + '件', 'success');
          } else {
            addLog('AI判定のパースに失敗 → 全住所を使用', 'info');
          }
        }
      } catch (e) {
        addLog('AI事業所判定スキップ: ' + e.message, 'info');
      }
    }

    // Step 3: Market Data (per area)
    activateStep('step-market');
    addLog('サイトから事業所住所 ' + extractedAddresses.length + '件を確認済み', 'info');

    // ユニークなエリアを抽出
    var uniqueAreas = [];
    var seenAreaKeys = {};

    // 本社エリア（Gemini分析結果から）
    var hqLocation = analysis.location || {};
    if (hqLocation.prefecture) {
      var hqKey = hqLocation.prefecture + ' ' + (hqLocation.city || '');
      seenAreaKeys[hqKey] = true;
      uniqueAreas.push({ prefecture: hqLocation.prefecture, city: hqLocation.city || '', label: hqKey, isHQ: true });
    }

    // 事業所住所からエリアを抽出
    extractedAddresses.forEach(function(addr) {
      var area = extractAreaFromAddress(addr.address);
      if (area && !seenAreaKeys[area.label]) {
        seenAreaKeys[area.label] = true;
        uniqueAreas.push(area);
      }
    });

    addLog('分析対象エリア: ' + uniqueAreas.length + '件', 'info');

    // 各エリアの市場データを取得
    var markets = [];
    for (var aIdx = 0; aIdx < uniqueAreas.length; aIdx++) {
      var area = uniqueAreas[aIdx];
      addLog('[' + (aIdx+1) + '/' + uniqueAreas.length + '] エリアデータ取得: ' + area.label);

      // e-Stat data (per prefecture) - Workerプロキシ経由
      var areaEstatPop = null;
      var areaEstatHousing = null;
      if (area.prefecture) {
        areaEstatPop = await fetchEstatPopulation(area.prefecture, area.city);
        areaEstatHousing = await fetchEstatHousing(area.prefecture);
      }

      var marketPrompt = buildMarketPromptForArea(analysis, areaEstatPop, areaEstatHousing, area);
      var marketRaw = await callGemini(marketPrompt);
      var marketData = parseJSON(marketRaw);

      // e-Statデータをマージ
      if (areaEstatPop && areaEstatPop.from_estat) {
        if (!marketData.population) marketData.population = {};
        marketData.population.total_population = areaEstatPop.total_population;
        marketData.population.households = areaEstatPop.households;
        marketData.population.source = areaEstatPop.source;
      }

      markets.push({ area: area, data: marketData });
      addLog('  → ' + area.label + ' 完了', 'success');
    }

    addLog('全 ' + markets.length + ' エリアの市場データ収集完了', 'success');

    // Step 3.5: 全エリア横断AI分析（経営層向けインサイト）
    var crossAreaInsight = null;
    if (markets.length >= 2) {
      addLog('全エリア横断分析を実行中...');
      try {
        var summaryForAI = markets.map(function(mkt) {
          var d = mkt.data || {};
          var pop = d.population || {};
          var con = d.construction || {};
          var hou = d.housing || {};
          var lp = d.land_price || {};
          var hp = d.home_prices || {};
          var comp = d.competition || {};
          var pot = d.potential || {};
          return {
            area: mkt.area.label,
            isHQ: mkt.area.isHQ || false,
            population: pop.total_population || 0,
            households: pop.households || 0,
            age30_45_pct: pop.age_30_45_pct || 0,
            construction_total: con.total || 0,
            ownership_rate: hou.ownership_rate || 0,
            vacancy_rate: hou.vacancy_rate || 0,
            land_tsubo: lp.residential_tsubo || 0,
            avg_home_price: hp.avg_price || 0,
            competitors: comp.total_companies || 0,
            annual_converts: pot.annual_converts || 0,
            per_company: pot.per_company || 0
          };
        });
        var crossPrompt = '以下は同一企業の複数事業所がある各エリアの市場データです。経営層向けに分析してください。\n\n' +
          JSON.stringify(summaryForAI, null, 2) + '\n\n' +
          '以下のJSON形式で回答してください:\n' +
          '{\n' +
          '  "opportunity_ranking": [{"rank":1,"area":"エリア名","reason":"理由(50字以内)","score":85},...],\n' +
          '  "strategic_summary": "全体の戦略的要約(200字以内)",\n' +
          '  "sales_advice": "営業チームへのアドバイス(200字以内)",\n' +
          '  "risk_areas": "リスクのあるエリアと理由(100字以内)",\n' +
          '  "growth_areas": "成長が見込めるエリアと理由(100字以内)"\n' +
          '}';
        var crossRaw = await callGemini(crossPrompt);
        crossAreaInsight = parseJSON(crossRaw);
        addLog('横断分析完了', 'success');
      } catch (e) {
        addLog('横断分析スキップ: ' + e.message, 'info');
      }
    }

    completeStep('step-market');

    // Step 4: Render Report
    activateStep('step-report');
    addLog('レポート生成中...');
    await sleep(300);

    analysisData = {
      url: url,
      company: analysis.company || {},
      location: analysis.location || {},
      markets: markets,
      market: markets.length > 0 ? markets[0].data : {},
      crossAreaInsight: crossAreaInsight,
      timestamp: new Date().toISOString(),
      data_source: 'e-Stat + Gemini',
      extracted_addresses: extractedAddresses
    };

    renderResults(analysisData);
    addLog('レポート作成完了！', 'success');
    completeStep('step-report');

    await sleep(300);
    hideProgress();
    showResults();

  } catch (err) {
    console.error('Analysis error:', err);
    addLog('エラー: ' + err.message, 'error');
    showError(err.message);
  } finally {
    setLoading(false);
  }
}

// ---- Prompt Builders ----
function buildAnalysisPrompt(url, content) {
  var contentSection = content
    ? '\n以下はWebサイトから取得したテキストの一部です:\n---\n' + content + '\n---'
    : '\nWebサイトの内容は取得できませんでしたが、URLから推測してください。';

  return 'あなたは不動産・住宅業界の市場分析の専門家です。\n' +
    '以下のURLの企業について分析してください。\n\n' +
    'URL: ' + url + '\n' +
    contentSection + '\n\n' +
    '重要: 住所は必ずWebサイトの情報から特定してください。会社概要ページやフッターに記載があります。\n' +
    '複数の事業所がある場合、本社の住所を"address"に、他の拠点は"branches"にリストしてください。\n\n' +
    '以下のJSON形式で回答してください。マークダウンのコードブロックで囲まず、純粋JSONのみ返してください:\n' +
    '{\n' +
    '  "company": {\n' +
    '    "name": "企業名",\n' +
    '    "address": "本社の住所（〒XXX-XXXX 都道府県市区町村以降）",\n' +
    '    "branches": [\n' +
    '      {"name": "支店名", "address": "住所"}\n' +
    '    ],\n' +
    '    "business_type": "事業内容（簡潔に）",\n' +
    '    "main_services": "主力サービス・商品",\n' +
    '    "is_real_estate": true,\n' +
    '    "strengths": "強み・特徴（100文字以内）",\n' +
    '    "weaknesses": "改善余地・課題（100文字以内）",\n' +
    '    "keywords": ["キーワード1", "キーワード2", "キーワード3"]\n' +
    '  },\n' +
    '  "location": {\n' +
    '    "prefecture": "本社の都道府県",\n' +
    '    "city": "本社の市区町村"\n' +
    '  }\n' +
    '}';
}

function buildMarketPromptForArea(analysis, estatPop, estatHousing, area) {
  var company = analysis.company || {};
  var pref = area.prefecture || '不明';
  var city = area.city || '';

  var estatInfo = '';
  if (estatPop && estatPop.from_estat) {
    estatInfo += '\n\n【参考: e-Stat政府統計データ】\n' +
      '・総人口: ' + formatNumber(estatPop.total_population) + '人\n' +
      '・世帯数: ' + formatNumber(estatPop.households) + '世帯\n' +
      'これらの実データを基準にして、他の項目も整合性のある値を推定してください。\n';
  }

  return 'あなたは日本の不動産市場データの専門家です。\n' +
    '以下の地域の不動産市場データを、あなたの知識をもとに推定・提供してください。\n\n' +
    '対象エリア: ' + pref + ' ' + city + '\n' +
    '企業の事業: ' + (company.business_type || '不明') + '\n' +
    estatInfo + '\n' +
    'できる限り正確な数値を提供してください。正確な数値が不明な場合は、合理的な推計値を「推計」と明記して提供してください。\n\n' +
    '以下のJSON形式で回答してください。マークダウンのコードブロックで囲まず、純粋JSONのみ返してください:\n' +
    '{\n' +
    '  "area_name": "' + pref + ' ' + city + '",\n' +
    '  "population": {\n' +
    '    "total_population": 0,\n' +
    '    "households": 0,\n' +
    '    "age_30_45_pct": 0,\n' +
    '    "elderly_pct": 0,\n' +
    '    "source": "データソース名"\n' +
    '  },\n' +
    '  "construction": {\n' +
    '    "total": 0,\n' +
    '    "owner_occupied": 0,\n' +
    '    "yoy_change": "+0.0%",\n' +
    '    "year": "2024",\n' +
    '    "source": "推計"\n' +
    '  },\n' +
    '  "housing": {\n' +
    '    "ownership_rate": 0,\n' +
    '    "vacancy_rate": 0,\n' +
    '    "rental_vacancy": 0\n' +
    '  },\n' +
    '  "land_price": {\n' +
    '    "residential_sqm": 0,\n' +
    '    "residential_tsubo": 0,\n' +
    '    "commercial_sqm": 0,\n' +
    '    "yoy_change": "+0.0%"\n' +
    '  },\n' +
    '  "home_prices": {\n' +
    '    "avg_price": 0,  // 万円単位で記入（例: 3500 → 3500万円。48000000のような円単位は不可）\n' +
    '    "price_range": "0〜0万円",\n' +
    '    "required_income": 0  // 万円単位で記入（例: 600 → 600万円）\n' +
    '  },\n' +
    '  "competition": {\n' +
    '    "total_companies": 0,\n' +
    '    "local_builders": 0\n' +
    '  },\n' +
    '  "potential": {\n' +
    '    "target_households": 0,\n' +
    '    "rental_households": 0,\n' +
    '    "annual_converts": 0,\n' +
    '    "per_company": 0,\n' +
    '    "ai_insight": "このエリアでの営業戦略に関する提言"\n' +
    '  }\n' +
    '}';
}

// 政令指定都市 → 都道府県マッピング
var CITY_TO_PREF = {
  '札幌市':'北海道','仙台市':'宮城県','さいたま市':'埼玉県','千葉市':'千葉県',
  '横浜市':'神奈川県','川崎市':'神奈川県','相模原市':'神奈川県','新潟市':'新潟県',
  '静岡市':'静岡県','浜松市':'静岡県','名古屋市':'愛知県','京都市':'京都府',
  '大阪市':'大阪府','堺市':'大阪府','神戸市':'兵庫県','岡山市':'岡山県',
  '広島市':'広島県','北九州市':'福岡県','福岡市':'福岡県','熊本市':'熊本県'
};

// 住所から都道府県・市区町村を抽出（最小区分まで）
function extractAreaFromAddress(address) {
  if (!address) return null;

  // 1) 都道府県が明示されている場合
  var prefMatch = address.match(/(北海道|東京都|大阪府|京都府|.{2,3}県)/);
  if (prefMatch) {
    var pref = prefMatch[1];
    var rest = address.slice(address.indexOf(pref) + pref.length);
    var city = '';
    if (pref === '東京都') {
      var wardMatch = rest.match(/^(.+?区)/);
      city = wardMatch ? wardMatch[1] : '';
    } else {
      var cityMatch = rest.match(/^(.+?市)(.+?区)?/) || rest.match(/^(.+?郡)(.+?[町村])/);
      if (cityMatch) {
        city = cityMatch[1] + (cityMatch[2] || '');
      } else {
        var kuMatch = rest.match(/^(.+?区)/);
        city = kuMatch ? kuMatch[1] : '';
      }
    }
    return { prefecture: pref, city: city, label: pref + ' ' + city };
  }

  // 2) 県名なし → 政令指定都市名から都道府県を逆引き
  for (var cName in CITY_TO_PREF) {
    var idx = address.indexOf(cName);
    if (idx >= 0) {
      var cPref = CITY_TO_PREF[cName];
      var cRest = address.slice(idx);
      var cMatch = cRest.match(/^(.+?市)(.+?区)?/);
      var cCity = cMatch ? cMatch[1] + (cMatch[2] || '') : cName;
      return { prefecture: cPref, city: cCity, label: cPref + ' ' + cCity };
    }
  }

  return null;
}

// ページHTMLからメインコンテンツの要約を抽出（ナビ/ヘッダー/フッター除外）
function extractPageSummary(html) {
  try {
    var parser = new DOMParser();
    var doc = parser.parseFromString(html, 'text/html');
    // ナビ・ヘッダー・フッター・サイドバー・スクリプト等を除外
    doc.querySelectorAll('header, nav, footer, aside, script, style, noscript, iframe, svg, form, .header, .footer, .nav, .sidebar, .menu, #header, #footer, #nav').forEach(function(el) { el.remove(); });
    // main/articleがあればそこを優先
    var mainEl = doc.querySelector('main, article, .main, .content, #main, #content, .entry-content');
    var text = (mainEl || doc.body || doc).textContent || '';
    // 整形
    var lines = text.split(/[\n\r]+/);
    var meaningful = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/\s+/g, ' ').trim();
      if (line.length < 20) continue;
      // 共通的なUI文言をスキップ
      if (/^(TOP|HOME|MENU|Cookie|©|Copyright|All Rights Reserved)/.test(line)) continue;
      meaningful.push(line);
      if (meaningful.length >= 2) break;
    }
    return meaningful.join(' ').slice(0, 200);
  } catch(e) {
    return '';
  }
}

// ---- JSON Parser ----
function parseJSON(text) {
  var cleaned = text.trim();
  var codeBlockStart = /^```(?:json)?\s*\n?/;
  var codeBlockEnd = /\n?```\s*$/;
  if (cleaned.match(codeBlockStart)) {
    cleaned = cleaned.replace(codeBlockStart, '').replace(codeBlockEnd, '');
  }
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    var match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch (e2) { /* fall through */ }
    }
    console.error('JSON parse error:', e, '\nRaw:', cleaned.slice(0, 500));
    throw new Error('AIの応答をパースできませんでした。再度お試しください。');
  }
}

// ---- Render Results ----
function renderResults(data) {
  var company = data.company;
  var market = data.market;
  var html = '';

  // Data Source Badge
  var sourceBadge = data.data_source === 'e-Stat + Gemini'
    ? '<span style="background: linear-gradient(135deg, #10b981, #3b82f6); color:#fff; padding:3px 10px; border-radius:20px; font-size:11px; font-weight:700;">📊 e-Stat実データ + AI分析</span>'
    : '<span style="background: var(--accent-gradient); color:#fff; padding:3px 10px; border-radius:20px; font-size:11px; font-weight:700;">🤖 AI推計モード</span>';

  // Company Card
  html += '<div class="result-card result-card--company">' +
    '<div class="result-card__header">' +
    '<div class="result-card__icon">🏢</div>' +
    '<div>' +
    '<div class="result-card__title">' + escapeHtml(company.name || '企業分析') + '</div>' +
    '<div class="result-card__subtitle">Gemini 2.0 Flash による事業内容分析 ' + sourceBadge + '</div>' +
    '</div></div>' +
    '<div class="result-card__body">' +
    '<table class="data-table">' +
    '<tr><th>企業名</th><td>' + escapeHtml(company.name || '—') + '</td></tr>' +
    '<tr><th>本社所在地</th><td>' + escapeHtml(company.address || '—') + '</td></tr>' +
    '<tr><th>事業内容</th><td>' + escapeHtml(company.business_type || '—') + '</td></tr>' +
    '<tr><th>主力サービス</th><td>' + escapeHtml(company.main_services || '—') + '</td></tr>' +
    '<tr><th>不動産事業</th><td>' + (company.is_real_estate ? '<span class="highlight--green">✅ 該当</span>' : '❌ 非該当') + '</td></tr>' +
    '</table>';

  // 事業所一覧（クロールテキストから直接抽出した住所を表示）
  var addrs = data.extracted_addresses || [];
  if (addrs.length > 1) {
    html += '<div style="margin-top:12px; padding:12px 16px; background:rgba(99,102,241,0.08); border-radius:10px; border:1px solid rgba(99,102,241,0.15);">' +
      '<div style="font-size:13px; font-weight:700; color:var(--accent-blue); margin-bottom:8px;">📍 事業所一覧 (' + addrs.length + '拠点)</div>';
    addrs.forEach(function(a, idx) {
      var label = idx === 0 ? '🏢 本社' : '📍 拠点' + idx;
      html += '<div style="font-size:12px; color:var(--text-secondary); margin-bottom:6px; padding:4px 0; border-bottom:1px solid rgba(255,255,255,0.05);">' +
        '<span style="font-weight:600; color:var(--text-primary); min-width:70px; display:inline-block;">' + label + '</span> ' +
        '<span style="color:var(--accent-blue);">' + escapeHtml(a.zip) + '</span> ' +
        escapeHtml(a.address) +
        (a.tel ? ' <span style="color:var(--text-secondary); font-size:11px;">TEL ' + escapeHtml(a.tel) + '</span>' : '') +
        '</div>';
    });
    html += '</div>';
  }

  if (company.strengths) {
    html += '<div class="summary-box" style="margin-top:16px"><div class="summary-box__title">💪 強み・特徴</div><div class="summary-box__text">' + escapeHtml(company.strengths) + '</div></div>';
  }
  if (company.weaknesses) {
    html += '<div class="summary-box" style="margin-top:12px; background: linear-gradient(135deg, rgba(244,63,94,0.1), rgba(249,115,22,0.1)); border-color: rgba(244,63,94,0.2);"><div class="summary-box__title" style="color:var(--accent-rose)">⚠️ 改善余地</div><div class="summary-box__text">' + escapeHtml(company.weaknesses) + '</div></div>';
  }
  if (company.keywords && company.keywords.length) {
    html += '<div class="tag-list" style="margin-top:16px">';
    company.keywords.forEach(function(k) { html += '<span class="tag">' + escapeHtml(k) + '</span>'; });
    html += '</div>';
  }
  html += '</div></div>';

  // 巡回ページサマリー（主要ページのみコメント）
  var crawledPages = (_crawlDebugInfo && _crawlDebugInfo.crawledPages) || [];
  if (crawledPages.length > 0) {
    var okPages = crawledPages.filter(function(p) { return p.status === 'OK'; });
    var totalChars = okPages.reduce(function(sum, p) { return sum + (p.chars || 0); }, 0);

    // 主要ページを特定（会社概要・事業所・アクセス・サービス等）
    var importantKeywords = ['会社概要','企業情報','事業所','アクセス','拠点','サービス','事業内容','about','company','office','access','service'];
    var keyPages = okPages.filter(function(p) {
      var name = (p.name || '').toLowerCase();
      return importantKeywords.some(function(kw) { return name.indexOf(kw) >= 0; });
    }).slice(0, 5);
    // トップページも含める
    if (okPages.length > 0 && keyPages.indexOf(okPages[0]) < 0) {
      keyPages.unshift(okPages[0]);
    }

    html += '<div class="result-card" style="border: 1px solid rgba(99,102,241,0.15);">' +
      '<div class="result-card__header">' +
      '<div class="result-card__icon">🌐</div>' +
      '<div><div class="result-card__title">Webサイト巡回結果</div>' +
      '<div class="result-card__subtitle">サイト構造・情報量の概要</div></div></div>' +
      '<div class="result-card__body">' +
      '<div class="crawl-stats-grid">' +
      '<div class="stat-box"><div class="stat-box__value">' + okPages.length + '</div><div class="stat-box__label">取得ページ数</div></div>' +
      '<div class="stat-box"><div class="stat-box__value">' + (totalChars >= 10000 ? (totalChars/10000).toFixed(1) + '万' : totalChars.toLocaleString()) + '</div><div class="stat-box__label">合計文字数</div></div>' +
      '<div class="stat-box"><div class="stat-box__value">' + crawledPages.length + '</div><div class="stat-box__label">検出リンク数</div></div>' +
      '</div>';

    if (keyPages.length > 0) {
      html += '<div style="font-size:12px; font-weight:700; color:var(--text-primary); margin-bottom:8px;">📌 主要ページ</div>';
      keyPages.forEach(function(p) {
        html += '<div style="display:flex; align-items:center; gap:8px; padding:5px 10px; margin-bottom:4px; border-radius:6px; background:rgba(99,102,241,0.04);">' +
          '<span style="font-size:11px; font-weight:600; color:var(--text-primary); flex:1;">' + escapeHtml(p.name || '') + '</span>' +
          '<span style="font-size:10px; color:var(--text-muted); white-space:nowrap;">' + (p.chars || 0).toLocaleString() + '文字</span>' +
          '</div>';
      });
    }

    html += '</div></div>';
  }

  // ========== 全社サマリーダッシュボード ==========
  var markets = data.markets || [];
  var cross = data.crossAreaInsight || {};
  if (markets.length > 0) {
    html += '<div class="result-card" style="border:2px solid rgba(16,185,129,0.3); background:linear-gradient(135deg,rgba(16,185,129,0.05),rgba(59,130,246,0.05));">' +
      '<div class="result-card__header">' +
      '<div class="result-card__icon">📊</div>' +
      '<div><div class="result-card__title">全社エリア比較サマリー</div>' +
      '<div class="result-card__subtitle">' + markets.length + 'エリアの横断比較 — 経営層向けダッシュボード</div></div></div>' +
      '<div class="result-card__body">';

    // --- 比較テーブル ---
    html += '<div style="overflow-x:auto; margin-bottom:20px;">' +
      '<table class="data-table" style="font-size:11px; width:100%; min-width:700px;">' +
      '<thead><tr style="background:rgba(99,102,241,0.1);">' +
      '<th style="text-align:left;">エリア</th>' +
      '<th>人口</th><th>世帯数</th><th>着工(戸/年)</th>' +
      '<th>持家率</th><th>空家率</th><th>坪単価(万)</th>' +
      '<th>住宅平均(万)</th><th>競合数</th><th>年間転換</th>' +
      '</tr></thead><tbody>';

    var totPop=0,totHH=0,totCon=0,totOwn=0,totVac=0,totLand=0,totPrice=0,totComp=0,totConv=0,cnt=0;
    markets.forEach(function(mkt) {
      var d = mkt.data || {};
      var pop = (d.population||{}).total_population||0;
      var hh = (d.population||{}).households||0;
      var con = (d.construction||{}).total||0;
      var own = (d.housing||{}).ownership_rate||0;
      var vac = (d.housing||{}).vacancy_rate||0;
      var landRaw = (d.land_price||{}).residential_tsubo||0;
      var land = landRaw > 10000 ? Math.round(landRaw/10000) : landRaw;
      var priceRaw = (d.home_prices||{}).avg_price||0;
      var price = priceRaw > 50000 ? Math.round(priceRaw/10000) : priceRaw;
      var comp = (d.competition||{}).total_companies||0;
      var conv = (d.potential||{}).annual_converts||0;
      totPop+=pop;totHH+=hh;totCon+=con;totOwn+=own;totVac+=vac;totLand+=land;totPrice+=price;totComp+=comp;totConv+=conv;cnt++;
      var icon = (mkt.area && mkt.area.isHQ) ? '🏢' : '📍';
      var label = mkt.area ? mkt.area.label : 'エリア';
      html += '<tr>' +
        '<td style="font-weight:600; white-space:nowrap;">' + icon + ' ' + escapeHtml(label) + '</td>' +
        '<td style="text-align:right;">' + formatNumber(pop) + '</td>' +
        '<td style="text-align:right;">' + formatNumber(hh) + '</td>' +
        '<td style="text-align:right;">' + formatNumber(con) + '</td>' +
        '<td style="text-align:right;">' + own + '%</td>' +
        '<td style="text-align:right;">' + vac + '%</td>' +
        '<td style="text-align:right;">' + formatNumber(land) + '</td>' +
        '<td style="text-align:right;">' + formatNumber(price) + '</td>' +
        '<td style="text-align:right;">' + comp + '</td>' +
        '<td style="text-align:right; font-weight:700; color:#10b981;">' + formatNumber(conv) + '</td>' +
        '</tr>';
    });
    var n = cnt||1;
    html += '<tr style="background:rgba(16,185,129,0.08); font-weight:700;">' +
      '<td>合計</td>' +
      '<td style="text-align:right;">' + formatNumber(totPop) + '</td>' +
      '<td style="text-align:right;">' + formatNumber(totHH) + '</td>' +
      '<td style="text-align:right;">' + formatNumber(totCon) + '</td>' +
      '<td></td><td></td><td></td><td></td>' +
      '<td style="text-align:right;">' + totComp + '</td>' +
      '<td style="text-align:right; color:#10b981;">' + formatNumber(totConv) + '</td></tr>';
    html += '<tr style="background:rgba(59,130,246,0.08); font-style:italic;">' +
      '<td>平均</td>' +
      '<td style="text-align:right;">' + formatNumber(Math.round(totPop/n)) + '</td>' +
      '<td style="text-align:right;">' + formatNumber(Math.round(totHH/n)) + '</td>' +
      '<td style="text-align:right;">' + formatNumber(Math.round(totCon/n)) + '</td>' +
      '<td style="text-align:right;">' + (totOwn/n).toFixed(1) + '%</td>' +
      '<td style="text-align:right;">' + (totVac/n).toFixed(1) + '%</td>' +
      '<td style="text-align:right;">' + formatNumber(Math.round(totLand/n)) + '</td>' +
      '<td style="text-align:right;">' + formatNumber(Math.round(totPrice/n)) + '</td>' +
      '<td style="text-align:right;">' + Math.round(totComp/n) + '</td>' +
      '<td style="text-align:right;">' + formatNumber(Math.round(totConv/n)) + '</td></tr>';
    html += '</tbody></table></div>';

    // --- Chart.jsグラフ用Canvas ---
    html += '<div class="chart-grid">' +
      '<div style="background:rgba(30,41,59,0.5); border-radius:12px; padding:16px; border:1px solid rgba(99,102,241,0.1);">' +
      '<div style="font-size:13px; font-weight:700; margin-bottom:8px; color:var(--text-primary);">📈 人口 × 年間転換世帯数</div>' +
      '<div style="position:relative; height:220px;"><canvas id="chart-pop-conv"></canvas></div></div>' +
      '<div style="background:rgba(30,41,59,0.5); border-radius:12px; padding:16px; border:1px solid rgba(99,102,241,0.1);">' +
      '<div style="font-size:13px; font-weight:700; margin-bottom:8px; color:var(--text-primary);">🏗️ 着工戸数 × 競合数</div>' +
      '<div style="position:relative; height:220px;"><canvas id="chart-con-comp"></canvas></div></div>' +
      '</div>';

    // --- AIチャンスランキング ---
    if (cross.opportunity_ranking && cross.opportunity_ranking.length > 0) {
      html += '<div style="margin-bottom:20px;">' +
        '<div style="font-size:15px; font-weight:700; margin-bottom:12px; color:var(--text-primary);">🏆 AIチャンスランキング</div>';
      cross.opportunity_ranking.forEach(function(r, i) {
        var barW = (r.score || 50);
        var colors = ['#10b981','#3b82f6','#f59e0b','#8b5cf6','#ef4444','#06b6d4'];
        var c = colors[i % colors.length];
        html += '<div style="margin-bottom:10px; padding:10px 14px; background:rgba(30,41,59,0.4); border-radius:10px; border:1px solid rgba(99,102,241,0.08);">' +
          '<div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">' +
          '<span style="font-size:18px; font-weight:800; color:' + c + ';">#' + (r.rank||i+1) + '</span>' +
          '<span style="font-size:14px; font-weight:700; color:var(--text-primary);">' + escapeHtml(r.area||'') + '</span>' +
          '<span style="margin-left:auto; font-size:20px; font-weight:800; color:' + c + ';">' + (r.score||0) + '<span style="font-size:11px; color:var(--text-muted);">点</span></span></div>' +
          '<div style="background:rgba(255,255,255,0.05); border-radius:6px; height:8px; overflow:hidden;">' +
          '<div style="width:' + barW + '%; height:100%; background:' + c + '; border-radius:6px; transition:width 1s;"></div></div>' +
          '<div style="font-size:11px; color:var(--text-secondary); margin-top:6px;">' + escapeHtml(r.reason||'') + '</div></div>';
      });
      html += '</div>';
    }

    // --- 戦略提言カードグリッド ---
    var insightCards = [];
    if (cross.strategic_summary) insightCards.push({icon:'🎯',title:'経営戦略サマリー',text:cross.strategic_summary,color:'#6366f1'});
    if (cross.sales_advice) insightCards.push({icon:'💼',title:'営業チームへのアドバイス',text:cross.sales_advice,color:'#10b981'});
    if (cross.growth_areas) insightCards.push({icon:'📈',title:'成長が見込めるエリア',text:cross.growth_areas,color:'#3b82f6'});
    if (cross.risk_areas) insightCards.push({icon:'⚠️',title:'リスク・注意エリア',text:cross.risk_areas,color:'#f59e0b'});

    if (insightCards.length > 0) {
      html += '<div class="insight-grid">';
      insightCards.forEach(function(card) {
        html += '<div style="background:rgba(30,41,59,0.5); border-radius:12px; padding:16px; border-left:4px solid ' + card.color + ';">' +
          '<div style="font-size:13px; font-weight:700; margin-bottom:8px; color:' + card.color + ';">' + card.icon + ' ' + card.title + '</div>' +
          '<div style="font-size:12px; color:var(--text-secondary); line-height:1.6;">' + escapeHtml(card.text) + '</div></div>';
      });
      html += '</div>';
    }

    html += '</div></div>'; // result-card end
  }

  // Market Data Cards (タブ式マルチエリア)
  if (markets.length > 0) {
    // タブボタン
    html += '<div class="result-card" style="border: 1px solid rgba(99,102,241,0.15); padding: 0;">' +
      '<div class="result-card__header" style="padding:16px 20px 0">' +
      '<div class="result-card__icon">📊</div>' +
      '<div><div class="result-card__title">エリア別市場データ</div>' +
      '<div class="result-card__subtitle">' + markets.length + 'エリアの①〜⑥データ</div></div></div>' +
      '<div class="area-tab-btns" style="display:flex; flex-wrap:wrap; gap:6px; padding:12px 20px; border-bottom:1px solid rgba(99,102,241,0.1);">';

    markets.forEach(function(mkt, idx) {
      var isHQ = mkt.area && mkt.area.isHQ;
      var label = isHQ ? '🏢 ' + (mkt.area.label || '本社') : '📍 ' + (mkt.area.label || 'エリア' + (idx+1));
      var activeStyle = idx === 0
        ? 'background:var(--accent-gradient); color:#fff; border-color:transparent;'
        : 'background:var(--bg-tertiary); color:var(--text-secondary); border-color:rgba(99,102,241,0.15);';
      html += '<button class="area-tab-btn" data-area-idx="' + idx + '" onclick="switchAreaTab(' + idx + ')" style="' +
        'padding:6px 14px; border-radius:20px; border:1px solid; font-size:11px; font-weight:600; cursor:pointer; transition:all 0.2s; white-space:nowrap; ' +
        activeStyle + '">' + escapeHtml(label) + '</button>';
    });
    html += '</div>';

    // 各エリアのコンテンツ
    markets.forEach(function(mkt, idx) {
      var m = mkt.data || {};
      var areaLabel = m.area_name || (mkt.area && mkt.area.label) || 'エリア';
      var display = idx === 0 ? 'block' : 'none';
      var isHQ = mkt.area && mkt.area.isHQ;
      var fullLabel = (isHQ ? '🏢 ' : '📍 ') + areaLabel;
      html += '<div class="area-tab-content" id="area-tab-' + idx + '" data-area-label="' + escapeHtml(fullLabel) + '" style="display:' + display + '; padding:16px 20px;">';

      // ① 人口
      if (m.population) {
        var pop = m.population;
        var popSource = pop.source ? ' <span style="font-size:11px; color:var(--text-muted);">(' + escapeHtml(pop.source) + ')</span>' : '';
        html += '<div style="margin-bottom:16px;"><div style="font-size:14px; font-weight:700; margin-bottom:8px;">👥 ① 人口・世帯データ' + popSource + '</div>' +
          '<div class="stat-grid">' +
          '<div class="stat-box"><div class="stat-box__value">' + formatNumber(pop.total_population) + '</div><div class="stat-box__label">総人口</div></div>' +
          '<div class="stat-box"><div class="stat-box__value">' + formatNumber(pop.households) + '</div><div class="stat-box__label">世帯数</div></div>' +
          '<div class="stat-box"><div class="stat-box__value">' + (pop.age_30_45_pct || '—') + '%</div><div class="stat-box__label">30〜45歳</div></div>' +
          '<div class="stat-box"><div class="stat-box__value">' + (pop.elderly_pct || '—') + '%</div><div class="stat-box__label">65歳以上</div></div>' +
          '</div></div>';
      }

      // ② 建築着工
      if (m.construction) {
        var con = m.construction;
        html += '<div style="margin-bottom:16px;"><div style="font-size:14px; font-weight:700; margin-bottom:8px;">🏗️ ② 建築着工統計</div>' +
          '<table class="data-table">' +
          '<tr><th>持家 着工戸数</th><td><span class="highlight">' + formatNumber(con.owner_occupied) + '</span> 戸/年</td></tr>' +
          '<tr><th>全体 着工戸数</th><td>' + formatNumber(con.total) + ' 戸/年</td></tr>' +
          '<tr><th>前年比</th><td>' + (con.yoy_change || '—') + '</td></tr>' +
          '</table></div>';
      }

      // ③ 持ち家率
      if (m.housing) {
        var h = m.housing;
        html += '<div style="margin-bottom:16px;"><div style="font-size:14px; font-weight:700; margin-bottom:8px;">🏡 ③ 持ち家率・空き家率</div>' +
          '<div class="stat-grid">' +
          '<div class="stat-box"><div class="stat-box__value">' + (h.ownership_rate || '—') + '%</div><div class="stat-box__label">持ち家率</div></div>' +
          '<div class="stat-box"><div class="stat-box__value">' + (h.vacancy_rate || '—') + '%</div><div class="stat-box__label">空き家率</div></div>' +
          '<div class="stat-box"><div class="stat-box__value">' + (h.rental_vacancy || '—') + '%</div><div class="stat-box__label">貸家空室率</div></div>' +
          '</div></div>';
      }

      // ④ 土地相場
      if (m.land_price) {
        var lp = m.land_price;
        html += '<div style="margin-bottom:16px;"><div style="font-size:14px; font-weight:700; margin-bottom:8px;">🗺️ ④ 土地相場</div>' +
          '<table class="data-table">' +
          '<tr><th>住宅地 平均坪単価</th><td><span class="highlight">' + (lp.residential_tsubo ? '¥' + formatNumber(lp.residential_tsubo) : '—') + '</span></td></tr>' +
          '<tr><th>住宅地 平均㎡単価</th><td>¥' + formatNumber(lp.residential_sqm) + '/㎡</td></tr>' +
          '<tr><th>商業地 平均㎡単価</th><td>¥' + formatNumber(lp.commercial_sqm) + '/㎡</td></tr>' +
          '<tr><th>前年比</th><td>' + (lp.yoy_change || '—') + '</td></tr>' +
          '</table></div>';
      }

      // ⑤ 新築住宅相場
      if (m.home_prices) {
        var hp = m.home_prices;
        // 万円単位サニタイズ（Geminiが円単位で返すことがあるため）
        var avgP = hp.avg_price || 0;
        if (avgP > 50000) avgP = Math.round(avgP / 10000); // 円→万円変換
        var reqInc = hp.required_income || 0;
        if (reqInc > 50000) reqInc = Math.round(reqInc / 10000);
        html += '<div style="margin-bottom:16px;"><div style="font-size:14px; font-weight:700; margin-bottom:8px;">🏠 ⑤ 新築住宅相場</div>' +
          '<table class="data-table">' +
          '<tr><th>新築一戸建て 平均</th><td><span class="highlight">' + (avgP ? '¥' + formatNumber(avgP) + '万円' : '—') + '</span></td></tr>' +
          '<tr><th>価格帯</th><td>' + (hp.price_range || '—') + '</td></tr>' +
          '<tr><th>目安年収</th><td>' + (reqInc ? '¥' + formatNumber(reqInc) + '万円' : '—') + '</td></tr>' +
          '</table></div>';
      }

      // ⑥ 競合分析
      if (m.competition) {
        var comp = m.competition;
        html += '<div style="margin-bottom:16px;"><div style="font-size:14px; font-weight:700; margin-bottom:8px;">🏢 ⑥ 競合分析</div>' +
          '<div class="stat-grid">' +
          '<div class="stat-box"><div class="stat-box__value">' + (comp.total_companies || '—') + '</div><div class="stat-box__label">工務店・HM数</div></div>' +
          '<div class="stat-box"><div class="stat-box__value">' + (comp.local_builders || '—') + '</div><div class="stat-box__label">地場工務店</div></div>' +
          '</div></div>';
      }

      // 潜在顧客数
      if (m.potential) {
        var pot = m.potential;
        html += '<div style="margin-bottom:8px;"><div style="font-size:14px; font-weight:700; margin-bottom:8px;">🎯 潜在顧客数の試算</div>' +
          '<table class="data-table">' +
          '<tr><th>30〜45歳 世帯数</th><td>' + formatNumber(pot.target_households) + ' 世帯</td></tr>' +
          '<tr><th>賃貸世帯数</th><td>' + formatNumber(pot.rental_households) + ' 世帯</td></tr>' +
          '<tr><th>年間持ち家転換推定</th><td><span class="highlight">' + formatNumber(pot.annual_converts) + ' 世帯/年</span></td></tr>' +
          '<tr><th>1社あたり年間獲得</th><td><span class="highlight--amber">' + (pot.per_company || '—') + ' 棟</span></td></tr>' +
          '</table>';
        if (pot.ai_insight) {
          html += '<div class="summary-box" style="margin-top:10px"><div class="summary-box__title">📌 AIからの提言</div><div class="summary-box__text">' + escapeHtml(pot.ai_insight) + '</div></div>';
        }
        html += '</div>';
      }

      html += '</div>'; // area-tab-content end
    });

    html += '</div>'; // result-card end
  } else if (market) {
    // フォールバック: 旧式の単一エリア表示（markets配列がない場合）
    var m = market;
    var areaLabel = m.area_name || '対象エリア';
    // (既存コードと同じ構造で単一表示)
    if (m.population) {
      var pop = m.population;
      html += '<div class="result-card result-card--population"><div class="result-card__header"><div class="result-card__icon">👥</div><div><div class="result-card__title">① 人口・世帯データ</div><div class="result-card__subtitle">' + escapeHtml(areaLabel) + '</div></div></div>' +
        '<div class="result-card__body"><div class="stat-grid">' +
        '<div class="stat-box"><div class="stat-box__value">' + formatNumber(pop.total_population) + '</div><div class="stat-box__label">総人口</div></div>' +
        '<div class="stat-box"><div class="stat-box__value">' + formatNumber(pop.households) + '</div><div class="stat-box__label">世帯数</div></div>' +
        '</div></div></div>';
    }
  }


  resultsContent.innerHTML = html;

  // Chart.jsでグラフ描画
  if (markets.length > 0 && typeof Chart !== 'undefined') {
    setTimeout(function() { renderSummaryCharts(markets); }, 100);
  }
}

// ---- Summary Charts (Chart.js) ----
function renderSummaryCharts(markets) {
  var labels = markets.map(function(mkt) {
    return mkt.area ? mkt.area.label : 'エリア';
  });
  var popData = markets.map(function(mkt) { return ((mkt.data||{}).population||{}).total_population||0; });
  var convData = markets.map(function(mkt) { return ((mkt.data||{}).potential||{}).annual_converts||0; });
  var conData = markets.map(function(mkt) { return ((mkt.data||{}).construction||{}).total||0; });
  var compData = markets.map(function(mkt) { return ((mkt.data||{}).competition||{}).total_companies||0; });

  var chartFont = { color: '#94a3b8', family: 'system-ui' };
  var gridColor = 'rgba(148,163,184,0.1)';

  // Chart 1: 人口 × 年間転換
  var ctx1 = document.getElementById('chart-pop-conv');
  if (ctx1) {
    new Chart(ctx1, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { label: '人口', data: popData, backgroundColor: 'rgba(99,102,241,0.6)', borderRadius: 6, yAxisID: 'y', order: 2 },
          { label: '年間転換(世帯)', data: convData, type: 'line', borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.15)', pointBackgroundColor: '#10b981', pointRadius: 5, borderWidth: 3, fill: true, yAxisID: 'y1', order: 1 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: chartFont.color, font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: chartFont.color, font: { size: 10 } }, grid: { color: gridColor } },
          y: { position: 'left', ticks: { color: chartFont.color, font: { size: 10 }, callback: function(v) { return v >= 10000 ? (v/10000).toFixed(0)+'万' : v; } }, grid: { color: gridColor } },
          y1: { position: 'right', ticks: { color: '#10b981', font: { size: 10 } }, grid: { display: false } }
        }
      }
    });
  }

  // Chart 2: 着工 × 競合数
  var ctx2 = document.getElementById('chart-con-comp');
  if (ctx2) {
    new Chart(ctx2, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { label: '着工(戸/年)', data: conData, backgroundColor: 'rgba(245,158,11,0.6)', borderRadius: 6 },
          { label: '競合数', data: compData, backgroundColor: 'rgba(244,63,94,0.6)', borderRadius: 6 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: chartFont.color, font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: chartFont.color, font: { size: 10 } }, grid: { color: gridColor } },
          y: { ticks: { color: chartFont.color, font: { size: 10 } }, grid: { color: gridColor } }
        }
      }
    });
  }
}

// ---- Area Tab Switching ----
function switchAreaTab(idx) {
  // 全コンテンツを非表示
  var contents = document.querySelectorAll('.area-tab-content');
  contents.forEach(function(el) { el.style.display = 'none'; });
  // 選択したコンテンツを表示
  var target = document.getElementById('area-tab-' + idx);
  if (target) target.style.display = 'block';
  // ボタンスタイル更新
  var btns = document.querySelectorAll('.area-tab-btn');
  btns.forEach(function(btn) {
    var btnIdx = parseInt(btn.getAttribute('data-area-idx'));
    if (btnIdx === idx) {
      btn.style.background = 'var(--accent-gradient)';
      btn.style.color = '#fff';
      btn.style.borderColor = 'transparent';
    } else {
      btn.style.background = 'var(--bg-tertiary)';
      btn.style.color = 'var(--text-secondary)';
      btn.style.borderColor = 'rgba(99,102,241,0.15)';
    }
  });
}

// ---- Excel Export ----
function exportExcel() {
  if (!analysisData) return;
  var wb = XLSX.utils.book_new();
  var company = analysisData.company || {};
  var markets = analysisData.markets || [];
  var cross = analysisData.crossAreaInsight || {};

  // ヘルパー: テキストバーチャート
  function makeBar(value, maxVal) {
    if (!value || !maxVal) return '';
    var len = Math.round((value / maxVal) * 20);
    var bar = '';
    for (var b = 0; b < len; b++) bar += '█';
    return bar;
  }

  // ===== Sheet 1: 全社サマリー =====
  var s0 = [];
  s0.push(['全社エリア比較サマリー — ' + (company.name || '企業名')]);
  s0.push(['出力日: ' + new Date().toLocaleDateString('ja-JP'), '', '', '', '', '', '', '', '', '分析URL: ' + (analysisData.url || '')]);
  s0.push([]);

  if (markets.length > 0) {
    // 比較表ヘッダー
    s0.push(['No', 'エリア名', '人口', '世帯数', '着工(戸/年)', '持家率(%)', '空家率(%)', '坪単価(万)', '住宅平均(万)', '競合数', '年間転換', '1社獲得(棟)', 'チャンスバー']);

    var popMax = 0, convMax = 0;
    var totPop = 0, totHH = 0, totCon = 0, totOwn = 0, totVac = 0, totLand = 0, totPrice = 0, totComp = 0, totConv = 0, totPer = 0;
    var cnt = 0;

    var areaRows = [];
    markets.forEach(function(mkt) {
      var d = mkt.data || {};
      var pop = (d.population || {}).total_population || 0;
      var hh = (d.population || {}).households || 0;
      var con = (d.construction || {}).total || 0;
      var own = (d.housing || {}).ownership_rate || 0;
      var vac = (d.housing || {}).vacancy_rate || 0;
      var landRaw = (d.land_price || {}).residential_tsubo || 0;
      var land = landRaw > 10000 ? Math.round(landRaw / 10000) : landRaw;
      var priceRaw = (d.home_prices || {}).avg_price || 0;
      var price = priceRaw > 50000 ? Math.round(priceRaw / 10000) : priceRaw;
      var comp = (d.competition || {}).total_companies || 0;
      var conv = (d.potential || {}).annual_converts || 0;
      var per = (d.potential || {}).per_company || 0;

      if (pop > popMax) popMax = pop;
      if (conv > convMax) convMax = conv;

      totPop += pop; totHH += hh; totCon += con; totOwn += own; totVac += vac;
      totLand += land; totPrice += price; totComp += comp; totConv += conv; totPer += per;
      cnt++;

      var label = (mkt.area.isHQ ? '🏢 ' : '📍 ') + mkt.area.label;
      areaRows.push([label, pop, hh, con, own, vac, land, price, comp, conv, per]);
    });

    areaRows.forEach(function(r, idx) {
      var score = convMax > 0 ? Math.round((r[9] / convMax) * 100) : 0;
      s0.push([idx + 1, r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10], makeBar(score, 100) + ' ' + score + '点']);
    });

    // 合計・平均
    var n = cnt || 1;
    s0.push([]);
    s0.push(['', '【合計】', totPop, totHH, totCon, '', '', '', '', totComp, totConv, totPer, '']);
    s0.push(['', '【平均】', Math.round(totPop / n), Math.round(totHH / n), Math.round(totCon / n),
      (totOwn / n).toFixed(1), (totVac / n).toFixed(1), Math.round(totLand / n), Math.round(totPrice / n),
      Math.round(totComp / n), Math.round(totConv / n), (totPer / n).toFixed(1), '']);

    s0.push([]);
    s0.push([]);

    // AI横断分析
    s0.push(['■ AI経営分析']);
    s0.push([]);

    if (cross.opportunity_ranking && cross.opportunity_ranking.length > 0) {
      s0.push(['▼ チャンスランキング（営業優先度）']);
      s0.push(['順位', 'エリア', 'スコア', '理由']);
      cross.opportunity_ranking.forEach(function(r) {
        s0.push([r.rank || '', r.area || '', r.score || '', r.reason || '']);
      });
      s0.push([]);
    }

    if (cross.strategic_summary) {
      s0.push(['▼ 経営戦略サマリー']);
      s0.push([cross.strategic_summary]);
      s0.push([]);
    }

    if (cross.sales_advice) {
      s0.push(['▼ 営業チームへのアドバイス']);
      s0.push([cross.sales_advice]);
      s0.push([]);
    }

    if (cross.growth_areas) {
      s0.push(['▼ 成長が見込めるエリア']);
      s0.push([cross.growth_areas]);
      s0.push([]);
    }

    if (cross.risk_areas) {
      s0.push(['▼ リスク・注意エリア']);
      s0.push([cross.risk_areas]);
    }
  }

  var ws0 = XLSX.utils.aoa_to_sheet(s0);
  ws0['!cols'] = [
    { wch: 5 }, { wch: 24 }, { wch: 10 }, { wch: 10 }, { wch: 12 },
    { wch: 10 }, { wch: 10 }, { wch: 11 }, { wch: 12 }, { wch: 8 },
    { wch: 12 }, { wch: 12 }, { wch: 28 }
  ];
  ws0['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 12 } }];
  XLSX.utils.book_append_sheet(wb, ws0, '全社サマリー');

  // ===== Sheet 2: 会社概要 =====
  var s1Data = [
    ['企業概要 — ' + (company.name || '')],
    ['出力日: ' + new Date().toLocaleDateString('ja-JP')],
    [],
    ['■ 基本情報'],
    ['企業名', company.name || '—'],
    ['本社所在地', company.address || '—'],
    ['事業内容', company.business_type || '—'],
    ['主力サービス', company.main_services || '—'],
    ['不動産事業', company.is_real_estate ? '該当' : '非該当'],
    ['対象エリア', company.target_area || '—'],
    ['従業員規模', company.employee_scale || '—'],
    [],
    ['■ 強み・特徴'],
    [company.strengths || '—'],
    [],
    ['■ 改善余地'],
    [company.weaknesses || '—'],
  ];

  if (company.offices && company.offices.length > 0) {
    s1Data.push([]);
    s1Data.push(['■ 事業所一覧 (' + company.offices.length + '拠点)']);
    s1Data.push(['拠点', '郵便番号', '住所', '電話番号']);
    company.offices.forEach(function(o, i) {
      var label = o.is_hq ? '本社' : '拠点' + i;
      s1Data.push([label, o.zip || '', o.address || '', o.tel || '']);
    });
  }

  var ws1 = XLSX.utils.aoa_to_sheet(s1Data);
  ws1['!cols'] = [{ wch: 18 }, { wch: 50 }, { wch: 20 }, { wch: 18 }];
  ws1['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
  XLSX.utils.book_append_sheet(wb, ws1, '会社概要');

  // ===== Sheet 3: 巡回ページ =====
  var crawledPages = (_crawlDebugInfo && _crawlDebugInfo.crawledPages) || [];
  if (crawledPages.length > 0) {
    var s2Data = [['No.', 'ページ名', '文字数', 'URL', '要約']];
    crawledPages.forEach(function(p, i) {
      s2Data.push([i + 1, p.name || '', p.chars || 0, p.url || '', p.summary || '']);
    });
    var ws2 = XLSX.utils.aoa_to_sheet(s2Data);
    ws2['!cols'] = [{ wch: 5 }, { wch: 30 }, { wch: 8 }, { wch: 50 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, ws2, '巡回ページ');
  }

  // ===== Sheet 4+: エリア別詳細 =====
  if (markets.length > 0) {
    markets.forEach(function(mkt, idx) {
      var m = mkt.data || {};
      var areaLabel = m.area_name || (mkt.area && mkt.area.label) || 'エリア' + (idx + 1);
      var sheetName = areaLabel.slice(0, 28);
      var rows = [];

      rows.push(['エリア詳細: ' + areaLabel]);
      rows.push([]);

      if (m.population) {
        var pop = m.population;
        rows.push(['① 人口・世帯データ', '', 'ソース:', pop.source || '推計']);
        rows.push(['総人口', pop.total_population || 0]);
        rows.push(['世帯数', pop.households || 0]);
        rows.push(['30〜45歳比率', (pop.age_30_45_pct || 0) + '%']);
        rows.push(['65歳以上比率', (pop.elderly_pct || 0) + '%']);
        rows.push([]);
      }

      if (m.construction) {
        var con = m.construction;
        rows.push(['② 建築着工統計']);
        rows.push(['持家 着工戸数', (con.owner_occupied || 0) + ' 戸/年']);
        rows.push(['全体 着工戸数', (con.total || 0) + ' 戸/年']);
        rows.push(['前年比', con.yoy_change || '—']);
        rows.push([]);
      }

      if (m.housing) {
        var hou = m.housing;
        rows.push(['③ 持ち家率・空き家率']);
        rows.push(['持ち家率', (hou.ownership_rate || 0) + '%']);
        rows.push(['空き家率', (hou.vacancy_rate || 0) + '%']);
        rows.push([]);
      }

      if (m.land_price) {
        var lp = m.land_price;
        rows.push(['④ 土地相場']);
        rows.push(['住宅地 平均坪単価', lp.residential_tsubo ? '¥' + formatNumber(lp.residential_tsubo) : '—']);
        rows.push(['住宅地 平均㎡単価', lp.residential_sqm ? '¥' + formatNumber(lp.residential_sqm) + '/㎡' : '—']);
        rows.push(['前年比', lp.yoy_change || '—']);
        rows.push([]);
      }

      if (m.home_prices) {
        var hp = m.home_prices;
        var avgP = hp.avg_price || 0;
        if (avgP > 50000) avgP = Math.round(avgP / 10000);
        var reqInc = hp.required_income || 0;
        if (reqInc > 50000) reqInc = Math.round(reqInc / 10000);
        rows.push(['⑤ 新築住宅相場']);
        rows.push(['新築一戸建て平均', avgP ? avgP + '万円' : '—']);
        rows.push(['価格帯', hp.price_range || '—']);
        rows.push(['目安年収', reqInc ? reqInc + '万円' : '—']);
        rows.push([]);
      }

      if (m.competition) {
        var comp = m.competition;
        rows.push(['⑥ 競合分析']);
        rows.push(['工務店・ビルダー数', (comp.total_companies || 0) + '社']);
        rows.push(['新築分譲業者数', (comp.new_build_companies || 0) + '社']);
        rows.push([]);
      }

      if (m.potential) {
        var pot = m.potential;
        rows.push(['⑦ 潜在顧客']);
        rows.push(['30〜45歳 世帯数', formatNumber(pot.target_households) + ' 世帯']);
        rows.push(['賃貸世帯数', formatNumber(pot.rental_households) + ' 世帯']);
        rows.push(['年間持ち家転換', formatNumber(pot.annual_converts) + ' 世帯/年']);
        rows.push(['1社あたり獲得', (pot.per_company || '—') + ' 棟']);
        if (pot.ai_insight) {
          rows.push([]);
          rows.push(['AIコメント', pot.ai_insight]);
        }
      }

      var ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = [{ wch: 22 }, { wch: 35 }, { wch: 12 }, { wch: 20 }];
      ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });
  }

  var fileName = '不動産市場分析_' + (company.name || 'report') + '_' + new Date().toISOString().slice(0, 10) + '.xlsx';
  XLSX.writeFile(wb, fileName);
}

// ---- Reset ----
function resetAll() {
  analysisData = null;
  urlInput.value = '';
  hideResults();
  hideProgress();
  hideError();
  resultsContent.innerHTML = '';
}

// ---- UI Helpers ----
function setLoading(isLoading) {
  analyzeBtn.disabled = isLoading;
  analyzeBtn.classList.toggle('is-loading', isLoading);
}

function showProgress() {
  progressSection.classList.add('is-active');
  document.querySelectorAll('.progress__step').forEach(function(s) {
    s.classList.remove('is-active', 'is-done');
  });
}

function hideProgress() { progressSection.classList.remove('is-active'); }

function activateStep(id) {
  var step = document.getElementById(id);
  if (step) { step.classList.add('is-active'); step.classList.remove('is-done'); }
}

function completeStep(id) {
  var step = document.getElementById(id);
  if (step) { step.classList.remove('is-active'); step.classList.add('is-done'); }
}

function showResults() {
  resultsSection.classList.add('is-active');
  resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function hideResults() { resultsSection.classList.remove('is-active'); }

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.add('is-active');
}

function hideError() { errorMsg.classList.remove('is-active'); }

// ---- Utility ----
function isValidUrl(string) {
  try {
    var url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (e) { return false; }
}

function escapeHtml(str) {
  if (!str) return '';
  var div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

function formatNumber(num) {
  if (num == null || num === '') return '—';
  return Number(num).toLocaleString('ja-JP');
}

function sleep(ms) { return new Promise(function(resolve) { setTimeout(resolve, ms); }); }

// Enter key
urlInput.addEventListener('keypress', function(e) {
  if (e.key === 'Enter') startAnalysis();
});
