import { NextResponse } from 'next/server';

const BENZINGA_API_KEY = process.env.BENZINGA_API_KEY;
const BZ_NEWS_URL = 'https://api.benzinga.com/api/v2/news';

// Common company name to ticker mapping (for better search results)
const COMPANY_TO_TICKER: Record<string, string> = {
  'newmont': 'NEM',
  'newmont corporation': 'NEM',
  'unity': 'U',
  'unity software': 'U',
  'unity technologies': 'U',
  'take-two': 'TTWO',
  'take two': 'TTWO',
  'take-two interactive': 'TTWO',
  'take two interactive': 'TTWO',
  '2k games': 'TTWO',
  'rockstar games': 'TTWO',
  'apple': 'AAPL',
  'microsoft': 'MSFT',
  'google': 'GOOGL',
  'amazon': 'AMZN',
  'meta': 'META',
  'tesla': 'TSLA',
  'nvidia': 'NVDA',
  'nvidia corporation': 'NVDA',
  'jpmorgan': 'JPM',
  'bank of america': 'BAC',
  'goldman sachs': 'GS',
  'morgan stanley': 'MS',
  'visa': 'V',
  'mastercard': 'MA',
  'disney': 'DIS',
  'netflix': 'NFLX',
  'salesforce': 'CRM',
  'oracle': 'ORCL',
  'intel': 'INTC',
  'amd': 'AMD',
  'qualcomm': 'QCOM',
  'broadcom': 'AVGO',
  'paypal': 'PYPL',
  'adobe': 'ADBE',
  'cisco': 'CSCO',
  'ibm': 'IBM',
  'verizon': 'VZ',
  'att': 'T',
  'at&t': 'T',
  'comcast': 'CMCSA',
  'walmart': 'WMT',
  'home depot': 'HD',
  'costco': 'COST',
  'target': 'TGT',
  'starbucks': 'SBUX',
  'mcdonalds': 'MCD',
  'coca cola': 'KO',
  'pepsico': 'PEP',
  'procter gamble': 'PG',
  'johnson johnson': 'JNJ',
  'pfizer': 'PFE',
  'merck': 'MRK',
  'unitedhealth': 'UNH',
  'exxon': 'XOM',
  'chevron': 'CVX',
  'boeing': 'BA',
  'lockheed': 'LMT',
  'raytheon': 'RTX',
  'ge': 'GE',
  'general electric': 'GE',
  'ford': 'F',
  'gm': 'GM',
  'general motors': 'GM',
  'fiat chrysler': 'STLA',
  'stellantis': 'STLA',
};

// Extract ticker from custom prompt
function extractTicker(customPrompt: string): string | null {
  // Pattern 1: "(TICKER)" or "(NASDAQ:TICKER)" or "(NYSE:TICKER)"
  const exchangePattern = /\((?:NASDAQ|NYSE|AMEX|OTC|Nasdaq|NYSE):([A-Z]{1,5})\)/i;
  const match1 = customPrompt.match(exchangePattern);
  if (match1) {
    return match1[1].toUpperCase();
  }
  
  // Pattern 2: "(TICKER)" - ticker in parentheses alone
  const parenPattern = /\(([A-Z]{1,5})\)/;
  const match2 = customPrompt.match(parenPattern);
  if (match2) {
    const potentialTicker = match2[1].toUpperCase();
    const invalidTickers = ['THE', 'AND', 'FOR', 'ARE', 'WAS', 'HAS', 'HAD', 'WILL', 'THIS', 'THAT', 'INC', 'CORP', 'LLC', 'LTD', 'STOCK', 'SHARES'];
    if (!invalidTickers.includes(potentialTicker) && potentialTicker.length >= 2 && potentialTicker.length <= 5) {
      return potentialTicker;
    }
  }
  
  // Pattern 3: Standalone uppercase 2-5 letter words (likely tickers)
  const standalonePattern = /\b([A-Z]{2,5})\b/g;
  const matches = customPrompt.match(standalonePattern);
  if (matches) {
    const invalidTickers = ['THE', 'AND', 'FOR', 'ARE', 'WAS', 'HAS', 'HAD', 'WILL', 'THIS', 'THAT', 'INC', 'CORP', 'LLC', 'LTD', 'STOCK', 'SHARES', 'DOWN', 'UP', 'NEW', 'OLD', 'ALL', 'BUT', 'NOT', 'YOU', 'CAN', 'HER', 'ONE', 'OUR', 'OUT', 'DAY', 'GET', 'HIM', 'HIS', 'HOW', 'ITS', 'MAY', 'NOW', 'SEE', 'TWO', 'WAY', 'WHO', 'BOY', 'DID', 'LET', 'PUT', 'SAY', 'SHE', 'TOO', 'USE', 'VIA', 'YET'];
    for (const match of matches) {
      if (!invalidTickers.includes(match) && match.length >= 2 && match.length <= 5) {
        return match;
      }
    }
  }
  
  return null;
}

