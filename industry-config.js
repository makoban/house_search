// ========================================
// AIエリア分析 v4.0 — 業種マスタ + e-Statマッピング
// ========================================

// 全業種共通で取得するe-Statデータ
var COMMON_ESTAT = [
  { id: '0003448233', name: '人口・世帯', key: 'population' },
  { id: '0003455814', name: '事業所・企業', key: 'establishments' }
];

// 業種カテゴリ定義（20業種）
var INDUSTRY_CONFIG = {

  real_estate: {
    name: '不動産・建設',
    icon: '🏠',
    color: '#3b82f6',
    estatDataSets: [
      { id: '0003445078', name: '住宅・土地統計', key: 'housing' },
      { id: '0003427105', name: '建築着工統計', key: 'construction' }
    ],
    kpis: ['住宅着工件数', '空き家率', '地価動向', '世帯増減率'],
    marketJsonTemplate: {
      construction:  { total: 0, owner_occupied: 0, yoy_change: '+0.0%', year: '2024', source: '推計' },
      housing:       { ownership_rate: 0, vacancy_rate: 0, rental_vacancy: 0 },
      land_price:    { residential_sqm: 0, residential_tsubo: 0, commercial_sqm: 0, yoy_change: '+0.0%' },
      home_prices:   { avg_price: 0, price_range: '0〜0万円', required_income: 0 },
      competition:   { total_companies: 0, local_builders: 0 },
      potential:     { target_households: 0, rental_households: 0, annual_converts: 0, per_company: 0, ai_insight: '' }
    }
  },

  restaurant: {
    name: '飲食店・フード',
    icon: '🍽️',
    color: '#ef4444',
    estatDataSets: [
      { id: '0003348239', name: '家計調査（外食）', key: 'household_dining' }
    ],
    kpis: ['外食支出額', '飲食店密度', '人口あたり店舗数', '世帯消費傾向'],
    marketJsonTemplate: {
      dining_market:   { monthly_dining_spend: 0, annual_dining_spend: 0, food_spend_ratio: 0, source: '推計' },
      competition:     { restaurant_count: 0, per_10k_population: 0, chain_ratio_pct: 0 },
      consumer_profile:{ avg_household_income: 0, single_household_pct: 0, office_worker_density: 0 },
      potential:       { target_population: 0, daily_foot_traffic: 0, lunch_demand: 0, dinner_demand: 0, ai_insight: '' }
    }
  },

  retail: {
    name: '小売・物販',
    icon: '🛒',
    color: '#f59e0b',
    estatDataSets: [
      { id: '0003077684', name: '商業統計', key: 'commerce' },
      { id: '0003348239', name: '家計調査（消費）', key: 'household_spending' }
    ],
    kpis: ['商業販売額', '小売店数', '消費支出', '商圏人口'],
    marketJsonTemplate: {
      retail_market:     { annual_sales: 0, retail_store_count: 0, sales_per_store: 0, source: '推計' },
      consumer_spending: { monthly_consumption: 0, clothing_spend: 0, daily_goods_spend: 0 },
      competition:       { total_stores: 0, large_store_count: 0, ec_penetration_pct: 0 },
      potential:         { trade_area_population: 0, spending_power_index: 0, growth_rate: '+0.0%', ai_insight: '' }
    }
  },

  medical: {
    name: '医療・クリニック',
    icon: '🏥',
    color: '#10b981',
    estatDataSets: [
      { id: '0003411609', name: '医療施設調査', key: 'medical_facilities' }
    ],
    kpis: ['医療施設数', '高齢化率', '医師数', '人口あたり病床数'],
    marketJsonTemplate: {
      medical_market:  { hospital_count: 0, clinic_count: 0, beds_per_10k: 0, doctor_count: 0, source: '推計' },
      demographics:    { elderly_pct: 0, age_75_plus_pct: 0, health_insurance_payers: 0 },
      competition:     { total_clinics: 0, same_specialty: 0, new_openings_recent: 0 },
      potential:       { target_patients: 0, unmet_medical_need: '', growth_driver: '', ai_insight: '' }
    }
  },

  dental: {
    name: '歯科',
    icon: '🦷',
    color: '#06b6d4',
    estatDataSets: [
      { id: '0003411609', name: '医療施設調査', key: 'medical_facilities' }
    ],
    kpis: ['歯科診療所数', '人口比', '競合密度', '高齢者人口'],
    marketJsonTemplate: {
      dental_market:  { dental_clinic_count: 0, per_10k_population: 0, national_avg: 0, source: '推計' },
      demographics:   { child_pct: 0, elderly_pct: 0, avg_household_income: 0 },
      competition:    { total_dentists: 0, self_pay_ratio_pct: 0, new_openings_recent: 0 },
      potential:      { target_patients: 0, preventive_demand: '', cosmetic_demand: '', ai_insight: '' }
    }
  },

  beauty: {
    name: '美容・エステ・理容',
    icon: '💇',
    color: '#ec4899',
    estatDataSets: [
      { id: '0003186863', name: '衛生行政報告', key: 'beauty_salons' },
      { id: '0003348239', name: '家計調査（理美容）', key: 'household_beauty' }
    ],
    kpis: ['美容所数', '女性人口比', '理美容支出', '人口あたり店舗数'],
    marketJsonTemplate: {
      beauty_market:   { salon_count: 0, barber_count: 0, per_10k_population: 0, monthly_beauty_spend: 0, source: '推計' },
      demographics:    { female_pct: 0, age_20_40_female: 0, disposable_income: 0 },
      competition:     { total_salons: 0, chain_ratio_pct: 0, avg_price_cut: 0 },
      potential:       { target_customers: 0, repeat_rate_pct: 0, upsell_opportunity: '', ai_insight: '' }
    }
  },

  fitness: {
    name: 'フィットネス・スポーツ',
    icon: '💪',
    color: '#8b5cf6',
    estatDataSets: [],
    kpis: ['スポーツ施設数', '健康支出', 'フィットネス参加率', '20-50代人口'],
    marketJsonTemplate: {
      fitness_market:  { gym_count: 0, fitness_participation_pct: 0, monthly_health_spend: 0, source: '推計' },
      competition:     { total_facilities: 0, major_chains: 0, small_studios: 0 },
      potential:       { target_population: 0, penetration_rate_pct: 0, growth_trend: '', ai_insight: '' }
    }
  },

  education: {
    name: '教育・学習塾',
    icon: '📚',
    color: '#f97316',
    estatDataSets: [
      { id: '0003414862', name: '学校基本調査', key: 'schools' },
      { id: '0003348239', name: '家計調査（教育）', key: 'household_education' }
    ],
    kpis: ['年少人口', '学校数', '教育費支出', '通塾率'],
    marketJsonTemplate: {
      education_market: { school_count: 0, student_count: 0, juku_count: 0, monthly_edu_spend: 0, source: '推計' },
      demographics:     { child_0_14_pct: 0, child_count: 0, dual_income_pct: 0 },
      competition:      { total_juku: 0, major_chains: 0, per_student_ratio: 0 },
      potential:        { target_students: 0, juku_participation_pct: 0, growth_driver: '', ai_insight: '' }
    }
  },

  nursery: {
    name: '保育・介護',
    icon: '👶',
    color: '#14b8a6',
    estatDataSets: [
      { id: '0003396477', name: '介護サービス施設調査', key: 'care_facilities' }
    ],
    kpis: ['待機児童数', '高齢者人口', '介護施設数', '保育所数'],
    marketJsonTemplate: {
      care_market:    { nursery_count: 0, waiting_children: 0, care_facility_count: 0, elderly_population: 0, source: '推計' },
      demographics:   { child_0_5: 0, age_75_plus: 0, working_mothers_pct: 0 },
      competition:    { total_facilities: 0, private_ratio_pct: 0, occupancy_rate_pct: 0 },
      potential:      { target_users: 0, unmet_demand: '', subsidy_available: '', ai_insight: '' }
    }
  },

  it_service: {
    name: 'IT・Webサービス',
    icon: '💻',
    color: '#6366f1',
    estatDataSets: [],
    kpis: ['事業所数', '従業者数', '情報通信業', 'IT人材'],
    marketJsonTemplate: {
      it_market:     { it_company_count: 0, it_worker_count: 0, avg_salary: 0, source: '推計' },
      competition:   { total_it_companies: 0, startup_ratio_pct: 0, major_companies: 0 },
      potential:     { dx_demand_index: 0, talent_pool: 0, growth_rate: '+0.0%', ai_insight: '' }
    }
  },

  consulting: {
    name: 'コンサルティング・士業',
    icon: '📋',
    color: '#0ea5e9',
    estatDataSets: [],
    kpis: ['事業所数', '企業数', '開業率', '中小企業比率'],
    marketJsonTemplate: {
      consulting_market: { company_count: 0, professional_count: 0, avg_revenue: 0, source: '推計' },
      competition:       { total_firms: 0, solo_practitioner_pct: 0, specialties: '' },
      potential:         { target_companies: 0, sme_count: 0, startup_rate_pct: 0, ai_insight: '' }
    }
  },

  manufacturing: {
    name: '製造業',
    icon: '🏭',
    color: '#64748b',
    estatDataSets: [],
    kpis: ['製造品出荷額', '工場数', '従業者数', '生産性'],
    marketJsonTemplate: {
      manufacturing_market: { factory_count: 0, shipment_value: 0, worker_count: 0, source: '推計' },
      competition:          { total_factories: 0, large_factory_pct: 0, main_products: '' },
      potential:            { skilled_worker_pool: 0, land_cost_index: 0, logistics_score: 0, ai_insight: '' }
    }
  },

  logistics: {
    name: '物流・運輸',
    icon: '🚚',
    color: '#78716c',
    estatDataSets: [],
    kpis: ['貨物取扱量', '運輸事業所数', '倉庫数', '配送需要'],
    marketJsonTemplate: {
      logistics_market: { transport_companies: 0, warehouse_count: 0, cargo_volume: 0, source: '推計' },
      competition:      { total_companies: 0, last_mile_demand: 0 },
      potential:        { ec_growth_impact: '', industrial_zone_count: 0, ai_insight: '' }
    }
  },

  hotel: {
    name: '宿泊・観光',
    icon: '🏨',
    color: '#a855f7',
    estatDataSets: [
      { id: '0003427091', name: '宿泊旅行統計', key: 'tourism' }
    ],
    kpis: ['宿泊施設数', '観光客数', '宿泊費', '稼働率'],
    marketJsonTemplate: {
      hotel_market:  { hotel_count: 0, ryokan_count: 0, occupancy_rate_pct: 0, avg_room_rate: 0, source: '推計' },
      tourism:       { annual_visitors: 0, foreign_visitor_pct: 0, peak_season: '' },
      competition:   { total_facilities: 0, new_openings: 0, airbnb_count: 0 },
      potential:     { tourist_growth_rate: '+0.0%', inbound_opportunity: '', event_demand: '', ai_insight: '' }
    }
  },

  wedding: {
    name: 'ブライダル・冠婚葬祭',
    icon: '💒',
    color: '#f472b6',
    estatDataSets: [],
    kpis: ['婚姻件数', '式場数', '平均婚姻年齢', '挙式費用'],
    marketJsonTemplate: {
      wedding_market: { marriage_count: 0, venue_count: 0, avg_cost: 0, source: '推計' },
      demographics:   { marriageable_population: 0, marriage_rate: 0, avg_age_marriage: 0 },
      potential:      { target_couples: 0, ceremony_rate_pct: 0, photo_wedding_trend: '', ai_insight: '' }
    }
  },

  automotive: {
    name: '自動車・カーサービス',
    icon: '🚗',
    color: '#334155',
    estatDataSets: [],
    kpis: ['自動車保有台数', '整備工場数', '販売台数', 'EV普及率'],
    marketJsonTemplate: {
      auto_market:  { car_ownership: 0, per_household: 0, new_car_sales: 0, source: '推計' },
      competition:  { dealer_count: 0, repair_shop_count: 0, used_car_dealers: 0 },
      potential:    { ev_adoption_pct: 0, car_wash_demand: 0, inspection_demand: 0, ai_insight: '' }
    }
  },

  insurance: {
    name: '保険・金融',
    icon: '🏦',
    color: '#059669',
    estatDataSets: [],
    kpis: ['世帯年収', '保険支出', '金融機関数', '貯蓄率'],
    marketJsonTemplate: {
      finance_market: { bank_count: 0, insurance_agency_count: 0, avg_household_income: 0, source: '推計' },
      demographics:   { high_income_household_pct: 0, savings_rate_pct: 0, loan_holders_pct: 0 },
      potential:      { target_households: 0, insurance_penetration_pct: 0, wealth_management_demand: '', ai_insight: '' }
    }
  },

  agriculture: {
    name: '農業・一次産業',
    icon: '🌾',
    color: '#65a30d',
    estatDataSets: [],
    kpis: ['農業産出額', '経営体数', '農地面積', '就農者数'],
    marketJsonTemplate: {
      agri_market:  { farm_count: 0, output_value: 0, farmland_ha: 0, source: '推計' },
      demographics: { farmer_avg_age: 0, new_farmers: 0, corp_farm_pct: 0 },
      potential:    { organic_demand: '', direct_sales_trend: '', agritech_opportunity: '', ai_insight: '' }
    }
  },

  advertising: {
    name: '広告・マーケティング',
    icon: '📢',
    color: '#e11d48',
    estatDataSets: [],
    kpis: ['事業所数', '情報通信業売上', '広告支出', 'デジタル化率'],
    marketJsonTemplate: {
      ad_market:   { agency_count: 0, market_size: 0, digital_ratio_pct: 0, source: '推計' },
      competition: { total_agencies: 0, freelancer_pct: 0, specialties: '' },
      potential:   { sme_digital_demand: 0, ec_support_demand: '', sns_marketing_trend: '', ai_insight: '' }
    }
  },

  other: {
    name: 'その他・汎用',
    icon: '🏢',
    color: '#6b7280',
    estatDataSets: [],
    kpis: ['人口', '世帯数', '事業所数', '商圏人口'],
    marketJsonTemplate: {
      general_market: { business_count: 0, worker_count: 0, avg_income: 0, source: '推計' },
      competition:    { similar_businesses: 0, market_saturation: '' },
      potential:      { target_population: 0, growth_trend: '', ai_insight: '' }
    }
  }
};

// 業種カテゴリIDリスト（AIプロンプト用）
var INDUSTRY_LIST_FOR_PROMPT = Object.keys(INDUSTRY_CONFIG).map(function(id) {
  var c = INDUSTRY_CONFIG[id];
  return id + ' : ' + c.icon + ' ' + c.name;
}).join('\n');
