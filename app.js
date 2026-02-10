// ========================================
// 不動産市場把握AI v2.0 - Frontend Only
// ブラウザから直接Gemini APIを呼び出す
// ========================================

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const CORS_PROXY = 'https://api.allorigins.win/raw?url=';

// ---- State ----
let analysisData = null;

// ---- DOM References ----
const urlInput = document.getElementById('url-input');
const analyzeBtn = document.getElementById('analyze-btn');
const errorMsg = document.getElementById('error-msg');
const progressSection = document.getElementById('progress-section');
const resultsSection = document.getElementById('results-section');
const resultsContent = document.getElementById('results-content');
const progressLogContent = document.getElementById('progress-log-content');

// ---- Settings Modal ----
const settingsModal = document.getElementById('settings-modal');
const settingsBtn = document.getElementById('settings-btn');
const closeSettingsBtn = document.querySelector('.modal__close');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const geminiKeyInput = document.getElementById('gemini-key');

// Load saved key
if (geminiKeyInput) {
  geminiKeyInput.value = localStorage.getItem('gemini_api_key') || '';
  updateStatusDisplay();
}

// Event Listeners
if (settingsBtn) {
  settingsBtn.addEventListener('click', () => {
    settingsModal.classList.add('active');
    geminiKeyInput.value = localStorage.getItem('gemini_api_key') || '';
    updateStatusDisplay();
  });
}

if (closeSettingsBtn) {
  closeSettingsBtn.addEventListener('click', () => {
    settingsModal.classList.remove('active');
  });
}

if (saveSettingsBtn) {
  saveSettingsBtn.addEventListener('click', () => {
    const key = geminiKeyInput.value.trim();
    if (key) {
      localStorage.setItem('gemini_api_key', key);
      updateStatusDisplay();
      // Brief success feedback
      saveSettingsBtn.textContent = '✅ 保存しました!';
      setTimeout(() => {
        saveSettingsBtn.textContent = '保存する';
        settingsModal.classList.remove('active');
      }, 1000);
    } else {
      localStorage.removeItem('gemini_api_key');
      updateStatusDisplay();
    }
  });
}

if (settingsModal) {
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) settingsModal.classList.remove('active');
  });
}

function updateStatusDisplay() {
  const statusEl = document.getElementById('status-content');
  if (!statusEl) return;
  const key = localStorage.getItem('gemini_api_key');
  statusEl.innerHTML = key
    ? '<div class="status-item ok">✅ Gemini API Key 設定済</div><div class="status-item ok">🤖 AI Model: Gemini 2.0 Flash</div>'
    : '<div class="status-item ng">❌ Gemini API Key 未設定</div>';
}

