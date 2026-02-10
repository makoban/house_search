// ========================================
// 不動産市場把握AI - Frontend Application
// ========================================

const API_BASE = 'http://localhost:5000/api';

// ---- State ----
let analysisData = null;

// ---- DOM References ----
const urlInput = document.getElementById('url-input');
const analyzeBtn = document.getElementById('analyze-btn');
const errorMsg = document.getElementById('error-msg');
const progressSection = document.getElementById('progress-section');
const resultsSection = document.getElementById('results-section');
const resultsContent = document.getElementById('results-content');

// ---- Main Analysis Flow ----
async function startAnalysis() {
  const url = urlInput.value.trim();

  // Validate URL
  if (!url) {
    showError('URLを入力してください');
    return;
  }

  if (!isValidUrl(url)) {
    showError('有効なURLを入力してください（例: https://example.co.jp）');
    return;
  }

  // Reset & show progress
  hideError();
  hideResults();
  showProgress();
  setLoading(true);

  try {
    // Step 1: Crawl
    activateStep('step-crawl');
    const crawlData = await apiCall('/crawl', { url });
    completeStep('step-crawl');

    // Step 2: AI Analysis
    activateStep('step-analyze');
    const analysis = await apiCall('/analyze', {
      url,
      pages: crawlData.pages
    });
    completeStep('step-analyze');

    // Step 3: Location Detection
    activateStep('step-location');
    const locations = analysis.locations || [analysis.location];
    completeStep('step-location');

    // Step 4: Market Data
    activateStep('step-market');
    const marketData = await apiCall('/market-data', {
      locations: locations
    });
    completeStep('step-market');

    // Step 5: Generate Report
    activateStep('step-report');
    await sleep(500);

    analysisData = {
      url,
      company: analysis.company,
      locations,
      marketData,
      timestamp: new Date().toISOString()
    };

    renderResults(analysisData);
    completeStep('step-report');

    // Show results
    await sleep(300);
    hideProgress();
    showResults();

  } catch (err) {
    console.error('Analysis error:', err);
    showError(`分析中にエラーが発生しました: ${err.message}`);
    hideProgress();
  } finally {
    setLoading(false);
  }
}

// ---- API Call ----
async function apiCall(endpoint, data) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `API Error: ${res.status}`);
  }

  return res.json();
}