// Extract company names from custom prompt (can be multiple)
function extractCompanyNames(customPrompt: string): string[] {
  const companyNames: string[] = [];
  
  // Pattern 1: "Company1 and Company2 stock" or "Company1, Company2 stock"
  const multiCompanyPattern = /(\w+(?:\s+\w+)?(?:\s+and\s+|\s*,\s*)\w+(?:\s+\w+)?)\s+stock/i;
  const multiMatch = customPrompt.match(multiCompanyPattern);
  if (multiMatch && multiMatch[1]) {
    const companies = multiMatch[1].split(/\s+and\s+|\s*,\s*/).map(c => c.trim());
    companies.forEach(company => {
      if (company.length >= 2 && !company.match(/^(the|a|an|is|are|stock|stocks)$/i)) {
        companyNames.push(company);
      }
    });
  }
  
  // Pattern 2: "CompanyName stock" or "CompanyName shares" or "CompanyName is"
  if (companyNames.length === 0) {
    const companyPatterns = [
      /(\w+(?:\s+\w+)?)\s+stock\s+(?:is|are)/i,
      /(\w+(?:\s+\w+)?)\s+shares\s+(?:is|are)/i,
      /(\w+(?:\s+\w+)?)\s+is\s+(?:down|up|crashing|soaring)/i,
    ];
    
    for (const pattern of companyPatterns) {
      const match = customPrompt.match(pattern);
      if (match && match[1]) {
        const companyName = match[1].trim();
        // Filter out common words
        const invalidNames = ['the', 'a', 'an', 'this', 'that', 'these', 'those'];
        if (companyName.length >= 3 && !invalidNames.includes(companyName.toLowerCase())) {
          companyNames.push(companyName);
          break; // Found one, stop
        }
      }
    }
  }
  
  return companyNames;
}

// Extract keywords from custom prompt for searching
function extractKeywords(customPrompt: string, excludeTicker?: string | null): string[] {
  // Remove common stop words and extract meaningful terms
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how', 'about', 'into', 'through', 'during', 'including', 'against', 'among', 'throughout', 'despite', 'towards', 'upon', 'concerning', 'stock', 'stocks', 'shares', 'share', 'down', 'up', 'because', 'crashing', 'soaring', 'falling', 'rising']);
  
  // Extract words (3+ characters, alphanumeric)
  let words = customPrompt
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length >= 3 && !stopWords.has(word));
  
  // Remove ticker if it was extracted
  if (excludeTicker) {
    words = words.filter(word => word !== excludeTicker.toLowerCase());
  }
  
  // Remove duplicates and return top keywords
  const uniqueWords = Array.from(new Set(words));
  return uniqueWords.slice(0, 10); // Return top 10 keywords
}