// ---- Gemini API Direct Call ----
async function callGemini(prompt) {
  const apiKey = localStorage.getItem('gemini_api_key');
  if (!apiKey) throw new Error('Gemini APIキーが設定されていません。右上の「🔑 API設定」から設定してください。');

  const res = await fetch(`${GEMINI_API_BASE}?key=${apiKey}`, {
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
    const errData = await res.json().catch(() => ({}));
    const errMsg = errData.error?.message || `API Error: ${res.status}`;
    if (res.status === 400 && errMsg.includes('API key')) {
      throw new Error('APIキーが無効です。設定を確認してください。');
    }
    throw new Error(errMsg);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return text;
}

// ---- Fetch Page via CORS Proxy ----
async function fetchPageContent(url) {
  try {
    const proxyUrl = CORS_PROXY + encodeURIComponent(url);
    const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    // Extract text from HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Remove scripts, styles, nav, footer
    doc.querySelectorAll('script, style, nav, footer, header, noscript, iframe').forEach(el => el.remove());

    const text = doc.body?.innerText || doc.body?.textContent || '';
    // Clean up whitespace
    return text.replace(/\s+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 5000);
  } catch (e) {
    console.warn(`[Fetch] Could not fetch ${url}: ${e.message}`);
    return null;
  }
}

// ---- Progress Log Helper ----
function addLog(message, type = 'normal') {
  if (!progressLogContent) return;
  const div = document.createElement('div');
  div.className = `log-item ${type}`;
  div.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  progressLogContent.appendChild(div);
  progressLogContent.scrollTop = progressLogContent.scrollHeight;
}

function clearLogs() {
  if (progressLogContent) progressLogContent.innerHTML = '';
}

// ---- Main Analysis Flow ----
async function startAnalysis() {
  const url = urlInput.value.trim();

  // Validate
  if (!url) { showError('URLを入力してください'); return; }
  if (!isValidUrl(url)) { showError('有効なURLを入力してください（例: https://example.co.jp）'); return; }

  const apiKey = localStorage.getItem('gemini_api_key');
  if (!apiKey) {
    showError('Gemini APIキーが設定されていません。右上の「🔑 API設定」をクリックして設定してください。');
    return;
  }

  // Reset & show progress
  hideError();
  hideResults();
  showProgress();
  setLoading(true);
  clearLogs();

  addLog('分析を開始します...', 'info');

  try {
    // Step 1: Fetch page content
    activateStep('step-crawl');
    addLog(`Webサイトの内容を取得中: ${url}`);

    let pageContent = await fetchPageContent(url);
    if (pageContent) {
      addLog(`ページ内容を取得しました (${pageContent.length}文字)`, 'success');
    } else {
      addLog('CORSプロキシ経由の取得に失敗。URLのみでAI分析を実行します。', 'info');
      pageContent = '';
    }
    completeStep('step-crawl');

    // Step 2: AI Business Analysis
    activateStep('step-analyze');
    addLog('Gemini 2.0 Flash で事業内容を分析中...');

    const analysisPrompt = buildAnalysisPrompt(url, pageContent);
    const analysisRaw = await callGemini(analysisPrompt);
    const analysis = parseJSON(analysisRaw);
    addLog(`分析完了: ${analysis.company?.name || '企業情報取得'}`, 'success');
    completeStep('step-analyze');

    // Step 3: Market Data via Gemini
    activateStep('step-market');
    const location = analysis.location || {};
    addLog(`市場データを生成中: ${location.prefecture || ''} ${location.city || ''}...`);

    const marketPrompt = buildMarketPrompt(analysis);
    const marketRaw = await callGemini(marketPrompt);
    const marketData = parseJSON(marketRaw);
    addLog('市場データの生成完了', 'success');
    completeStep('step-market');

    // Step 4: Render Report
    activateStep('step-report');
    addLog('レポート生成中...');
    await sleep(300);

    analysisData = {
      url,
      company: analysis.company || {},
      location: analysis.location || {},
      market: marketData,
      timestamp: new Date().toISOString()
    };

    renderResults(analysisData);
    addLog('レポート作成完了！', 'success');
    completeStep('step-report');

    await sleep(300);
    hideProgress();
    showResults();

  } catch (err) {
    console.error('Analysis error:', err);
    addLog(`エラー: ${err.message}`, 'error');
    showError(err.message);
  } finally {
    setLoading(false);
  }
}

// ---- Prompt Builders ----
function buildAnalysisPrompt(url, content) {
  const contentSection = content
    ? `\n以下はWebサイトから取得したテキストの一部です:\n---\n${content}\n---`
    : '\nWebサイトの内容は取得できませんでしたが、URLから推測してください。';

  return `あなたは不動産・住宅業界の市場分析の専門家です。
以下のURLの企業について分析してください。

URL: ${url}
${contentSection}

以下のJSON形式で回答してください。```json``` マークダウンは不要です:
{
  "company": {
    "name": "企業名",
    "address": "所在地（住所）",
    "business_type": "事業内容（簡潔に）",
    "main_services": "主力サービス・商品",
    "is_real_estate": true/false（不動産関連事業かどうか）,
    "strengths": "強み・特徴（100文字以内）",
    "weaknesses": "改善余地・課題（100文字以内）",
    "keywords": ["キーワード1", "キーワード2", "キーワード3"]
  },
  "location": {
    "prefecture": "都道府県",
    "city": "市区町村"
  }
}`;
}

function buildMarketPrompt(analysis) {
  const loc = analysis.location || {};
  const company = analysis.company || {};

  return `あなたは日本の不動産市場データの専門家です。
以下の地域の不動産市場データを、あなたの知識をもとに推定・提供してください。

対象エリア: ${loc.prefecture || '不明'} ${loc.city || ''}
企業の事業: ${company.business_type || '不明'}

できる限り正確な数値を提供してください。正確な数値が不明な場合は、合理的な推計値を「推計」と明記して提供してください。

以下のJSON形式で回答してください。```json``` マークダウンは不要です:
{
  "area_name": "${loc.prefecture || ''} ${loc.city || ''}",
  "population": {
    "total_population": 数値,
    "households": 世帯数,
    "age_30_45_pct": 30〜45歳の割合（%）,
    "elderly_pct": 65歳以上の割合（%）,
    "source": "データソース名"
  },
  "construction": {
    "total": 年間着工戸数,
    "owner_occupied": 持家着工戸数,
    "yoy_change": "前年比（例: +2.3%）",
    "year": "データ年度",
    "source": "推計"
  },
  "housing": {
    "ownership_rate": 持ち家率（%）,
    "vacancy_rate": 空き家率（%）,
    "rental_vacancy": 貸家空室率（%）
  },
  "land_price": {
    "residential_sqm": 住宅地平均㎡単価（円）,
    "residential_tsubo": 住宅地平均坪単価（円）,
    "commercial_sqm": 商業地平均㎡単価（円）,
    "yoy_change": "前年比（例: +1.2%）"
  },
  "home_prices": {
    "avg_price": 新築一戸建て平均価格（万円）,
    "price_range": "価格帯（例: 2,500〜4,000万円）",
    "required_income": 目安年収（万円）
  },
  "competition": {
    "total_companies": エリア内の工務店・ハウスメーカー数,
    "local_builders": 地場工務店数
  },
  "potential": {
    "target_households": 30〜45歳世帯数,
    "rental_households": 賃貸世帯数,
    "annual_converts": 年間持ち家転換推定数,
    "per_company": 1社あたりの年間獲得棟数,
    "ai_insight": "このエリアでの営業戦略に関する提言（200文字以内）"
  }
}`;
}

// ---- JSON Parser ----
function parseJSON(text) {
  let cleaned = text.trim();
  // Remove markdown code blocks
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // Try to extract JSON from text
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch (e2) { /* fall through */ }
    }
    console.error('JSON parse error:', e, '\nRaw:', cleaned.slice(0, 500));
    throw new Error('AIの応答をパースできませんでした。再度お試しください。');
  }
}

