// ========================================
// 不動産市場把握AI v3.0 - Frontend Only
// ブラウザから直接Gemini API + e-Stat APIを呼び出す
// ========================================

var GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
var CORS_PROXIES = [
  { name: 'corsproxy.io', build: function(u) { return 'https://corsproxy.io/?' + encodeURIComponent(u); } },
  { name: 'allorigins', build: function(u) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u); } },
  { name: 'codetabs', build: function(u) { return 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u); } }
];
var ESTAT_API_BASE = 'https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData';
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
var settingsBtn = document.getElementById('settings-btn');
var closeSettingsBtn = document.querySelector('.modal__close');
var saveSettingsBtn = document.getElementById('save-settings-btn');
var geminiKeyInput = document.getElementById('gemini-key');
var estatKeyInput = document.getElementById('estat-key');

// Load saved keys
if (geminiKeyInput) {
  geminiKeyInput.value = localStorage.getItem('gemini_api_key') || '';
}
if (estatKeyInput) {
  estatKeyInput.value = localStorage.getItem('estat_app_id') || '';
}
updateStatusDisplay();

// Event Listeners
if (settingsBtn) {
  settingsBtn.addEventListener('click', function() {
    settingsModal.classList.add('active');
    geminiKeyInput.value = localStorage.getItem('gemini_api_key') || '';
    if (estatKeyInput) estatKeyInput.value = localStorage.getItem('estat_app_id') || '';
    updateStatusDisplay();
  });
}

if (closeSettingsBtn) {
  closeSettingsBtn.addEventListener('click', function() {
    settingsModal.classList.remove('active');
  });
}

if (saveSettingsBtn) {
  saveSettingsBtn.addEventListener('click', function() {
    var geminiKey = geminiKeyInput.value.trim();
    var estatKey = estatKeyInput ? estatKeyInput.value.trim() : '';

    if (geminiKey) {
      localStorage.setItem('gemini_api_key', geminiKey);
    } else {
      localStorage.removeItem('gemini_api_key');
    }

    if (estatKey) {
      localStorage.setItem('estat_app_id', estatKey);
    } else {
      localStorage.removeItem('estat_app_id');
    }

    updateStatusDisplay();
    saveSettingsBtn.textContent = '✅ 保存しました!';
    setTimeout(function() {
      saveSettingsBtn.textContent = '保存する';
      settingsModal.classList.remove('active');
    }, 1000);
  });
}

if (settingsModal) {
  settingsModal.addEventListener('click', function(e) {
    if (e.target === settingsModal) settingsModal.classList.remove('active');
  });
}

function updateStatusDisplay() {
  var statusEl = document.getElementById('status-content');
  if (!statusEl) return;
  var geminiKey = localStorage.getItem('gemini_api_key');
  var estatKey = localStorage.getItem('estat_app_id');
  var html = '';

  if (geminiKey) {
    html += '<div class="status-item ok">✅ Gemini API Key 設定済</div>';
  } else {
    html += '<div class="status-item ng">❌ Gemini API Key 未設定</div>';
  }

  if (estatKey) {
    html += '<div class="status-item ok">✅ e-Stat App ID 設定済（政府統計使用）</div>';
  } else {
    html += '<div class="status-item warn">⚠️ e-Stat App ID 未設定（AI推計モード）</div>';
  }

  html += '<div class="status-item ok">🤖 AI Model: Gemini 2.0 Flash</div>';
  statusEl.innerHTML = html;
}

// ---- Gemini API Direct Call ----
async function callGemini(prompt) {
  var apiKey = localStorage.getItem('gemini_api_key');
  if (!apiKey) throw new Error('Gemini APIキーが設定されていません。右上の「🔑 API設定」から設定してください。');

  var res = await fetch(GEMINI_API_BASE + '?key=' + apiKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 8000,
      }
    })
  });

  if (!res.ok) {
    var errData = await res.json().catch(function() { return {}; });
    var errMessage = (errData.error && errData.error.message) || ('API Error: ' + res.status);
    if (res.status === 400 && errMessage.includes('API key')) {
      throw new Error('APIキーが無効です。設定を確認してください。');
    }
    throw new Error(errMessage);
  }

  var data = await res.json();
  var text = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text) || '';
  return text;
}

