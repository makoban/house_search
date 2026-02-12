"""
HeartRails Geo API から全市区町村データを取得し、
area-database.js を自動生成するスクリプト
"""
import json, urllib.request, urllib.parse, time, os

PREFECTURES = [
    ('北海道','01'),('青森県','02'),('岩手県','03'),('宮城県','04'),('秋田県','05'),
    ('山形県','06'),('福島県','07'),('茨城県','08'),('栃木県','09'),('群馬県','10'),
    ('埼玉県','11'),('千葉県','12'),('東京都','13'),('神奈川県','14'),('新潟県','15'),
    ('富山県','16'),('石川県','17'),('福井県','18'),('山梨県','19'),('長野県','20'),
    ('岐阜県','21'),('静岡県','22'),('愛知県','23'),('三重県','24'),('滋賀県','25'),
    ('京都府','26'),('大阪府','27'),('兵庫県','28'),('奈良県','29'),('和歌山県','30'),
    ('鳥取県','31'),('島根県','32'),('岡山県','33'),('広島県','34'),('山口県','35'),
    ('徳島県','36'),('香川県','37'),('愛媛県','38'),('高知県','39'),('福岡県','40'),
    ('佐賀県','41'),('長崎県','42'),('熊本県','43'),('大分県','44'),('宮崎県','45'),
    ('鹿児島県','46'),('沖縄県','47')
]

def fetch_cities(pref_name):
    url = 'https://geoapi.heartrails.com/api/json?method=getCities&prefecture=' + urllib.parse.quote(pref_name)
    resp = urllib.request.urlopen(url, timeout=15)
    data = json.loads(resp.read().decode('utf-8'))
    cities = []
    if data.get('response') and data['response'].get('location'):
        for loc in data['response']['location']:
            cities.append(loc['city'])
    return sorted(set(cities))

def main():
    print('🔍 HeartRails APIから全市区町村を取得中...')
    all_data = {}
    for name, code in PREFECTURES:
        print(f'  {name}...', end='', flush=True)
        cities = fetch_cities(name)
        all_data[code] = {'name': name, 'cities': cities}
        print(f' {len(cities)}件')
        time.sleep(0.3)

    total = sum(len(v['cities']) for v in all_data.values())
    print(f'\n✅ 合計 {total} 市区町村')

    # JS生成
    lines = []
    lines.append('// ========================================')
    lines.append('// 不動産市場把握AI v4.3 - 地名データベース')
    lines.append(f'// 全国{total}市区町村マスタ（自動生成）')
    lines.append('// ========================================')
    lines.append('')
    lines.append('var AREA_DATABASE = [];')
    lines.append('')
    lines.append('function _addPref(n,c){AREA_DATABASE.push({name:n,prefecture:n,city:"",prefCode:c,fullLabel:n,type:"prefecture"});}')
    lines.append('var _P={' + ','.join(f"'{n}':'{c}'" for n,c in PREFECTURES) + '};')
    lines.append('function _addCity(p,c){var pc=_P[p]||"00";AREA_DATABASE.push({name:c,prefecture:p,city:c,prefCode:pc,fullLabel:p+c,type:"city"});}')
    lines.append('')

    # Prefectures
    lines.append('(function(){')
    entries = ','.join(f"['{n}','{c}']" for n,c in PREFECTURES)
    lines.append(f'[{entries}].forEach(function(p){{_addPref(p[0],p[1]);}});')
    lines.append('})();')
    lines.append('')

    # Cities
    lines.append('(function(){')
    for code in sorted(all_data.keys()):
        info = all_data[code]
        pref = info['name']
        for city in info['cities']:
            city_escaped = city.replace("'", "\\'")
            lines.append(f"_addCity('{pref}','{city_escaped}');")
    lines.append('})();')
    lines.append('')

    # searchArea
    lines.append("""function searchArea(input){
if(!input)return[];var q=input.trim(),results=[];
AREA_DATABASE.forEach(function(a){if(a.fullLabel===q||a.name===q||a.city===q)results.push(a);});
if(results.length===0)AREA_DATABASE.forEach(function(a){if(a.fullLabel.indexOf(q)===0||a.name.indexOf(q)===0)results.push(a);});
if(results.length===0)AREA_DATABASE.forEach(function(a){if(a.fullLabel.indexOf(q)>=0||a.name.indexOf(q)>=0)results.push(a);});
var seen={},unique=[];
results.forEach(function(r){if(!seen[r.fullLabel]){seen[r.fullLabel]=true;unique.push(r);}});
return unique;
}""")

    out = os.path.join(os.path.dirname(__file__), 'area-database.js')
    with open(out, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print(f'✅ area-database.js 生成完了 ({os.path.getsize(out):,} bytes)')

if __name__ == '__main__':
    main()
