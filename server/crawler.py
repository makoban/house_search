"""
不動産市場把握AI - Web Crawler
Crawls a given URL and all internal links (same domain) up to a depth limit.
"""

import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
import re
import time


class WebCrawler:
    def __init__(self, max_pages=20, max_depth=2, timeout=15):
        self.max_pages = max_pages
        self.max_depth = max_depth
        self.timeout = timeout
        self.visited = set()
        self.pages = []
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                          'AppleWebKit/537.36 (KHTML, like Gecko) '
                          'Chrome/120.0.0.0 Safari/537.36'
        })

    def crawl(self, start_url):
        """Crawl starting from the given URL."""
        parsed = urlparse(start_url)
        self.base_domain = parsed.netloc
        self._crawl_page(start_url, depth=0)
        return self.pages

    def _crawl_page(self, url, depth):
        """Recursively crawl a page and its internal links."""
        if len(self.pages) >= self.max_pages:
            return
        if depth > self.max_depth:
            return

        # Normalize URL
        url = self._normalize_url(url)
        if url in self.visited:
            return
        self.visited.add(url)

        # Skip non-HTML resources
        if self._is_non_html(url):
            return

        try:
            resp = self.session.get(url, timeout=self.timeout, allow_redirects=True)
            content_type = resp.headers.get('Content-Type', '')
            if 'text/html' not in content_type:
                return

            resp.encoding = resp.apparent_encoding or 'utf-8'
            soup = BeautifulSoup(resp.text, 'html.parser')

            # Extract text content
            text = self._extract_text(soup)
            title = soup.title.string.strip() if soup.title and soup.title.string else ''

            # Store page data
            self.pages.append({
                'url': url,
                'title': title,
                'text': text[:5000],  # Limit per page
                'depth': depth
            })

            # Find and crawl internal links
            if depth < self.max_depth:
                links = self._extract_internal_links(soup, url)
                for link in links:
                    if len(self.pages) >= self.max_pages:
                        break
                    time.sleep(0.3)  # Polite delay
                    self._crawl_page(link, depth + 1)

        except requests.RequestException as e:
            print(f"[Crawler] Error fetching {url}: {e}")
        except Exception as e:
            print(f"[Crawler] Parse error for {url}: {e}")

    def _extract_text(self, soup):
        """Extract meaningful text content from HTML."""
        # Remove scripts, styles, and nav elements
        for tag in soup.find_all(['script', 'style', 'nav', 'footer', 'noscript', 'iframe']):
            tag.decompose()

        # Get text and clean it
        text = soup.get_text(separator='\n')
        lines = [line.strip() for line in text.splitlines()]
        lines = [line for line in lines if len(line) > 2]
        return '\n'.join(lines)

    def _extract_internal_links(self, soup, current_url):
        """Extract internal links from the page."""
        links = []
        for a_tag in soup.find_all('a', href=True):
            href = a_tag['href']
            full_url = urljoin(current_url, href)
            parsed = urlparse(full_url)

            # Only follow same-domain links
            if parsed.netloc == self.base_domain:
                clean_url = self._normalize_url(full_url)
                if clean_url not in self.visited and not self._is_non_html(clean_url):
                    links.append(clean_url)
        return links

    def _normalize_url(self, url):
        """Normalize a URL by removing fragments and trailing slashes."""
        parsed = urlparse(url)
        # Remove fragment
        normalized = parsed._replace(fragment='')
        url = normalized.geturl()
        # Remove trailing slash (except root)
        if url.endswith('/') and url.count('/') > 3:
            url = url.rstrip('/')
        return url

    def _is_non_html(self, url):
        """Check if URL points to a non-HTML resource."""
        non_html_extensions = [
            '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp',
            '.mp4', '.mp3', '.zip', '.doc', '.docx', '.xls', '.xlsx',
            '.css', '.js', '.ico', '.woff', '.woff2', '.ttf', '.eot'
        ]
        lower = url.lower()
        return any(lower.endswith(ext) for ext in non_html_extensions)