// Search Benzinga articles by ticker and keywords
async function searchBenzingaArticles(ticker: string | null, companyNames: string[], keywords: string[], offset: number = 0, limit: number = 5, allTickers: string[] = []): Promise<any[]> {
  try {
    if (!BENZINGA_API_KEY) {
      return [];
    }

    // Fetch articles from last 30 days
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - 30);
    const dateFromStr = dateFrom.toISOString().slice(0, 10);

    // If we have a ticker, search by ticker first (more targeted)
    // If no ticker but we have company name, try to search with company name as keyword
    let url: string;
    if (ticker) {
      // Search by ticker - this will give us more relevant results
      const items = Math.max((offset + limit) * 2, 50);
      url = `${BZ_NEWS_URL}?token=${BENZINGA_API_KEY}&tickers=${encodeURIComponent(ticker)}&items=${items}&fields=headline,title,created,url,channels,teaser,body&accept=application/json&displayOutput=full&dateFrom=${dateFromStr}`;
      console.log(`[QUICK STORY SEARCH] Searching by ticker: ${ticker}`);
    } else if (companyNames.length > 0) {
      // No ticker but we have company names - search all articles but fetch more
      const items = Math.max((offset + limit) * 10, 100);
      url = `${BZ_NEWS_URL}?token=${BENZINGA_API_KEY}&items=${items}&fields=headline,title,created,url,channels,teaser,body&accept=application/json&displayOutput=full&dateFrom=${dateFromStr}`;
      console.log(`[QUICK STORY SEARCH] Searching all articles (no ticker), looking for companies: ${companyNames.join(', ')}, keywords: ${keywords.join(', ')}`);
    } else {
      // No ticker or company names - search all articles
      const items = Math.max((offset + limit) * 10, 100);
      url = `${BZ_NEWS_URL}?token=${BENZINGA_API_KEY}&items=${items}&fields=headline,title,created,url,channels,teaser,body&accept=application/json&displayOutput=full&dateFrom=${dateFromStr}`;
      console.log(`[QUICK STORY SEARCH] Searching all articles (no ticker/company), keywords: ${keywords.join(', ')}`);
    }

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      console.error('[QUICK STORY SEARCH] Failed to fetch articles:', response.status);
      return [];
    }

    const data = await response.json();
    
    console.log(`[QUICK STORY SEARCH] Fetched ${Array.isArray(data) ? data.length : 0} articles from Benzinga API`);
    
    if (!Array.isArray(data)) {
      console.warn('[QUICK STORY SEARCH] API returned non-array response');
      return [];
    }
    
    if (data.length === 0) {
      console.warn('[QUICK STORY SEARCH] No articles returned from API');
      return [];
    }

    // Filter out press releases and insights/opinion articles
    const prChannelNames = ['press releases', 'press-releases', 'pressrelease', 'pr'];
    const normalize = (str: string) => str.toLowerCase().replace(/[-_]/g, ' ');

    let filteredArticles = data.filter(item => {
      // Exclude press releases
      if (Array.isArray(item.channels) && item.channels.some((ch: any) => 
        typeof ch.name === 'string' && prChannelNames.includes(normalize(ch.name))
      )) {
        return false;
      }
      
      // Exclude insights and opinion articles
      if (item.url && (
        item.url.includes('/insights/') || 
        item.url.includes('/Opinion/')
      )) {
        return false;
      }
      
      return true;
    });

    // Score articles by ticker, company name, and keyword matches
    const scoredArticles = filteredArticles.map(article => {
      const searchText = `${article.headline || ''} ${article.title || ''} ${article.teaser || ''} ${article.body || ''}`.toLowerCase();
      let score = 0;
      
      // High priority: Ticker matches (check all tickers, not just primary)
      const tickersToCheck = allTickers.length > 0 ? allTickers : (ticker ? [ticker] : []);
      tickersToCheck.forEach(t => {
        const tickerLower = t.toLowerCase();
        if (article.headline && article.headline.toLowerCase().includes(tickerLower)) {
          score += 50; // Very high weight for ticker in headline
        } else if (searchText.includes(tickerLower)) {
          score += 20; // High weight for ticker anywhere
        }
      });
      
      // High priority: Company name matches (can be multiple)
      companyNames.forEach(companyName => {
        const companyNameLower = companyName.toLowerCase();
        const companyWords = companyNameLower.split(/\s+/).filter(w => w.length >= 2);
        
        // Check for full company name match (case-insensitive)
        const headlineLower = (article.headline || '').toLowerCase();
        const titleLower = (article.title || '').toLowerCase();
        
        if (headlineLower.includes(companyNameLower)) {
          score += 40; // Very high weight for company name in headline
        } else if (titleLower.includes(companyNameLower)) {
          score += 30; // High weight for company name in title
        } else if (searchText.includes(companyNameLower)) {
          score += 15; // High weight for company name anywhere
        } else {
          // Partial match - check if individual words match
          let partialMatches = 0;
          companyWords.forEach(word => {
            if (word.length >= 2) {
              if (headlineLower.includes(word)) {
                partialMatches += 2; // More weight for headline matches
              } else if (searchText.includes(word)) {
                partialMatches += 1;
              }
            }
          });
          if (partialMatches > 0 && companyWords.length > 1) {
            // Only give partial credit if we matched multiple words
            score += Math.min(partialMatches * 2, 10); // Cap partial match bonus
          }
        }
      });
      
      // Medium priority: Keyword matches
      keywords.forEach(keyword => {
        const keywordLower = keyword.toLowerCase();
        // Count occurrences in headline (weighted more)
        if (article.headline) {
          const headlineMatches = (article.headline.toLowerCase().match(new RegExp(keywordLower, 'g')) || []).length;
          score += headlineMatches * 5; // Increased weight
        }
        // Count occurrences in title
        if (article.title) {
          const titleMatches = (article.title.toLowerCase().match(new RegExp(keywordLower, 'g')) || []).length;
          score += titleMatches * 3; // Increased weight
        }
        // Count occurrences in teaser/body
        const textMatches = (searchText.match(new RegExp(keywordLower, 'g')) || []).length;
        score += textMatches;
      });
      
      return { article, score };
    });

    // Sort by score (highest first) and then by date (newest first)
    scoredArticles.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      // If scores are equal, sort by date (newest first)
      const dateA = new Date(a.article.created || 0).getTime();
      const dateB = new Date(b.article.created || 0).getTime();
      return dateB - dateA;
    });

    // Return articles - if we searched by ticker, return all (they're already relevant)
    // Otherwise, only return articles with score > threshold
    const minScore = ticker ? 0 : 1; // Lower threshold - even 1 point means some relevance
    
    const relevantArticles = scoredArticles
      .filter(item => item.score >= minScore)
      .slice(offset, offset + limit)
      .map(item => ({
        headline: item.article.headline || item.article.title || 'No headline',
        url: item.article.url || '',
        created: item.article.created || '',
        teaser: item.article.teaser || '',
        score: item.score,
      }));

    console.log(`[QUICK STORY SEARCH] Found ${scoredArticles.length} total articles, ${scoredArticles.filter(item => item.score >= minScore).length} above threshold, returning ${relevantArticles.length}`);
    
    return relevantArticles;
  } catch (error) {
    console.error('[QUICK STORY SEARCH] Error searching articles:', error);
    return [];
  }
}

