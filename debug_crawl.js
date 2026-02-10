// デバッグ: crawlSiteの動作をシミュレーション
const url = 'https://lifedesign-kabaya.co.jp/';
const CORS_PROXY = 'https://api.allorigins.win/raw?url=';
const IMPORTANT_PATH_KEYWORDS = [
  'company', 'about', 'corporate', 'profile', 'access', 'overview',
  'summary', 'gaiyou', 'kaisya', 'info', 'office',
  '会社概要', '会社案内', '企業情報', '事業所', 'greeting'
];

async function fetchPage(u) {
  try {
    const proxyUrl = CORS_PROXY + encodeURIComponent(u);
    const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } catch (e) {
    console.log('  FETCH ERROR:', u, e.message);
    return null;
  }
}

function extractLinks(html, baseUrl) {
  const linkRegex = /<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const links = [];
  const seen = {};
  let base;
  try { base = new URL(baseUrl); } catch(e) { return []; }

  let m;
  while ((m = linkRegex.exec(html)) !== null) {
    try {
      const href = m[1];
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
      const resolved = new URL(href, baseUrl);
      if (resolved.hostname !== base.hostname) continue;
      const path = resolved.pathname.toLowerCase();
      if (/\.(jpg|jpeg|png|gif|svg|pdf|zip|doc|mp4|mp3)$/i.test(path)) continue;
      const key = resolved.origin + resolved.pathname;
      if (seen[key]) continue;
      seen[key] = true;
      const text = m[2].replace(/<[^>]+>/g, '').trim();
      links.push({ url: key, path: path, text: text.slice(0, 50) });
    } catch(e) { /* ignore */ }
  }
  return links;
}

function scoreLink(link) {
  let score = 0;
  for (const kw of IMPORTANT_PATH_KEYWORDS) {
    if (link.path.indexOf(kw) >= 0) score += 10;
    if (link.text.indexOf(kw) >= 0) score += 5;
  }
  if (link.text.indexOf('会社概要') >= 0 || link.text.indexOf('会社案内') >= 0) score += 20;
  if (link.text.indexOf('企業情報') >= 0 || link.text.indexOf('事業所') >= 0) score += 15;
  if (link.text.indexOf('アクセス') >= 0 || link.text.indexOf('所在地') >= 0) score += 15;
  if (link.text.indexOf('代表挨拶') >= 0 || link.text.indexOf('社長') >= 0) score += 8;
  if (link.text.indexOf('事業内容') >= 0 || link.text.indexOf('サービス') >= 0) score += 10;
  if (link.text.indexOf('店舗') >= 0 || link.text.indexOf('支店') >= 0) score += 10;
  if (link.text.indexOf('施工事例') >= 0 || link.text.indexOf('実績') >= 0) score += 5;
  return score;
}

function extractAddressesFromHtml(html) {
  const plainText = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  const regex = /〒(\d{3}-?\d{4})\s*([^〒]{5,120})/g;
  const results = [];
  const seen = {};
  let m;

  while ((m = regex.exec(plainText)) !== null) {
    const zip = m[1].trim();
    if (seen[zip]) continue;
    seen[zip] = true;

    let rawAddr = m[2].trim();
    const addrMatch = rawAddr.match(/^(.+?)(?:\s*(?:TEL|FAX|tel|fax|電話))/i);
    let address = addrMatch ? addrMatch[1].trim() : rawAddr;
    address = address.replace(/\s+/g, ' ').replace(/[\n\r]/g, '').trim();
    if (address.length < 5 || address.length > 100) continue;
    if (!address.match(/[都道府県市区町村郡]/)) continue;

    results.push({ zip: '〒' + zip, address });
  }
  return results;
}

async function main() {
  console.log('=== Step 1: トップページ取得 ===');
  const topHtml = await fetchPage(url);
  if (!topHtml) { console.log('FAILED'); return; }
  console.log('  HTML取得OK:', topHtml.length, 'bytes');

  // トップページから住所抽出
  const topAddrs = extractAddressesFromHtml(topHtml);
  console.log('  トップページの住所:', topAddrs.length, '件');
  topAddrs.forEach(a => console.log('    ', a.zip, a.address));

  console.log('\n=== Step 2: リンク抽出 ===');
  const links = extractLinks(topHtml, url);
  console.log('  内部リンク:', links.length, '件');

  console.log('\n=== Step 3: スコアリング ===');
  const scored = links.map(l => ({ ...l, score: scoreLink(l) }))
    .filter(l => l.score > 0 && l.url !== url && l.url !== url.replace(/\/$/, ''))
    .sort((a, b) => b.score - a.score);

  console.log('  スコア付きリンク:', scored.length, '件');
  scored.slice(0, 10).forEach((l, i) => {
    console.log('   ', i+1, ')', l.score, '点 |', l.text, '|', l.url);
  });

  console.log('\n=== Step 4: サブページ取得 & 住所抽出 ===');
  const allHtml = [topHtml];
  const max = Math.min(scored.length, 5);
  for (let i = 0; i < max; i++) {
    const sl = scored[i];
    console.log('  [', i+1, '/', max, ']', sl.text, '-', sl.url);
    const html = await fetchPage(sl.url);
    if (html) {
      allHtml.push(html);
      const addrs = extractAddressesFromHtml(html);
      console.log('    → 取得OK', html.length, 'bytes, 住所:', addrs.length, '件');
      addrs.forEach(a => console.log('      ', a.zip, a.address));
    } else {
      console.log('    → 取得FAILED');
    }
  }

  console.log('\n=== 最終結果: 全HTML統合 ===');
  const combined = allHtml.join('\n');
  const allAddrs = extractAddressesFromHtml(combined);
  console.log('  合計住所:', allAddrs.length, '件');
  allAddrs.forEach((a, i) => console.log('   ', i+1, ')', a.zip, a.address));
}

main().catch(e => console.error(e));
