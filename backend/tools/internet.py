import requests
from bs4 import BeautifulSoup
import urllib.parse
import logging

logger = logging.getLogger("friday.tools.internet")

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

def web_search(query: str, num_results: int = 5) -> str:
    """Searches the internet for the query and returns the results. 
    It first attempts Google Search, falling back to DuckDuckGo if blocked by CAPTCHAs.
    """
    logger.info(f"Searching web for: {query}")
    results = []
    
    # 1. Attempt Google Search
    try:
        url = f"https://www.google.com/search?q={urllib.parse.quote(query)}"
        headers = {"User-Agent": USER_AGENT}
        resp = requests.get(url, headers=headers, timeout=5)
        if resp.status_code == 200:
            soup = BeautifulSoup(resp.text, 'html.parser')
            # Google search result cards
            cards = soup.find_all('div', class_='g')
            for g in cards:
                if len(results) >= num_results:
                    break
                anchors = g.find_all('a')
                if anchors:
                    link = anchors[0].get('href', '')
                    title = g.find('h3')
                    snippet = g.find('div', class_='VwiC3b')
                    
                    if link and title and link.startswith('http'):
                        results.append({
                            "title": title.text.strip(),
                            "link": link,
                            "snippet": snippet.text.strip() if snippet else ""
                        })
            
            if results:
                logger.info(f"Google Search returned {len(results)} results.")
                return format_search_results(results)
    except Exception as e:
        logger.warning(f"Google Search failed: {e}. Trying fallback...")

    # 2. Fallback to DuckDuckGo HTML Search
    try:
        results = []
        url = f"https://html.duckduckgo.com/html/?q={urllib.parse.quote(query)}"
        headers = {"User-Agent": USER_AGENT}
        resp = requests.get(url, headers=headers, timeout=5)
        if resp.status_code == 200:
            soup = BeautifulSoup(resp.text, 'html.parser')
            cards = soup.find_all('div', class_='result__body')
            for card in cards:
                if len(results) >= num_results:
                    break
                a = card.find('a', class_='result__url')
                snippet = card.find('a', class_='result__snippet')
                
                if a and a.get('href'):
                    # DDG urls are often redirected, let's parse them or use direct href
                    href = a.get('href')
                    if href.startswith('//duckduckgo.com/y.js'):
                        # Parse actual URL from redirects if needed, but DDG HTML usually has direct links
                        continue
                    results.append({
                        "title": a.text.strip(),
                        "link": href,
                        "snippet": snippet.text.strip() if snippet else ""
                    })
            
            if results:
                logger.info(f"DuckDuckGo Search returned {len(results)} results.")
                return format_search_results(results)
    except Exception as e:
        logger.error(f"DuckDuckGo Search fallback failed: {e}")
        
    return "No search results found. It seems I couldn't reach search servers right now."

def format_search_results(results: list[dict]) -> str:
    output = []
    for idx, r in enumerate(results, 1):
        output.append(f"[{idx}] Source: {r['title']}\nLink: {r['link']}\nSnippet: {r['snippet']}\n")
    return "\n".join(output)

def fetch_page(url: str) -> str:
    """Fetches the main text content of a webpage and returns the first 1200 words."""
    logger.info(f"Fetching page content from: {url}")
    try:
        headers = {"User-Agent": USER_AGENT}
        resp = requests.get(url, headers=headers, timeout=6)
        if resp.status_code != 200:
            return f"Failed to fetch webpage. Server returned status code {resp.status_code}"
            
        soup = BeautifulSoup(resp.text, 'html.parser')
        
        # Remove noisy tags
        for element in soup(["script", "style", "nav", "footer", "header", "form"]):
            element.decompose()
            
        # Get text and clean up whitespace
        text = soup.get_text(separator=' ')
        lines = (line.strip() for line in text.splitlines())
        chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
        clean_text = '\n'.join(chunk for chunk in chunks if chunk)
        
        # Word limit to fit LLM window
        words = clean_text.split()
        if len(words) > 1200:
            clean_text = ' '.join(words[:1200]) + "\n... [Content Truncated]"
            
        return clean_text if clean_text.strip() else "Webpage loaded, but no readable text content was found."
    except Exception as e:
        logger.error(f"Error fetching webpage: {e}")
        return f"Error trying to fetch webpage: {str(e)}"