// ---- e-Stat API ----
async function fetchEstatPopulation(prefecture, city) {
  var appId = localStorage.getItem('estat_app_id');
  if (!appId) return null;

  var prefCode = PREFECTURE_CODES[prefecture];
  if (!prefCode) return null;

  addLog('e-Stat APIから人口データを取得中...', 'info');

  try {
    // 国勢調査 人口等基本集計 (statsDataId: 0003448233)
    var url = ESTAT_API_BASE + '?appId=' + appId +
      '&statsDataId=0003448233' +
      '&cdArea=' + prefCode + '000' +
      '&limit=100';

    var res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error('e-Stat API HTTP ' + res.status);
    var data = await res.json();

    var result = data.GET_STATS_DATA && data.GET_STATS_DATA.STATISTICAL_DATA;
    if (!result || !result.DATA_INF || !result.DATA_INF.VALUE) {
      // 都道府県コードが合わない場合、都道府県レベルのデータを試行
      url = ESTAT_API_BASE + '?appId=' + appId +
        '&statsDataId=0003448233' +
        '&cdArea=' + prefCode +
        '&limit=100';
      res = await fetch(url, { signal: AbortSignal.timeout(10000) });
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

    // 値を抽出
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      var val = parseInt(v.$, 10);
      if (isNaN(val)) continue;

      // 総人口
      if (v['@tab'] === '020' || (v['@cat01'] && v['@cat01'].indexOf('0010') >= 0)) {
        if (!population || val > 100) population = val;
      }
      // 世帯数
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
  var appId = localStorage.getItem('estat_app_id');
  if (!appId) return null;

  var prefCode = PREFECTURE_CODES[prefecture];
  if (!prefCode) return null;

  try {
    // 住宅・土地統計調査 (statsDataId: 0003445078)
    var url = ESTAT_API_BASE + '?appId=' + appId +
      '&statsDataId=0003445078' +
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
        var summary = extractPageSummary(subText);
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

  // 全HTMLソースから住所を抽出（グローバルに保存）
  var allHtmlCombined = allHtmlSources.join('\n');
  _crawledAddresses = extractAddressesFromHtml(allHtmlCombined);
  addLog('HTMLソースから住所 ' + _crawledAddresses.length + '件を直接検出', _crawledAddresses.length > 0 ? 'success' : 'info');

  // 全テキストを結合（上限15000文字）
  var combined = allTexts.join('\n\n---\n\n');
  if (combined.length > 15000) combined = combined.slice(0, 15000);
  return combined;
}

// HTMLソースから直接住所を抽出（テキスト変換に依存しない）
function extractAddressesFromHtml(html) {
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

    results.push({
      zip: '〒' + zip,
      address: address,
      tel: tel
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
  var url = urlInput.value.trim();

  if (!url) { showError('URLを入力してください'); return; }
  if (!isValidUrl(url)) { showError('有効なURLを入力してください（例: https://example.co.jp）'); return; }

  var apiKey = localStorage.getItem('gemini_api_key');
  if (!apiKey) {
    showError('Gemini APIキーが設定されていません。右上の「🔑 API設定」をクリックして設定してください。');
    return;
  }

  hideError();
  hideResults();
  showProgress();
  setLoading(true);
  clearLogs();

  addLog('分析を開始します...', 'info');

  var estatAppId = localStorage.getItem('estat_app_id');
  if (estatAppId) {
    addLog('e-Stat App ID検出 → 政府統計データを優先使用', 'info');
  } else {
    addLog('e-Stat未設定 → AI推計モードで実行', 'info');
  }

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

    // Step 3: Market Data (per area)
    activateStep('step-market');

    // crawlSiteで抽出済みの住所を使用
    var extractedAddresses = _crawledAddresses || [];
    addLog('サイトから住所 ' + extractedAddresses.length + '件を検出済み', 'info');

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

      // e-Stat data (per prefecture)
      var areaEstatPop = null;
      var areaEstatHousing = null;
      if (estatAppId && area.prefecture) {
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
      timestamp: new Date().toISOString(),
      data_source: estatAppId ? 'e-Stat + Gemini' : 'Gemini推計',
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

// 住所から都道府県・市区町村を抽出（最小区分まで）
function extractAreaFromAddress(address) {
  if (!address) return null;
  var prefMatch = address.match(/(北海道|東京都|大阪府|京都府|.{2,3}県)/);
  if (!prefMatch) return null;
  var pref = prefMatch[1];
  var rest = address.slice(address.indexOf(pref) + pref.length);
  var city = '';
  if (pref === '東京都') {
    // 東京都の特別区（23区）を直接取得
    var wardMatch = rest.match(/^(.+?区)/);
    city = wardMatch ? wardMatch[1] : '';
  } else {
    // 政令指定都市: 市+区まで取得、郡: 郡+町村まで取得
    var cityMatch = rest.match(/^(.+?市)(.+?区)?/) || rest.match(/^(.+?郡)(.+?[町村])/);
    if (cityMatch) {
      city = cityMatch[1] + (cityMatch[2] || '');
    } else {
      // 区のみ（大阪市等の区）
      var kuMatch = rest.match(/^(.+?区)/);
      city = kuMatch ? kuMatch[1] : '';
    }
  }
  return { prefecture: pref, city: city, label: pref + ' ' + city };
}

// ページテキストから意味のある要約を抽出（ナビゲーションを除外）
function extractPageSummary(text) {
  // 改行で分割して意味のある行を探す
  var lines = text.split(/[\n\r]+/);
  var meaningful = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].replace(/\s+/g, ' ').trim();
    // 短すぎる行やナビ的な行をスキップ
    if (line.length < 15) continue;
    // よくあるナビゲーション文言をスキップ
    if (/^(来場予約|カタログ請求|個人のお客様|法人のお客様|オーナー様|施工実例|イベント情報|企業情報|採用情報|トップ|HOME|MENU|会社概要|お問い合わせ|お知らせ|ニュース|プライバシー|サイトマップ|English|Copyright)/.test(line)) continue;
    if (/^(家を建てる|土地を探す|分譲住宅を探す|リフォーム|エクステリア|住まいの)/.test(line)) continue;
    meaningful.push(line);
    if (meaningful.length >= 2) break;
  }
  return meaningful.join(' ').slice(0, 200) || text.replace(/\s+/g, ' ').slice(0, 100);
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

  // 巡回ページ一覧（要約付き）
  var crawledPages = (_crawlDebugInfo && _crawlDebugInfo.crawledPages) || [];
  if (crawledPages.length > 0) {
    var okCount = crawledPages.filter(function(p) { return p.status === 'OK'; }).length;
    html += '<div class="result-card" style="border: 1px solid rgba(99,102,241,0.15);">' +
      '<div class="result-card__header">' +
      '<div class="result-card__icon">🌐</div>' +
      '<div><div class="result-card__title">巡回ページ一覧</div>' +
      '<div class="result-card__subtitle">' + okCount + '/' + crawledPages.length + ' ページ取得成功</div></div></div>' +
      '<div class="result-card__body">';
    crawledPages.forEach(function(p, i) {
      if (p.status !== 'OK') return;
      html += '<div style="margin-bottom:10px; padding:8px 12px; border-radius:8px; background:rgba(99,102,241,0.04); border:1px solid rgba(99,102,241,0.08);">' +
        '<div style="font-size:12px; font-weight:700; color:var(--text-primary);">' + (i+1) + '. ' + escapeHtml(p.name) + ' <span style="font-weight:400; color:var(--text-muted); font-size:10px;">(' + p.chars.toLocaleString() + '文字)</span></div>' +
        '<div style="font-size:11px; color:var(--text-secondary); margin-top:3px; line-height:1.4;">' + escapeHtml(p.summary || '') + '</div>' +
        '</div>';
    });
    html += '</div></div>';
  }

  // Market Data Cards (タブ式マルチエリア)
  var markets = data.markets || [];
  if (markets.length > 0) {
    // タブボタン
    html += '<div class="result-card" style="border: 1px solid rgba(99,102,241,0.15); padding: 0;">' +
      '<div class="result-card__header" style="padding:16px 20px 0">' +
      '<div class="result-card__icon">📊</div>' +
      '<div><div class="result-card__title">エリア別市場データ</div>' +
      '<div class="result-card__subtitle">' + markets.length + 'エリアの①〜⑥データ</div></div></div>' +
      '<div style="display:flex; flex-wrap:wrap; gap:6px; padding:12px 20px; border-bottom:1px solid rgba(99,102,241,0.1);">';

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
      html += '<div class="area-tab-content" id="area-tab-' + idx + '" style="display:' + display + '; padding:16px 20px;">';

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

// ---- PDF Export ----
async function exportPDF() {
  var element = document.getElementById('results-content');
  if (!element) return;

  var opt = {
    margin: [10, 10, 10, 10],
    filename: '不動産市場分析_' + ((analysisData && analysisData.company && analysisData.company.name) || 'report') + '_' + new Date().toISOString().slice(0,10) + '.pdf',
    image: { type: 'jpeg', quality: 0.95 },
    html2canvas: { scale: 2, useCORS: true, backgroundColor: '#111827' },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  element.style.color = '#e2e8f0';
  await html2pdf().set(opt).from(element).save();
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
