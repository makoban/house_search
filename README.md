# 不動産市場把握AI

企業URLを入力するだけで、AIがWebサイトを解析し、商圏の市場データと潜在顧客を自動レポートするサービス。

## 機能

- 🌐 **HP全ページ解析** — リンク先も含めAIが事業内容を分析
- 📊 **商圏データ自動取得** — 人口・着工統計・相場・競合を6つのオープンデータソースから収集
- 🎯 **潜在顧客試算** — 商圏の潜在新築顧客数をAIが推計
- 📄 **PDFレポート出力** — 分析結果をワンクリックでPDF出力

## データソース

| # | データソース | 内容 |
|---|---|---|
| ① | 国交省 建築着工統計 | 市区町村別 新築着工戸数 |
| ② | 国勢調査・RESAS | 人口、年齢構成、世帯数 |
| ③ | 住宅・土地統計調査 | 持ち家率、空き家率 |
| ④ | 公示地価・基準地価 | 土地相場（坪単価） |
| ⑤ | SUUMO/HOME'S | 新築住宅価格相場 |
| ⑥ | SUUMO/HOME'S | 競合工務店数 |

## セットアップ

### バックエンド（Python）

```bash
cd server
pip install -r requirements.txt
```

### 環境変数

```bash
# 必須
export OPENAI_API_KEY=sk-your-key-here

# オプション（より詳細なデータ取得）
export RESAS_API_KEY=your-resas-key
export ESTAT_API_KEY=your-estat-key
```

### 起動

```bash
cd server
python app.py
```

フロントエンドは `index.html` をブラウザで開くか、Live Serverで起動してください。

## 技術スタック

- **Frontend**: HTML / CSS / JavaScript（html2pdf.js）
- **Backend**: Python Flask
- **AI**: OpenAI GPT-4o
- **Data**: e-Stat API, RESAS API, Web Scraping

## ライセンス

MIT
