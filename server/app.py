"""
不動産市場把握AI - Flask Server
"""

import os
from dotenv import load_dotenv
from flask import Flask, request, jsonify
from flask_cors import CORS
from crawler import WebCrawler
from analyzer import BusinessAnalyzer
from market_data import MarketDataFetcher

# Load environment variables from .env
load_dotenv()

GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', '')
ESTAT_API_KEY = os.environ.get('ESTAT_API_KEY', '')

app = Flask(__name__)
CORS(app)


@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'ok',
        'version': '1.0.1',
        'ai_model': 'gemini-2.0-flash',
        'keys_configured': {
            'gemini': bool(GEMINI_API_KEY),
            'estat': bool(ESTAT_API_KEY)
        }
    })


@app.route('/api/crawl', methods=['POST'])
def crawl():
    """Crawl the given URL and extract text from all linked pages."""
    data = request.get_json()
    url = data.get('url', '')

    if not url:
        return jsonify({'error': 'URLが必要です'}), 400

    try:
        crawler = WebCrawler(max_pages=20, max_depth=2)
        pages = crawler.crawl(url)
        return jsonify({
            'pages': pages,
            'total_pages': len(pages),
            'root_url': url
        })
    except Exception as e:
        return jsonify({'error': f'クロール中にエラー: {str(e)}'}), 500


@app.route('/api/analyze', methods=['POST'])
def analyze():
    """Analyze the crawled content with AI to identify business details."""
    data = request.get_json()
    url = data.get('url', '')
    pages = data.get('pages', [])

    if not GEMINI_API_KEY:
        return jsonify({'error': 'Gemini APIキーが設定されていません。server/.env に GEMINI_API_KEY を設定してください。'}), 400

    if not pages:
        return jsonify({'error': 'ページデータが必要です'}), 400

    try:
        analyzer = BusinessAnalyzer(api_key=GEMINI_API_KEY)
        result = analyzer.analyze(url, pages)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': f'分析中にエラー: {str(e)}'}), 500


@app.route('/api/market-data', methods=['POST'])
def market_data():
    """Fetch market data for the given locations."""
    data = request.get_json()
    locations = data.get('locations', [])

    if not locations:
        return jsonify({'error': '所在地情報が必要です'}), 400

    try:
        fetcher = MarketDataFetcher(estat_key=ESTAT_API_KEY)
        results = []
        for loc in locations:
            area_data = fetcher.fetch_all(loc)
            results.append(area_data)
        return jsonify(results)
    except Exception as e:
        return jsonify({'error': f'市場データ取得エラー: {str(e)}'}), 500


if __name__ == '__main__':
    print("=" * 50)
    print("不動産市場把握AI Server v1.0.1")
    print(f"AI Model: Gemini 2.0 Flash")
    print(f"Gemini Key: {'✅ 設定済' if GEMINI_API_KEY else '❌ 未設定'}")
    print(f"e-Stat Key: {'✅ 設定済' if ESTAT_API_KEY else '⚠️ 未設定（任意）'}")
    print("=" * 50)
    app.run(debug=True, host='0.0.0.0', port=5000)
