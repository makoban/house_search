"""
不動産市場把握AI - Business Analyzer
Uses OpenAI GPT to analyze crawled website content and extract business details.
"""

import json
from openai import OpenAI


class BusinessAnalyzer:
    def __init__(self, api_key=''):
        self.client = OpenAI(api_key=api_key) if api_key else None

    def analyze(self, url, pages):
        """Analyze crawled pages to extract business information."""
        # Combine all page text
        combined_text = self._combine_pages(pages)

        if not self.client:
            # Fallback: basic text analysis without AI
            return self._basic_analysis(url, pages, combined_text)

        return self._ai_analysis(url, combined_text)

    def _combine_pages(self, pages):
        """Combine text from all crawled pages."""
        parts = []
        for page in pages:
            title = page.get('title', '')
            text = page.get('text', '')
            parts.append(f"=== {title} ===\n{text}")
        combined = '\n\n'.join(parts)
        # Truncate to fit within token limits
        return combined[:15000]

    def _ai_analysis(self, url, combined_text):
        """Use OpenAI to analyze business content."""
        prompt = f"""以下は企業Webサイト（{url}）からクロールしたテキストです。
この企業について詳細に分析して、以下のJSON形式で回答してください。

**重要**: 必ず有効なJSONのみを返してください。マークダウンや説明文は不要です。

{{
  "company": {{
    "name": "企業名",
    "address": "所在地（都道府県 市区町村まで）",
    "business_type": "業種（例: 工務店、不動産仲介、ハウスメーカー等）",
    "main_services": "主力サービスの概要",
    "is_real_estate": true/false,
    "strengths": "この企業の強み・特徴（3-5つ）",
    "weaknesses": "改善の余地がある点（3つ程度）",
    "keywords": ["関連キーワード1", "関連キーワード2", "..."],
    "target_audience": "ターゲット顧客層"
  }},
  "locations": [
    {{
      "prefecture": "都道府県",
      "city": "市区町村",
      "type": "本社/支店/営業所"
    }}
  ],
  "location": {{
    "prefecture": "メイン所在地の都道府県",
    "city": "メイン所在地の市区町村"
  }}
}}

--- 企業サイトのテキスト ---
{combined_text}
"""

        try:
            response = self.client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {
                        "role": "system",
                        "content": "あなたは日本の企業・不動産市場に精通した経営コンサルタントです。"
                                   "Webサイトの内容から企業の事業内容を正確に分析します。"
                                   "回答は必ず有効なJSON形式のみで返してください。"
                    },
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
                max_tokens=2000
            )

            content = response.choices[0].message.content.strip()
            # Remove markdown code block if present
            if content.startswith('```'):
                content = content.split('\n', 1)[1] if '\n' in content else content[3:]
                if content.endswith('```'):
                    content = content[:-3]
                content = content.strip()

            result = json.loads(content)
            return result

        except json.JSONDecodeError as e:
            print(f"[Analyzer] JSON parse error: {e}")
            print(f"[Analyzer] Raw content: {content[:500]}")
            return self._basic_analysis(url, [], combined_text)
        except Exception as e:
            print(f"[Analyzer] OpenAI API error: {e}")
            return self._basic_analysis(url, [], combined_text)

    def _basic_analysis(self, url, pages, combined_text):
        """Fallback analysis without AI - extract what we can from text."""
        from urllib.parse import urlparse

        domain = urlparse(url).netloc
        name = domain.replace('www.', '').split('.')[0]

        # Try to find company name from page titles
        company_name = name
        for page in pages:
            title = page.get('title', '')
            if title and len(title) > 2:
                # Common patterns: "会社名 | ..." or "会社名 - ..."
                parts = title.split('|')
                if len(parts) == 1:
                    parts = title.split('-')
                if len(parts) == 1:
                    parts = title.split('–')
                company_name = parts[-1].strip() if len(parts) > 1 else parts[0].strip()
                break

        # Detect if real estate related
        real_estate_keywords = [
            '工務店', '不動産', '住宅', 'ハウス', '建築', '建設',
            '注文住宅', '新築', 'リフォーム', 'リノベーション',
            'マンション', '賃貸', '分譲', '土地', '仲介'
        ]
        is_real_estate = any(kw in combined_text for kw in real_estate_keywords)

        # Detect location
        import re
        prefecture_pattern = r'(北海道|青森県|岩手県|宮城県|秋田県|山形県|福島県|茨城県|栃木県|群馬県|埼玉県|千葉県|東京都|神奈川県|新潟県|富山県|石川県|福井県|山梨県|長野県|岐阜県|静岡県|愛知県|三重県|滋賀県|京都府|大阪府|兵庫県|奈良県|和歌山県|鳥取県|島根県|岡山県|広島県|山口県|徳島県|香川県|愛媛県|高知県|福岡県|佐賀県|長崎県|熊本県|大分県|宮崎県|鹿児島県|沖縄県)'
        city_pattern = r'(.{1,4}[市区町村])'

        prefecture_match = re.search(prefecture_pattern, combined_text)
        city_match = re.search(city_pattern, combined_text[prefecture_match.start():] if prefecture_match else combined_text)

        prefecture = prefecture_match.group(1) if prefecture_match else '不明'
        city = city_match.group(1) if city_match else '不明'

        return {
            "company": {
                "name": company_name,
                "address": f"{prefecture} {city}",
                "business_type": "建築・不動産関連" if is_real_estate else "一般企業",
                "main_services": "Webサイトから自動検出（AI分析には OPENAI_API_KEY が必要です）",
                "is_real_estate": is_real_estate,
                "strengths": "AI分析にはAPIキーが必要です",
                "weaknesses": "AI分析にはAPIキーが必要です",
                "keywords": [],
                "target_audience": "不明"
            },
            "locations": [{
                "prefecture": prefecture,
                "city": city,
                "type": "本社"
            }],
            "location": {
                "prefecture": prefecture,
                "city": city
            }
        }