export async function POST(req: Request) {
  try {
    const { customPrompt, ticker: providedTicker, offset = 0, limit = 5 } = await req.json();

    if (!customPrompt || typeof customPrompt !== 'string' || customPrompt.trim().length === 0) {
      return NextResponse.json({ error: 'Custom prompt is required' }, { status: 400 });
    }

    // Extract ticker, company names, and keywords from custom prompt
    // Use provided ticker from form if available, otherwise extract from prompt
    let ticker = providedTicker ? providedTicker.toUpperCase().trim() : extractTicker(customPrompt);
    
    // If ticker is comma-separated (e.g., "U, TTWO"), use the first one for primary search
    let primaryTicker = ticker;
    if (ticker && ticker.includes(',')) {
      const tickers = ticker.split(',').map((t: string) => t.trim().toUpperCase()).filter((t: string) => t);
      primaryTicker = tickers[0] || null;
      console.log(`[QUICK STORY SEARCH] Multiple tickers provided: ${tickers.join(', ')}, using ${primaryTicker} for primary search`);
    }
    
    const companyNames = extractCompanyNames(customPrompt);
    
    // If we found company names but no ticker, try to map them to tickers
    // For multiple companies, we'll search by the first one's ticker if available
    if (companyNames.length > 0 && !primaryTicker) {
      for (const companyName of companyNames) {
        const companyNameLower = companyName.toLowerCase();
        if (COMPANY_TO_TICKER[companyNameLower]) {
          primaryTicker = COMPANY_TO_TICKER[companyNameLower];
          console.log(`[QUICK STORY SEARCH] Mapped company name "${companyName}" to ticker "${primaryTicker}"`);
          break; // Use first match
        }
      }
    }
    
    // Collect all tickers for scoring (including multiple from form)
    const allTickers: string[] = [];
    if (primaryTicker) {
      allTickers.push(primaryTicker);
    }
    if (ticker && ticker.includes(',')) {
      const tickers = ticker.split(',').map((t: string) => t.trim().toUpperCase()).filter((t: string) => t);
      tickers.forEach((t: string) => {
        if (!allTickers.includes(t)) {
          allTickers.push(t);
        }
      });
    }
    companyNames.forEach(companyName => {
      const companyNameLower = companyName.toLowerCase();
      if (COMPANY_TO_TICKER[companyNameLower]) {
        const mappedTicker = COMPANY_TO_TICKER[companyNameLower];
        if (!allTickers.includes(mappedTicker)) {
          allTickers.push(mappedTicker);
        }
      }
    });
    
    const keywords = extractKeywords(customPrompt, ticker);
    
    console.log(`[QUICK STORY SEARCH] Extracted from prompt:`, {
      providedTicker: providedTicker || 'none',
      primaryTicker: primaryTicker || 'none',
      allTickers: allTickers.length > 0 ? allTickers.join(', ') : 'none',
      companyNames: companyNames.length > 0 ? companyNames.join(', ') : 'none',
      keywords: keywords.length > 0 ? keywords.join(', ') : 'none'
    });

    if (!primaryTicker && companyNames.length === 0 && keywords.length === 0) {
      return NextResponse.json({ articles: [], message: 'No ticker, company names, or meaningful keywords found in custom prompt' });
    }

    // Search articles - use primary ticker if available, otherwise use company names
    // Also pass all tickers for scoring
    const articles = await searchBenzingaArticles(primaryTicker || allTickers[0] || null, companyNames, keywords, offset, limit, allTickers);

    return NextResponse.json({ 
      articles,
      keywords,
      hasMore: articles.length === limit // Indicates there might be more results
    });
  } catch (error) {
    console.error('[QUICK STORY SEARCH] Error:', error);
    return NextResponse.json(
      { error: 'Failed to search articles' },
      { status: 500 }
    );
  }
}