// ---- Render Results ----
function renderResults(data) {
  const { company, market } = data;
  let html = '';

  // Company Card
  html += `
    <div class="result-card result-card--company">
      <div class="result-card__header">
        <div class="result-card__icon">🏢</div>
        <div>
          <div class="result-card__title">${escapeHtml(company.name || '企業分析')}</div>
          <div class="result-card__subtitle">Gemini 2.0 Flash による事業内容分析</div>
        </div>
      </div>
      <div class="result-card__body">
        <table class="data-table">
          <tr><th>企業名</th><td>${escapeHtml(company.name || '—')}</td></tr>
          <tr><th>所在地</th><td>${escapeHtml(company.address || '—')}</td></tr>
          <tr><th>事業内容</th><td>${escapeHtml(company.business_type || '—')}</td></tr>
          <tr><th>主力サービス</th><td>${escapeHtml(company.main_services || '—')}</td></tr>
          <tr><th>不動産事業</th><td>${company.is_real_estate ? '<span class="highlight--green">✅ 該当</span>' : '❌ 非該当'}</td></tr>
        </table>
        ${company.strengths ? `<div class="summary-box" style="margin-top:16px"><div class="summary-box__title">💪 強み・特徴</div><div class="summary-box__text">${escapeHtml(company.strengths)}</div></div>` : ''}
        ${company.weaknesses ? `<div class="summary-box" style="margin-top:12px; background: linear-gradient(135deg, rgba(244,63,94,0.1), rgba(249,115,22,0.1)); border-color: rgba(244,63,94,0.2);"><div class="summary-box__title" style="color:var(--accent-rose)">⚠️ 改善余地</div><div class="summary-box__text">${escapeHtml(company.weaknesses)}</div></div>` : ''}
        ${company.keywords ? `<div class="tag-list" style="margin-top:16px">${company.keywords.map(k => `<span class="tag">${escapeHtml(k)}</span>`).join('')}</div>` : ''}
      </div>
    </div>`;

  // Market Data Cards
  if (market) {
    const m = market;
    const areaLabel = m.area_name || '対象エリア';

    if (m.population) {
      const pop = m.population;
      html += `
        <div class="result-card result-card--population">
          <div class="result-card__header">
            <div class="result-card__icon">👥</div>
            <div><div class="result-card__title">① 人口・世帯データ</div><div class="result-card__subtitle">${escapeHtml(areaLabel)}</div></div>
          </div>
          <div class="result-card__body">
            <div class="stat-grid">
              <div class="stat-box"><div class="stat-box__value">${formatNumber(pop.total_population)}</div><div class="stat-box__label">総人口</div></div>
              <div class="stat-box"><div class="stat-box__value">${formatNumber(pop.households)}</div><div class="stat-box__label">世帯数</div></div>
              <div class="stat-box"><div class="stat-box__value">${pop.age_30_45_pct || '—'}%</div><div class="stat-box__label">30〜45歳</div></div>
              <div class="stat-box"><div class="stat-box__value">${pop.elderly_pct || '—'}%</div><div class="stat-box__label">65歳以上</div></div>
            </div>
          </div>
        </div>`;
    }

    if (m.construction) {
      const con = m.construction;
      html += `
        <div class="result-card result-card--housing">
          <div class="result-card__header">
            <div class="result-card__icon">🏗️</div>
            <div><div class="result-card__title">② 建築着工統計</div><div class="result-card__subtitle">${escapeHtml(areaLabel)}</div></div>
          </div>
          <div class="result-card__body">
            <table class="data-table">
              <tr><th>持家 着工戸数</th><td><span class="highlight">${formatNumber(con.owner_occupied)}</span> 戸/年</td></tr>
              <tr><th>全体 着工戸数</th><td>${formatNumber(con.total)} 戸/年</td></tr>
              <tr><th>前年比</th><td>${con.yoy_change || '—'}</td></tr>
            </table>
          </div>
        </div>`;
    }

    if (m.housing) {
      const h = m.housing;
      html += `
        <div class="result-card result-card--housing">
          <div class="result-card__header">
            <div class="result-card__icon">🏡</div>
            <div><div class="result-card__title">③ 持ち家率・空き家率</div><div class="result-card__subtitle">${escapeHtml(areaLabel)}</div></div>
          </div>
          <div class="result-card__body">
            <div class="stat-grid">
              <div class="stat-box"><div class="stat-box__value">${h.ownership_rate || '—'}%</div><div class="stat-box__label">持ち家率</div></div>
              <div class="stat-box"><div class="stat-box__value">${h.vacancy_rate || '—'}%</div><div class="stat-box__label">空き家率</div></div>
              <div class="stat-box"><div class="stat-box__value">${h.rental_vacancy || '—'}%</div><div class="stat-box__label">貸家空室率</div></div>
            </div>
          </div>
        </div>`;
    }

    if (m.land_price) {
      const lp = m.land_price;
      html += `
        <div class="result-card result-card--land">
          <div class="result-card__header">
            <div class="result-card__icon">🗺️</div>
            <div><div class="result-card__title">④ 土地相場</div><div class="result-card__subtitle">${escapeHtml(areaLabel)}</div></div>
          </div>
          <div class="result-card__body">
            <table class="data-table">
              <tr><th>住宅地 平均坪単価</th><td><span class="highlight">${lp.residential_tsubo ? '¥' + formatNumber(lp.residential_tsubo) : '—'}</span></td></tr>
              <tr><th>住宅地 平均㎡単価</th><td>¥${formatNumber(lp.residential_sqm)}/㎡</td></tr>
              <tr><th>商業地 平均㎡単価</th><td>¥${formatNumber(lp.commercial_sqm)}/㎡</td></tr>
              <tr><th>前年比</th><td class="${(lp.yoy_change || '').includes('+') ? 'highlight--green' : 'highlight--rose'}">${lp.yoy_change || '—'}</td></tr>
            </table>
          </div>
        </div>`;
    }

    if (m.home_prices) {
      const hp = m.home_prices;
      html += `
        <div class="result-card result-card--market">
          <div class="result-card__header">
            <div class="result-card__icon">🏠</div>
            <div><div class="result-card__title">⑤ 新築住宅相場</div><div class="result-card__subtitle">${escapeHtml(areaLabel)}</div></div>
          </div>
          <div class="result-card__body">
            <table class="data-table">
              <tr><th>新築一戸建て 平均</th><td><span class="highlight">${hp.avg_price ? '¥' + formatNumber(hp.avg_price) + '万円' : '—'}</span></td></tr>
              <tr><th>価格帯</th><td>${hp.price_range || '—'}</td></tr>
              <tr><th>目安年収</th><td>${hp.required_income ? '¥' + formatNumber(hp.required_income) + '万円' : '—'}</td></tr>
            </table>
          </div>
        </div>`;
    }

    if (m.competition) {
      const comp = m.competition;
      html += `
        <div class="result-card result-card--competition">
          <div class="result-card__header">
            <div class="result-card__icon">🏢</div>
            <div><div class="result-card__title">⑥ 競合分析</div><div class="result-card__subtitle">${escapeHtml(areaLabel)}</div></div>
          </div>
          <div class="result-card__body">
            <div class="stat-grid">
              <div class="stat-box"><div class="stat-box__value">${comp.total_companies || '—'}</div><div class="stat-box__label">工務店・HM数</div></div>
              <div class="stat-box"><div class="stat-box__value">${comp.local_builders || '—'}</div><div class="stat-box__label">地場工務店</div></div>
            </div>
          </div>
        </div>`;
    }

    if (m.potential) {
      const pot = m.potential;
      html += `
        <div class="result-card result-card--potential">
          <div class="result-card__header">
            <div class="result-card__icon">🎯</div>
            <div><div class="result-card__title">潜在顧客数の試算</div><div class="result-card__subtitle">${escapeHtml(areaLabel)}｜AI推計</div></div>
          </div>
          <div class="result-card__body">
            <table class="data-table">
              <tr><th>30〜45歳 世帯数</th><td>${formatNumber(pot.target_households)} 世帯</td></tr>
              <tr><th>賃貸世帯数</th><td>${formatNumber(pot.rental_households)} 世帯</td></tr>
              <tr><th>年間持ち家転換推定</th><td><span class="highlight">${formatNumber(pot.annual_converts)} 世帯/年</span></td></tr>
              <tr><th>1社あたり年間獲得</th><td><span class="highlight--amber">${pot.per_company || '—'} 棟</span></td></tr>
            </table>
            ${pot.ai_insight ? `<div class="summary-box"><div class="summary-box__title">📌 AIからの提言</div><div class="summary-box__text">${escapeHtml(pot.ai_insight)}</div></div>` : ''}
          </div>
        </div>`;
    }
  }

  resultsContent.innerHTML = html;
}

// ---- PDF Export ----
async function exportPDF() {
  const element = document.getElementById('results-content');
  if (!element) return;

  const opt = {
    margin: [10, 10, 10, 10],
    filename: `不動産市場分析_${analysisData?.company?.name || 'report'}_${new Date().toISOString().slice(0,10)}.pdf`,
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
  document.querySelectorAll('.progress__step').forEach(s => {
    s.classList.remove('is-active', 'is-done');
  });
}

function hideProgress() { progressSection.classList.remove('is-active'); }

function activateStep(id) {
  const step = document.getElementById(id);
  if (step) { step.classList.add('is-active'); step.classList.remove('is-done'); }
}

function completeStep(id) {
  const step = document.getElementById(id);
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
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch { return false; }
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

function formatNumber(num) {
  if (num == null || num === '') return '—';
  return Number(num).toLocaleString('ja-JP');
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// Enter key
urlInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') startAnalysis();
});