// ---- Render Results ----
function renderResults(data) {
  const { company, marketData } = data;
  let html = '';

  // ---- Company Analysis Card ----
  html += `
    <div class="result-card result-card--company">
      <div class="result-card__header">
        <div class="result-card__icon">🏢</div>
        <div>
          <div class="result-card__title">${escapeHtml(company.name || '企業分析')}</div>
          <div class="result-card__subtitle">AIによる事業内容分析</div>
        </div>
      </div>
      <div class="result-card__body">
        <table class="data-table">
          <tr><th>企業名</th><td>${escapeHtml(company.name || '取得中...')}</td></tr>
          <tr><th>所在地</th><td>${escapeHtml(company.address || '不明')}</td></tr>
          <tr><th>事業内容</th><td>${escapeHtml(company.business_type || '不明')}</td></tr>
          <tr><th>主力サービス</th><td>${escapeHtml(company.main_services || '不明')}</td></tr>
          <tr><th>不動産事業</th><td>${company.is_real_estate ? '<span class="highlight--green">✅ 該当</span>' : '❌ 非該当'}</td></tr>
        </table>
        ${company.strengths ? `
        <div class="summary-box" style="margin-top:16px">
          <div class="summary-box__title">💪 強み・特徴</div>
          <div class="summary-box__text">${escapeHtml(company.strengths)}</div>
        </div>` : ''}
        ${company.weaknesses ? `
        <div class="summary-box" style="margin-top:12px; background: linear-gradient(135deg, rgba(244,63,94,0.1), rgba(249,115,22,0.1)); border-color: rgba(244,63,94,0.2);">
          <div class="summary-box__title" style="color:var(--accent-rose)">⚠️ 改善余地</div>
          <div class="summary-box__text">${escapeHtml(company.weaknesses)}</div>
        </div>` : ''}
        ${company.keywords ? `
        <div class="tag-list" style="margin-top:16px">
          ${company.keywords.map(k => `<span class="tag">${escapeHtml(k)}</span>`).join('')}
        </div>` : ''}
      </div>
    </div>
  `;

  // ---- Market Data Cards (per location) ----
  if (marketData && marketData.length > 0) {
    marketData.forEach((loc, i) => {
      const areaLabel = loc.area_name || `エリア ${i + 1}`;

      // ① Population & Demographics
      if (loc.population) {
        const pop = loc.population;
        html += `
          <div class="result-card result-card--population">
            <div class="result-card__header">
              <div class="result-card__icon">👥</div>
              <div>
                <div class="result-card__title">① 人口・世帯データ</div>
                <div class="result-card__subtitle">${escapeHtml(areaLabel)}｜国勢調査・住民基本台帳</div>
              </div>
            </div>
            <div class="result-card__body">
              <div class="stat-grid">
                <div class="stat-box">
                  <div class="stat-box__value">${formatNumber(pop.total_population)}</div>
                  <div class="stat-box__label">総人口</div>
                </div>
                <div class="stat-box">
                  <div class="stat-box__value">${formatNumber(pop.households)}</div>
                  <div class="stat-box__label">世帯数</div>
                </div>
                <div class="stat-box">
                  <div class="stat-box__value">${pop.age_30_45_pct || '—'}%</div>
                  <div class="stat-box__label">30〜45歳</div>
                </div>
                <div class="stat-box">
                  <div class="stat-box__value">${pop.elderly_pct || '—'}%</div>
                  <div class="stat-box__label">65歳以上</div>
                </div>
              </div>
            </div>
          </div>
        `;
      }

      // ② Construction Starts
      if (loc.construction) {
        const con = loc.construction;
        html += `
          <div class="result-card result-card--housing">
            <div class="result-card__header">
              <div class="result-card__icon">🏗️</div>
              <div>
                <div class="result-card__title">② 建築着工統計</div>
                <div class="result-card__subtitle">${escapeHtml(areaLabel)}｜国交省建築動態統計</div>
              </div>
            </div>
            <div class="result-card__body">
              <table class="data-table">
                <tr><th>持家 着工戸数</th><td><span class="highlight">${formatNumber(con.owner_occupied)}</span> 戸/年</td></tr>
                <tr><th>全体 着工戸数</th><td>${formatNumber(con.total)} 戸/年</td></tr>
                <tr><th>前年比</th><td>${con.yoy_change || '—'}</td></tr>
                <tr><th>データ年度</th><td>${con.year || '—'}</td></tr>
              </table>
            </div>
          </div>
        `;
      }

      // ③ Homeownership / Vacancy
      if (loc.housing) {
        const housing = loc.housing;
        html += `
          <div class="result-card result-card--housing">
            <div class="result-card__header">
              <div class="result-card__icon">🏡</div>
              <div>
                <div class="result-card__title">③ 持ち家率・空き家率</div>
                <div class="result-card__subtitle">${escapeHtml(areaLabel)}｜住宅・土地統計調査</div>
              </div>
            </div>
            <div class="result-card__body">
              <div class="stat-grid">
                <div class="stat-box">
                  <div class="stat-box__value">${housing.ownership_rate || '—'}%</div>
                  <div class="stat-box__label">持ち家率</div>
                </div>
                <div class="stat-box">
                  <div class="stat-box__value">${housing.vacancy_rate || '—'}%</div>
                  <div class="stat-box__label">空き家率</div>
                </div>
                <div class="stat-box">
                  <div class="stat-box__value">${housing.rental_vacancy || '—'}%</div>
                  <div class="stat-box__label">貸家空室率</div>
                </div>
              </div>
            </div>
          </div>
        `;
      }

      // ④ Land Prices
      if (loc.land_price) {
        const land = loc.land_price;
        html += `
          <div class="result-card result-card--land">
            <div class="result-card__header">
              <div class="result-card__icon">🗺️</div>
              <div>
                <div class="result-card__title">④ 土地相場</div>
                <div class="result-card__subtitle">${escapeHtml(areaLabel)}｜公示地価・基準地価</div>
              </div>
            </div>
            <div class="result-card__body">
              <table class="data-table">
                <tr><th>住宅地 平均坪単価</th><td><span class="highlight">${land.residential_tsubo ? '¥' + formatNumber(land.residential_tsubo) : '—'}</span></td></tr>
                <tr><th>住宅地 平均㎡単価</th><td>¥${formatNumber(land.residential_sqm)}/㎡</td></tr>
                <tr><th>商業地 平均㎡単価</th><td>¥${formatNumber(land.commercial_sqm)}/㎡</td></tr>
                <tr><th>前年比</th><td class="${(land.yoy_change || '').includes('+') ? 'highlight--green' : 'highlight--rose'}">${land.yoy_change || '—'}</td></tr>
              </table>
            </div>
          </div>
        `;
      }

      // ⑤ New Home Prices
      if (loc.home_prices) {
        const home = loc.home_prices;
        html += `
          <div class="result-card result-card--market">
            <div class="result-card__header">
              <div class="result-card__icon">🏠</div>
              <div>
                <div class="result-card__title">⑤ 新築住宅相場</div>
                <div class="result-card__subtitle">${escapeHtml(areaLabel)}｜不動産ポータル</div>
              </div>
            </div>
            <div class="result-card__body">
              <table class="data-table">
                <tr><th>新築一戸建て 平均</th><td><span class="highlight">${home.avg_price ? '¥' + formatNumber(home.avg_price) + '万円' : '—'}</span></td></tr>
                <tr><th>価格帯</th><td>${home.price_range || '—'}</td></tr>
                <tr><th>目安年収</th><td>${home.required_income ? '¥' + formatNumber(home.required_income) + '万円' : '—'}</td></tr>
              </table>
            </div>
          </div>
        `;
      }

      // ⑥ Competition
      if (loc.competition) {
        const comp = loc.competition;
        html += `
          <div class="result-card result-card--competition">
            <div class="result-card__header">
              <div class="result-card__icon">🏢</div>
              <div>
                <div class="result-card__title">⑥ 競合分析</div>
                <div class="result-card__subtitle">${escapeHtml(areaLabel)}｜SUUMO/HOME'S</div>
              </div>
            </div>
            <div class="result-card__body">
              <div class="stat-grid">
                <div class="stat-box">
                  <div class="stat-box__value">${comp.total_companies || '—'}</div>
                  <div class="stat-box__label">工務店・HM数</div>
                </div>
                <div class="stat-box">
                  <div class="stat-box__value">${comp.local_builders || '—'}</div>
                  <div class="stat-box__label">地場工務店</div>
                </div>
              </div>
            </div>
          </div>
        `;
      }

      // Potential Customers Calculation
      if (loc.potential) {
        const pot = loc.potential;
        html += `
          <div class="result-card result-card--potential">
            <div class="result-card__header">
              <div class="result-card__icon">🎯</div>
              <div>
                <div class="result-card__title">潜在顧客数の試算</div>
                <div class="result-card__subtitle">${escapeHtml(areaLabel)}｜AI推計</div>
              </div>
            </div>
            <div class="result-card__body">
              <table class="data-table">
                <tr><th>30〜45歳 世帯数</th><td>${formatNumber(pot.target_households)} 世帯</td></tr>
                <tr><th>賃貸世帯数</th><td>${formatNumber(pot.rental_households)} 世帯</td></tr>
                <tr><th>年間持ち家転換推定</th><td><span class="highlight">${formatNumber(pot.annual_converts)} 世帯/年</span></td></tr>
                <tr><th>1社あたり年間獲得</th><td><span class="highlight--amber">${pot.per_company || '—'} 棟</span></td></tr>
              </table>
              <div class="summary-box">
                <div class="summary-box__title">📌 AIからの提言</div>
                <div class="summary-box__text">${escapeHtml(pot.ai_insight || '')}</div>
              </div>
            </div>
          </div>
        `;
      }
    });
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
    html2canvas: {
      scale: 2,
      useCORS: true,
      backgroundColor: '#111827'
    },
    jsPDF: {
      unit: 'mm',
      format: 'a4',
      orientation: 'portrait'
    }
  };

  // Temporarily adjust styles for PDF
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
  // Reset all steps
  document.querySelectorAll('.progress__step').forEach(s => {
    s.classList.remove('is-active', 'is-done');
  });
}

function hideProgress() {
  progressSection.classList.remove('is-active');
}

function activateStep(id) {
  const step = document.getElementById(id);
  if (step) {
    step.classList.add('is-active');
    step.classList.remove('is-done');
  }
}

function completeStep(id) {
  const step = document.getElementById(id);
  if (step) {
    step.classList.remove('is-active');
    step.classList.add('is-done');
  }
}

function showResults() {
  resultsSection.classList.add('is-active');
  resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function hideResults() {
  resultsSection.classList.remove('is-active');
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.add('is-active');
}

function hideError() {
  errorMsg.classList.remove('is-active');
}

// ---- Utility ----
function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---- Enter key handler ----
urlInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') startAnalysis();
});
