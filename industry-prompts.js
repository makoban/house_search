// ========================================
// AIエリア分析 v4.0 — 業種別プロンプトテンプレート
// ========================================

var INDUSTRY_PROMPTS = {

  // ---- 不動産・建設 ----
  real_estate: {
    market: function(analysis, estatData, area) {
      var company = analysis.company || {};
      var pref = area.prefecture || '不明';
      var city = area.city || '';

      var estatInfo = '';
      if (estatData.population && estatData.population.from_estat) {
        estatInfo += '\n\n【参考: e-Stat政府統計データ】\n' +
          '・総人口: ' + formatNumber(estatData.population.total_population) + '人\n' +
          '・世帯数: ' + formatNumber(estatData.population.households) + '世帯\n' +
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
        '  "population": { "total_population": 0, "households": 0, "age_30_45_pct": 0, "elderly_pct": 0, "source": "" },\n' +
        '  "construction": { "total": 0, "owner_occupied": 0, "yoy_change": "+0.0%", "year": "2024", "source": "推計" },\n' +
        '  "housing": { "ownership_rate": 0, "vacancy_rate": 0, "rental_vacancy": 0 },\n' +
        '  "land_price": { "residential_sqm": 0, "residential_tsubo": 0, "commercial_sqm": 0, "yoy_change": "+0.0%" },\n' +
        '  "home_prices": { "avg_price": 0, "price_range": "0〜0万円", "required_income": 0 },\n' +
        '  "competition": { "total_companies": 0, "local_builders": 0 },\n' +
        '  "potential": { "target_households": 0, "rental_households": 0, "annual_converts": 0, "per_company": 0, "ai_insight": "" }\n' +
        '}';
    },
    crossArea: function(analysis, marketsData) {
      return '以下は同一企業の複数事業所がある各エリアの不動産市場データです。経営層向けに分析してください。\n\n' +
        JSON.stringify(marketsData, null, 2) + '\n\n' +
        '以下のJSON形式で回答してください:\n' +
        '{\n' +
        '  "opportunity_ranking": [{"rank":1,"area":"エリア名","reason":"理由(50字以内)","score":85},...],\n' +
        '  "strategic_summary": "全体の戦略的要約(200字以内)",\n' +
        '  "sales_advice": "営業チームへのアドバイス(200字以内)",\n' +
        '  "risk_areas": "リスクのあるエリアと理由(100字以内)",\n' +
        '  "growth_areas": "成長が見込めるエリアと理由(100字以内)"\n' +
        '}';
    }
  },

  // ---- 飲食店・フード ----
  restaurant: {
    market: function(analysis, estatData, area) {
      var company = analysis.company || {};
      var pref = area.prefecture || '不明';
      var city = area.city || '';
      var estatInfo = buildEstatInfoText(estatData);

      return 'あなたは日本の飲食業界・商圏分析の専門家です。\n' +
        '以下の地域の飲食業市場データを推定・提供してください。\n\n' +
        '対象エリア: ' + pref + ' ' + city + '\n' +
        '企業の事業: ' + (company.business_type || '不明') + '\n' +
        '主力サービス: ' + (company.main_services || '不明') + '\n' +
        estatInfo + '\n\n' +
        '以下のJSON形式で回答してください。マークダウンのコードブロックで囲まず、純粋JSONのみ返してください:\n' +
        '{\n' +
        '  "area_name": "' + pref + ' ' + city + '",\n' +
        '  "population": { "total_population": 0, "households": 0, "age_30_45_pct": 0, "elderly_pct": 0, "source": "" },\n' +
        '  "dining_market": { "monthly_dining_spend": 0, "annual_dining_spend": 0, "food_spend_ratio": 0, "source": "推計" },\n' +
        '  "competition": { "restaurant_count": 0, "per_10k_population": 0, "chain_ratio_pct": 0 },\n' +
        '  "consumer_profile": { "avg_household_income": 0, "single_household_pct": 0, "office_worker_density": 0 },\n' +
        '  "potential": { "target_population": 0, "daily_foot_traffic": 0, "lunch_demand": 0, "dinner_demand": 0, "ai_insight": "このエリアでの出店戦略に関する提言(200字)" }\n' +
        '}';
    },
    crossArea: function(analysis, marketsData) {
      return '以下は飲食企業の各エリアの商圏データです。経営層向けに出店戦略を分析してください。\n\n' +
        JSON.stringify(marketsData, null, 2) + '\n\n' +
        buildCrossAreaJsonFormat();
    }
  },

  // ---- 小売・物販 ----
  retail: {
    market: function(analysis, estatData, area) {
      var company = analysis.company || {};
      var pref = area.prefecture || '不明';
      var city = area.city || '';
      var estatInfo = buildEstatInfoText(estatData);

      return 'あなたは日本の小売・流通業界の市場分析専門家です。\n' +
        '以下の地域の小売市場データを推定・提供してください。\n\n' +
        '対象エリア: ' + pref + ' ' + city + '\n' +
        '企業の事業: ' + (company.business_type || '不明') + '\n' +
        '主力サービス: ' + (company.main_services || '不明') + '\n' +
        estatInfo + '\n\n' +
        '以下のJSON形式で回答してください。マークダウンのコードブロックで囲まず、純粋JSONのみ返してください:\n' +
        '{\n' +
        '  "area_name": "' + pref + ' ' + city + '",\n' +
        '  "population": { "total_population": 0, "households": 0, "age_30_45_pct": 0, "elderly_pct": 0, "source": "" },\n' +
        '  "retail_market": { "annual_sales": 0, "retail_store_count": 0, "sales_per_store": 0, "source": "推計" },\n' +
        '  "consumer_spending": { "monthly_consumption": 0, "clothing_spend": 0, "daily_goods_spend": 0 },\n' +
        '  "competition": { "total_stores": 0, "large_store_count": 0, "ec_penetration_pct": 0 },\n' +
        '  "potential": { "trade_area_population": 0, "spending_power_index": 0, "growth_rate": "+0.0%", "ai_insight": "このエリアでの出店・販売戦略に関する提言(200字)" }\n' +
        '}';
    },
    crossArea: function(analysis, marketsData) {
      return '以下は小売企業の各エリアの商圏データです。経営層向けに出店戦略を分析してください。\n\n' +
        JSON.stringify(marketsData, null, 2) + '\n\n' +
        buildCrossAreaJsonFormat();
    }
  },

  // ---- 医療・クリニック ----
  medical: {
    market: function(analysis, estatData, area) {
      var company = analysis.company || {};
      var pref = area.prefecture || '不明';
      var city = area.city || '';
      var estatInfo = buildEstatInfoText(estatData);

      return 'あなたは日本の医療業界・クリニック開業支援の専門家です。\n' +
        '以下の地域の医療市場データを推定・提供してください。\n\n' +
        '対象エリア: ' + pref + ' ' + city + '\n' +
        '企業の事業: ' + (company.business_type || '不明') + '\n' +
        '主力サービス: ' + (company.main_services || '不明') + '\n' +
        estatInfo + '\n\n' +
        '以下のJSON形式で回答してください。マークダウンのコードブロックで囲まず、純粋JSONのみ返してください:\n' +
        '{\n' +
        '  "area_name": "' + pref + ' ' + city + '",\n' +
        '  "population": { "total_population": 0, "households": 0, "age_30_45_pct": 0, "elderly_pct": 0, "source": "" },\n' +
        '  "medical_market": { "hospital_count": 0, "clinic_count": 0, "beds_per_10k": 0, "doctor_count": 0, "source": "推計" },\n' +
        '  "demographics": { "elderly_pct": 0, "age_75_plus_pct": 0, "health_insurance_payers": 0 },\n' +
        '  "competition": { "total_clinics": 0, "same_specialty": 0, "new_openings_recent": 0 },\n' +
        '  "potential": { "target_patients": 0, "unmet_medical_need": "", "growth_driver": "", "ai_insight": "このエリアでの開業・経営戦略に関する提言(200字)" }\n' +
        '}';
    },
    crossArea: function(analysis, marketsData) {
      return '以下は医療機関の各エリアの市場データです。経営層向けに開業・拡張戦略を分析してください。\n\n' +
        JSON.stringify(marketsData, null, 2) + '\n\n' +
        buildCrossAreaJsonFormat();
    }
  },

  // ---- 美容・エステ ----
  beauty: {
    market: function(analysis, estatData, area) {
      var company = analysis.company || {};
      var pref = area.prefecture || '不明';
      var city = area.city || '';
      var estatInfo = buildEstatInfoText(estatData);

      return 'あなたは日本の美容・エステ業界の市場分析専門家です。\n' +
        '以下の地域の美容市場データを推定・提供してください。\n\n' +
        '対象エリア: ' + pref + ' ' + city + '\n' +
        '企業の事業: ' + (company.business_type || '不明') + '\n' +
        '主力サービス: ' + (company.main_services || '不明') + '\n' +
        estatInfo + '\n\n' +
        '以下のJSON形式で回答してください。マークダウンのコードブロックで囲まず、純粋JSONのみ返してください:\n' +
        '{\n' +
        '  "area_name": "' + pref + ' ' + city + '",\n' +
        '  "population": { "total_population": 0, "households": 0, "age_30_45_pct": 0, "elderly_pct": 0, "source": "" },\n' +
        '  "beauty_market": { "salon_count": 0, "barber_count": 0, "per_10k_population": 0, "monthly_beauty_spend": 0, "source": "推計" },\n' +
        '  "demographics": { "female_pct": 0, "age_20_40_female": 0, "disposable_income": 0 },\n' +
        '  "competition": { "total_salons": 0, "chain_ratio_pct": 0, "avg_price_cut": 0 },\n' +
        '  "potential": { "target_customers": 0, "repeat_rate_pct": 0, "upsell_opportunity": "", "ai_insight": "このエリアでのサロン経営戦略に関する提言(200字)" }\n' +
        '}';
    },
    crossArea: function(analysis, marketsData) {
      return '以下は美容サロンの各エリアの市場データです。経営層向けに出店・拡張戦略を分析してください。\n\n' +
        JSON.stringify(marketsData, null, 2) + '\n\n' +
        buildCrossAreaJsonFormat();
    }
  }
};

// ---- ヘルパー関数 ----

// e-Statデータ情報テキストを生成
function buildEstatInfoText(estatData) {
  if (!estatData || !estatData.population) return '';
  var pop = estatData.population;
  if (!pop.from_estat) return '';
  var text = '\n\n【参考: e-Stat政府統計データ】\n' +
    '・総人口: ' + formatNumber(pop.total_population) + '人\n' +
    '・世帯数: ' + formatNumber(pop.households) + '世帯\n';
  // 業種別追加データがあれば表示
  for (var key in estatData) {
    if (key === 'population') continue;
    var d = estatData[key];
    if (d && typeof d === 'object') {
      text += '・' + key + ': データあり\n';
    }
  }
  text += 'これらの実データを基準にして、他の項目も整合性のある値を推定してください。\n';
  return text;
}

// 横断分析用JSON形式
function buildCrossAreaJsonFormat() {
  return '以下のJSON形式で回答してください:\n' +
    '{\n' +
    '  "opportunity_ranking": [{"rank":1,"area":"エリア名","reason":"理由(50字以内)","score":85},...],\n' +
    '  "strategic_summary": "全体の戦略的要約(200字以内)",\n' +
    '  "sales_advice": "営業チームへのアドバイス(200字以内)",\n' +
    '  "risk_areas": "リスクのあるエリアと理由(100字以内)",\n' +
    '  "growth_areas": "成長が見込めるエリアと理由(100字以内)"\n' +
    '}';
}

// 未定義業種 → 汎用プロンプト生成
function getIndustryPrompt(industryId) {
  if (INDUSTRY_PROMPTS[industryId]) {
    return INDUSTRY_PROMPTS[industryId];
  }
  // 汎用フォールバック
  var config = INDUSTRY_CONFIG[industryId] || INDUSTRY_CONFIG['other'];
  return {
    market: function(analysis, estatData, area) {
      var company = analysis.company || {};
      var pref = area.prefecture || '不明';
      var city = area.city || '';
      var estatInfo = buildEstatInfoText(estatData);
      var templateJson = JSON.stringify(
        Object.assign({ area_name: pref + ' ' + city, population: { total_population: 0, households: 0, age_30_45_pct: 0, elderly_pct: 0, source: '' } }, config.marketJsonTemplate),
        null, 2
      );

      return 'あなたは日本の' + config.name + '業界の市場分析専門家です。\n' +
        '以下の地域の' + config.name + '市場データを推定・提供してください。\n\n' +
        '対象エリア: ' + pref + ' ' + city + '\n' +
        '企業の事業: ' + (company.business_type || '不明') + '\n' +
        '主力サービス: ' + (company.main_services || '不明') + '\n' +
        estatInfo + '\n\n' +
        '重要KPI: ' + config.kpis.join(', ') + '\n' +
        'できる限り正確な数値を提供してください。不明な場合は合理的な推計値を提供してください。\n\n' +
        '以下のJSON形式で回答してください。マークダウンのコードブロックで囲まず、純粋JSONのみ返してください:\n' +
        templateJson;
    },
    crossArea: function(analysis, marketsData) {
      return '以下は' + config.name + '企業の各エリアの市場データです。経営層向けに戦略を分析してください。\n\n' +
        JSON.stringify(marketsData, null, 2) + '\n\n' +
        buildCrossAreaJsonFormat();
    }
  };
}
