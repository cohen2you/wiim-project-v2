import { NextResponse } from 'next/server';
import { aiProvider } from '@/lib/aiProvider';

const BENZINGA_API_KEY = process.env.BENZINGA_API_KEY;
const BZ_NEWS_URL = 'https://api.benzinga.com/api/v2/news';
const BZ_QUOTE_URL = 'https://api.benzinga.com/api/v2/quoteDelayed';

// Story templates
const STORY_TEMPLATES = {
  'earnings-reaction': {
    name: 'Earnings Reaction',
    focus: 'Focus on earnings results, analyst reactions, and price movement following earnings.',
  },
  'price-movement': {
    name: 'Price Movement',
    focus: 'Focus on today\'s price movement, market context, and what\'s driving the stock.',
  },
  'sector-context': {
    name: 'Sector Context',
    focus: 'Focus on how the stock relates to its sector and related stocks, providing broader market context.',
  },
  'custom': {
    name: 'Custom',
    focus: 'Generate a story based on the custom focus provided.',
  },
};

// Fetch price data from Benzinga
async function fetchPriceData(ticker: string) {
  try {
    if (!BENZINGA_API_KEY) {
      console.log('[QUICK STORY] BENZINGA_API_KEY not configured');
      return null;
    }

    const url = `${BZ_QUOTE_URL}?token=${BENZINGA_API_KEY}&symbols=${encodeURIComponent(ticker)}`;
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      console.error(`[QUICK STORY] Failed to fetch price data for ${ticker}:`, response.status);
      return null;
    }

    const data = await response.json();
    if (data && data[ticker]) {
      const quote = data[ticker];
      // Calculate regular session change from close vs previousClose
      const regularClose = quote.close || quote.lastTradePrice || quote.last || null;
      const previousClose = quote.previousClosePrice || quote.previous_close || null;
      let regularChangePercent = quote.changePercent || quote.change_percent || null;
      
      // If we have close and previousClose, calculate regular session change
      if (regularClose && previousClose && previousClose > 0) {
        const closeNum = typeof regularClose === 'number' ? regularClose : parseFloat(regularClose);
        const prevCloseNum = typeof previousClose === 'number' ? previousClose : parseFloat(previousClose);
        if (!isNaN(closeNum) && !isNaN(prevCloseNum)) {
          regularChangePercent = ((closeNum - prevCloseNum) / prevCloseNum) * 100;
        }
      }
      
      // Extended hours data (multiple field name variations)
      const extendedHoursPrice = quote.ethPrice || quote.extendedHoursPrice || quote.afterHoursPrice || quote.ahPrice || quote.extendedPrice || null;
      const extendedHoursChangePercent = quote.ethChangePercent || quote.extendedHoursChangePercent || quote.afterHoursChangePercent || quote.ahChangePercent || quote.extendedChangePercent || null;
      
      return {
        symbol: quote.symbol || ticker,
        name: quote.name || ticker,
        lastTradePrice: quote.lastTradePrice || quote.last || null,
        changePercent: quote.changePercent || quote.change_percent || null,
        close: regularClose,
        previousClosePrice: previousClose,
        regularChangePercent: regularChangePercent,
        extendedHoursPrice: extendedHoursPrice,
        extendedHoursChangePercent: extendedHoursChangePercent,
      };
    }
    return null;
  } catch (error) {
    console.error(`[QUICK STORY] Error fetching price data for ${ticker}:`, error);
    return null;
  }
}

// Fetch recent Benzinga articles
async function fetchRecentArticles(ticker: string, count: number = 5): Promise<any[]> {
  try {
    if (!BENZINGA_API_KEY) {
      return [];
    }

    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - 7);
    const dateFromStr = dateFrom.toISOString().slice(0, 10);

    const url = `${BZ_NEWS_URL}?token=${BENZINGA_API_KEY}&tickers=${encodeURIComponent(ticker)}&items=${count * 3}&fields=headline,title,created,url,channels,teaser&accept=application/json&displayOutput=full&dateFrom=${dateFromStr}`;

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      console.error('[QUICK STORY] Failed to fetch articles:', response.status);
      return [];
    }

    const data = await response.json();
    if (!Array.isArray(data)) return [];

    // Filter out press releases
    const prChannelNames = ['press releases', 'press-releases', 'pressrelease', 'pr'];
    const normalize = (str: string) => str.toLowerCase().replace(/[-_]/g, ' ');

    const filteredArticles = data
      .filter((item: any) => {
        if (Array.isArray(item.channels) && item.channels.some((ch: any) =>
          typeof ch.name === 'string' && prChannelNames.includes(normalize(ch.name))
        )) {
          return false;
        }
        return true;
      })
      .slice(0, count)
      .map((item: any) => ({
        headline: item.headline || item.title || 'No headline',
        url: item.url || '',
        date: item.created || '',
        teaser: item.teaser || null,
      }));

    return filteredArticles;
  } catch (error) {
    console.error('[QUICK STORY] Error fetching articles:', error);
    return [];
  }
}

// Fetch most recent earnings results (with actuals)
async function fetchRecentEarningsResults(ticker: string) {
  try {
    if (!BENZINGA_API_KEY) {
      return null;
    }

    const today = new Date();
    const dateTo = today.toISOString().split('T')[0];
    const dateFrom = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // Last 90 days

    const url = 'https://api.benzinga.com/api/v2/calendar/earnings' +
      `?token=${BENZINGA_API_KEY}` +
      `&parameters[tickers]=${encodeURIComponent(ticker)}` +
      `&parameters[date_from]=${dateFrom}` +
      `&parameters[date_to]=${dateTo}`;

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      console.error(`[QUICK STORY] Failed to fetch earnings for ${ticker}:`, response.status);
      return null;
    }

    const data = await response.json();
    if (!data || !data.earnings || !Array.isArray(data.earnings)) {
      return null;
    }

    // Find the most recent earnings with actual results
    const earningsWithActuals = data.earnings
      .filter((item: any) => {
        const earningsDate = item.date || item.earnings_date || item.earningsDate;
        if (!earningsDate) return false;
        
        // Check if this earnings report has actual results (not just estimates)
        const hasActuals = (item.eps || item.eps_actual || item.epsActual || item.eps_actual_reported) ||
                          (item.revenue || item.revenue_actual || item.revenueActual || item.revenue_actual_reported);
        
        if (!hasActuals) return false;
        
        // Only include past earnings (not future)
        const date = new Date(earningsDate);
        return date <= today;
      })
      .sort((a: any, b: any) => {
        const dateA = new Date(a.date || a.earnings_date || a.earningsDate || 0);
        const dateB = new Date(b.date || b.earnings_date || b.earningsDate || 0);
        return dateB.getTime() - dateA.getTime(); // Most recent first
      });

    if (earningsWithActuals.length === 0) {
      return null;
    }

    const mostRecent = earningsWithActuals[0];
    const earningsDate = mostRecent.date || mostRecent.earnings_date || mostRecent.earningsDate;
    
    // Extract EPS data
    const epsActual = mostRecent.eps || mostRecent.eps_actual || mostRecent.epsActual || 
                     mostRecent.eps_actual_reported || mostRecent.actual_eps || mostRecent.reported_eps || null;
    const epsEst = mostRecent.eps_est || mostRecent.epsEst || mostRecent.eps_estimate || 
                  mostRecent.epsEstimate || mostRecent.estimated_eps || mostRecent.eps_consensus || null;
    const epsPrior = mostRecent.eps_prior || mostRecent.epsPrior || mostRecent.eps_prev || 
                    mostRecent.previous_eps || null;
    
    // Extract Revenue data
    const revenueActual = mostRecent.revenue || mostRecent.revenue_actual || mostRecent.revenueActual || 
                         mostRecent.revenue_actual_reported || mostRecent.actual_revenue || mostRecent.reported_revenue || null;
    const revenueEst = mostRecent.revenue_est || mostRecent.revenueEst || mostRecent.revenue_estimate || 
                      mostRecent.revenueEstimate || mostRecent.estimated_revenue || mostRecent.revenue_consensus || null;
    const revenuePrior = mostRecent.revenue_prior || mostRecent.revenuePrior || mostRecent.rev_prev || 
                        mostRecent.previous_revenue || null;

    // Calculate beats/misses
    let epsBeatMiss = null;
    if (epsActual !== null && epsEst !== null) {
      const actual = typeof epsActual === 'string' ? parseFloat(epsActual) : epsActual;
      const estimate = typeof epsEst === 'string' ? parseFloat(epsEst) : epsEst;
      if (!isNaN(actual) && !isNaN(estimate)) {
        epsBeatMiss = actual > estimate ? 'Beat' : actual < estimate ? 'Miss' : 'Meet';
      }
    }

    let revenueBeatMiss = null;
    if (revenueActual !== null && revenueEst !== null) {
      const actual = typeof revenueActual === 'string' ? parseFloat(revenueActual) : revenueActual;
      const estimate = typeof revenueEst === 'string' ? parseFloat(revenueEst) : revenueEst;
      if (!isNaN(actual) && !isNaN(estimate)) {
        revenueBeatMiss = actual > estimate ? 'Beat' : actual < estimate ? 'Miss' : 'Meet';
      }
    }

    // Calculate surprise percentages
    let epsSurprisePct = null;
    if (epsActual !== null && epsEst !== null && epsEst !== 0) {
      const actual = typeof epsActual === 'string' ? parseFloat(epsActual) : epsActual;
      const estimate = typeof epsEst === 'string' ? parseFloat(epsEst) : epsEst;
      if (!isNaN(actual) && !isNaN(estimate) && estimate !== 0) {
        epsSurprisePct = ((actual - estimate) / Math.abs(estimate)) * 100;
      }
    }

    let revenueSurprisePct = null;
    if (revenueActual !== null && revenueEst !== null && revenueEst !== 0) {
      const actual = typeof revenueActual === 'string' ? parseFloat(revenueActual) : revenueActual;
      const estimate = typeof revenueEst === 'string' ? parseFloat(revenueEst) : revenueEst;
      if (!isNaN(actual) && !isNaN(estimate) && estimate !== 0) {
        revenueSurprisePct = ((actual - estimate) / Math.abs(estimate)) * 100;
      }
    }

    return {
      date: earningsDate,
      eps_actual: epsActual,
      eps_estimate: epsEst,
      eps_prior: epsPrior,
      eps_beat_miss: epsBeatMiss,
      eps_surprise_pct: epsSurprisePct,
      revenue_actual: revenueActual,
      revenue_estimate: revenueEst,
      revenue_prior: revenuePrior,
      revenue_beat_miss: revenueBeatMiss,
      revenue_surprise_pct: revenueSurprisePct,
    };
  } catch (error) {
    console.error(`[QUICK STORY] Error fetching earnings results for ${ticker}:`, error);
    return null;
  }
}

// Fetch related stock data
async function fetchRelatedStockData(tickers: string[]): Promise<Record<string, any>> {
  if (!tickers || tickers.length === 0 || !BENZINGA_API_KEY) {
    return {};
  }

  try {
    const symbols = tickers.join(',');
    const url = `${BZ_QUOTE_URL}?token=${BENZINGA_API_KEY}&symbols=${encodeURIComponent(symbols)}`;
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      return {};
    }

    const data = await response.json();
    const result: Record<string, any> = {};

    tickers.forEach((ticker) => {
      if (data && data[ticker]) {
        const quote = data[ticker];
        result[ticker] = {
          name: quote.name || ticker,
          price: quote.lastTradePrice || quote.last || null,
          change: quote.changePercent || quote.change_percent || null,
          volume: quote.volume || quote.vol || null,
          previousClose: quote.previousClosePrice || quote.previous_close || null,
        };
      }
    });

    return result;
  } catch (error) {
    console.error('[QUICK STORY] Error fetching related stock data:', error);
    return {};
  }
}

// Helper function to determine market session
function getMarketSession(): 'premarket' | 'regular' | 'afterhours' | 'closed' {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  
  const parts = formatter.formatToParts(now);
  const dayName = parts.find(part => part.type === 'weekday')?.value ?? 'Sunday';
  const hourString = parts.find(part => part.type === 'hour')?.value ?? '00';
  const minuteString = parts.find(part => part.type === 'minute')?.value ?? '00';
  
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayIndex = dayNames.indexOf(dayName);
  const hour = parseInt(hourString, 10);
  const minute = parseInt(minuteString, 10);
  const time = hour * 100 + minute;
  
  if (dayIndex === 0 || dayIndex === 6) return 'closed';
  if (time >= 400 && time < 930) return 'premarket';
  if (time >= 930 && time < 1600) return 'regular';
  if (time >= 1600 && time < 2000) return 'afterhours';
  return 'closed';
}

// Format price action text
function formatPriceAction(quote: any, ticker: string): string {
  if (!quote || !quote.lastTradePrice) {
    return '';
  }

  const symbol = quote.symbol || ticker.toUpperCase();
  const companyName = quote.name || symbol;
  const marketSession = getMarketSession();
  
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
  });
  const dayOfWeek = formatter.format(now);
  
  // Regular session data
  const regularClose = quote.close || quote.lastTradePrice || quote.last;
  const regularChange = quote.regularChangePercent !== null && quote.regularChangePercent !== undefined 
    ? quote.regularChangePercent 
    : (quote.changePercent || quote.change_percent || 0);
  const regularPrice = typeof regularClose === 'number' 
    ? regularClose.toFixed(2) 
    : parseFloat(regularClose).toFixed(2);
  const regularChangeAbs = Math.abs(regularChange).toFixed(2);
  const regularDirection = regularChange > 0 ? 'up' : regularChange < 0 ? 'down' : 'unchanged';
  
  // Extended hours data
  const hasExtendedHours = quote.extendedHoursPrice && quote.extendedHoursChangePercent !== null && quote.extendedHoursChangePercent !== undefined;
  const extPrice = hasExtendedHours 
    ? (typeof quote.extendedHoursPrice === 'number' ? quote.extendedHoursPrice.toFixed(2) : parseFloat(quote.extendedHoursPrice).toFixed(2))
    : null;
  const extChange = hasExtendedHours ? quote.extendedHoursChangePercent : null;
  const extChangeAbs = extChange !== null ? Math.abs(extChange).toFixed(2) : null;
  const extDirection = extChange !== null ? (extChange > 0 ? 'up' : 'down') : null;
  
  // Build price action text
  if (marketSession === 'afterhours' && hasExtendedHours) {
    // Show both regular session and after-hours
    return `${symbol} was ${regularDirection} ${regularChangeAbs}% at $${regularPrice} during regular trading hours, and was ${extDirection} ${extChangeAbs}% at $${extPrice} in after-hours trading on ${dayOfWeek}`;
  } else if (marketSession === 'afterhours') {
    // After-hours but no extended hours data, just show regular session
    return `${symbol} was ${regularDirection} ${regularChangeAbs}% at $${regularPrice} during regular trading hours on ${dayOfWeek}`;
  } else {
    // Regular session or closed
    if (regularChange !== 0) {
      return `${symbol} was ${regularDirection} ${regularChangeAbs}% at $${regularPrice} on ${dayOfWeek}`;
    }
    return `${symbol} was trading at $${regularPrice} on ${dayOfWeek}`;
  }
}

// Format earnings data for prompt
function formatEarningsData(earnings: any): string {
  if (!earnings) return '';

  let text = '\n\nEARNINGS RESULTS:\n';
  text += `Report Date: ${earnings.date || 'N/A'}\n`;

  if (earnings.eps_actual !== null && earnings.eps_estimate !== null) {
    const epsActual = typeof earnings.eps_actual === 'string' 
      ? parseFloat(earnings.eps_actual).toFixed(2) 
      : earnings.eps_actual.toFixed(2);
    const epsEst = typeof earnings.eps_estimate === 'string' 
      ? parseFloat(earnings.eps_estimate).toFixed(2) 
      : earnings.eps_estimate.toFixed(2);
    
    text += `EPS: Reported $${epsActual} vs. Estimate $${epsEst}`;
    if (earnings.eps_beat_miss) {
      text += ` (${earnings.eps_beat_miss})`;
    }
    if (earnings.eps_surprise_pct !== null) {
      const surprise = earnings.eps_surprise_pct > 0 ? '+' : '';
      text += ` - ${surprise}${earnings.eps_surprise_pct.toFixed(1)}% surprise`;
    }
    if (earnings.eps_prior !== null) {
      const prior = typeof earnings.eps_prior === 'string' 
        ? parseFloat(earnings.eps_prior).toFixed(2) 
        : earnings.eps_prior.toFixed(2);
      text += ` (Prior: $${prior})`;
    }
    text += '\n';
  }

  if (earnings.revenue_actual !== null && earnings.revenue_estimate !== null) {
    const formatRevenue = (val: number | string) => {
      const num = typeof val === 'string' ? parseFloat(val) : val;
      const millions = num / 1000000;
      if (millions >= 1000) {
        return `$${(millions / 1000).toFixed(2)}B`;
      }
      return `$${millions.toFixed(2)}M`;
    };

    text += `Revenue: Reported ${formatRevenue(earnings.revenue_actual)} vs. Estimate ${formatRevenue(earnings.revenue_estimate)}`;
    if (earnings.revenue_beat_miss) {
      text += ` (${earnings.revenue_beat_miss})`;
    }
    if (earnings.revenue_surprise_pct !== null) {
      const surprise = earnings.revenue_surprise_pct > 0 ? '+' : '';
      text += ` - ${surprise}${earnings.revenue_surprise_pct.toFixed(1)}% surprise`;
    }
    if (earnings.revenue_prior !== null) {
      text += ` (Prior: ${formatRevenue(earnings.revenue_prior)})`;
    }
    text += '\n';
  }

  return text;
}

// Build prompt based on template and parameters
function buildPrompt(
  ticker: string,
  companyName: string,
  priceAction: string,
  articles: any[],
  relatedStocks: Record<string, any>,
  template: string,
  wordCount: number,
  customFocus?: string,
  earningsData?: any,
  priceData?: any
): string {
  const templateInfo = STORY_TEMPLATES[template as keyof typeof STORY_TEMPLATES] || STORY_TEMPLATES['price-movement'];
  const focus = template === 'custom' && customFocus ? customFocus : templateInfo.focus;

  let articlesText = '';
  if (articles.length > 0) {
    articlesText = `\n\nRECENT ARTICLES (MANDATORY: You MUST create a hyperlink for ALL ${articles.length} articles below - include each one in your story):\n`;
    articles.forEach((article, index) => {
      articlesText += `${index + 1}. ${article.headline}: ${article.url}`;
      if (article.teaser) {
        // Truncate teaser to first 200 characters to keep it concise
        const teaser = article.teaser.length > 200 
          ? article.teaser.substring(0, 200) + '...' 
          : article.teaser;
        articlesText += `\n   Excerpt: ${teaser}`;
      }
      articlesText += '\n';
    });
    articlesText += `\n\nCRITICAL HYPERLINK REQUIREMENTS:
- You MUST create a hyperlink for ALL ${articles.length} articles listed above
- At least ONE hyperlink MUST appear in your FIRST paragraph (the lead paragraph)
- Each hyperlink should use three sequential words from the article headline
- Embed hyperlinks naturally throughout the article - distribute them across different paragraphs
- Count your hyperlinks before submitting: you need exactly ${articles.length} hyperlinks total\n`;
  }

  let relatedStocksText = '';
  if (Object.keys(relatedStocks).length > 0) {
    relatedStocksText = '\n\nRELATED STOCKS (provide market context - emphasize percentage moves and technical context, not just prices):\n';
    Object.entries(relatedStocks).forEach(([ticker, data]) => {
      const changeText = data.change !== null 
        ? `${data.change > 0 ? '+' : ''}${data.change.toFixed(2)}%`
        : 'N/A';
      const volumeText = data.volume ? ` (Volume: ${typeof data.volume === 'number' ? data.volume.toLocaleString() : data.volume})` : '';
      // Determine exchange from ticker format or default to NASDAQ
      const exchange = ticker.includes(':') ? ticker.split(':')[0] : 'NASDAQ';
      const tickerOnly = ticker.includes(':') ? ticker.split(':')[1] : ticker;
      relatedStocksText += `- ${data.name} (${exchange}: ${tickerOnly}): ${changeText}${volumeText}\n`;
    });
    relatedStocksText += '\nIMPORTANT: When mentioning related stocks, focus on their percentage moves and market context rather than absolute stock prices. Use phrases like "up X%", "down Y%", "trading higher/lower", "gaining/losing momentum" rather than stating specific prices.\n';
    relatedStocksText += 'CRITICAL: On the FIRST mention of each related stock, you MUST use the FULL company name with ticker: <strong>Company Name</strong> (NASDAQ: TICKER) or <strong>Company Name</strong> (NYSE: TICKER). Example: <strong>Microsoft Corporation</strong> (NASDAQ: MSFT).\n';
  }

  let earningsText = '';
  if (template === 'earnings-reaction' && earningsData) {
    earningsText = formatEarningsData(earningsData);
  }

  return `You are a financial journalist writing a ${wordCount}-word article about ${companyName} (${ticker}).

${focus}

CURRENT PRICE ACTION:
${priceAction || 'Price data not available'}
${priceData && priceData.extendedHoursPrice && priceData.extendedHoursChangePercent !== null ? `\nNOTE: The stock closed ${priceData.regularChangePercent > 0 ? 'up' : 'down'} ${Math.abs(priceData.regularChangePercent || 0).toFixed(2)}% during regular trading hours, but is ${priceData.extendedHoursChangePercent > 0 ? 'up' : 'down'} ${Math.abs(priceData.extendedHoursChangePercent).toFixed(2)}% in after-hours trading. When describing the stock movement, mention both the regular session performance and after-hours movement if they differ significantly.` : ''}
${earningsText}
${articlesText}

${relatedStocksText}

REQUIREMENTS:
1. CRITICAL HYPERLINK REQUIREMENT (HIGHEST PRIORITY):
   - You MUST create a hyperlink for EVERY article provided above - no exceptions
   - If ${articles.length} articles are provided, you must include ${articles.length} hyperlinks in your story
   - REQUIRED: At least ONE hyperlink MUST appear in the FIRST paragraph (lead paragraph)
   - For each article, create a hyperlink using THREE SEQUENTIAL WORDS from the article headline
   - Format: <a href="URL">three sequential words</a> (use HTML format, NOT markdown)
   - Do NOT mention "Benzinga" or any source name when linking
   - Embed each hyperlink naturally within your sentences throughout the article
   - Distribute the hyperlinks throughout the article - don't cluster them all in one paragraph
   - Before submitting, count your hyperlinks: you need exactly ${articles.length} hyperlinks total
2. Word count: Aim for ${wordCount} words, but prioritize DATA DENSITY over hitting the exact count.
   - If you've covered all the key information and there's nothing new to add, it's acceptable to fall short (minimum ${Math.floor(wordCount * 0.8)} words)
   - DO NOT add fluff, repetition, or filler content just to reach the word count
   - Every sentence must provide NEW information or context - avoid repeating facts already stated
   - If a section would just repeat information from earlier paragraphs, either skip it or provide genuinely new data
3. Start with the company name and ticker: <strong>${companyName}</strong> (${ticker.includes(':') ? ticker : `NASDAQ: ${ticker}`})
   - Use HTML <strong> tags to bold ONLY the company name, NOT the ticker
   - CRITICAL: On the FIRST mention of ANY company (main company or related stocks), you MUST include:
     * The FULL company name (e.g., "Microsoft Corporation", "NVIDIA Corporation", not just "Microsoft" or "NVIDIA")
     * The ticker in parentheses (e.g., "(NASDAQ: MSFT)", "(NASDAQ: NVDA)")
     * Bold the company name: <strong>Microsoft Corporation</strong> (NASDAQ: MSFT)
   - After the first mention, use the shortened company name without bolding or ticker (e.g., "Microsoft", "NVIDIA")
   - This applies to ALL companies mentioned in the article (main company and related stocks)
4. COMPANY NAME FORMATTING: 
   - FIRST MENTION: Use HTML <strong> tags to bold ONLY the company name, NOT the ticker. CRITICAL RULES:
     * Use the FULL company name (e.g., "Microsoft Corporation", "NVIDIA Corporation", "Apple Inc.", "Meta Platforms, Inc.")
     * ALWAYS include the ticker in parentheses: (NASDAQ: XXX) or (NYSE: XXX)
     * Examples:
       - <strong>Microsoft Corporation</strong> (NASDAQ: MSFT)
       - <strong>NVIDIA Corporation</strong> (NASDAQ: NVDA)
       - <strong>Apple Inc.</strong> (NASDAQ: AAPL)
       - <strong>Meta Platforms, Inc.</strong> (NASDAQ: META)
   - SUBSEQUENT MENTIONS: After the first mention, use the shortened company name without bolding or ticker (e.g., "Microsoft", "NVIDIA", "Apple", "Meta Platforms")
   - Do NOT use markdown ** syntax - always use HTML <strong> tags
   - Apply this rule to ALL companies mentioned in the article (main company and related stocks)
   - If you're unsure of the full company name, use the name provided in the related stocks data or make a reasonable assumption (e.g., add "Corporation", "Inc.", "Ltd." as appropriate)
5. PROMINENT PEOPLE FORMATTING:
   - FIRST MENTION: Use HTML <strong> tags to bold the full name of prominent people (CEOs, executives, investors, analysts, etc.) on their first mention
   - Examples: <strong>Mark Zuckerberg</strong>, <strong>Satya Nadella</strong>, <strong>Jensen Huang</strong>, <strong>Dan Loeb</strong>
   - SUBSEQUENT MENTIONS: After the first mention, use the name without bolding (e.g., "Zuckerberg", "Nadella", "Huang")
   - Do NOT use markdown ** syntax - always use HTML <strong> tags
6. STRUCTURE AND FORMATTING:
   - Break up long sections with subhead placeholders using this format: ## Section: [Subhead Title]
   - Use 2-3 subhead placeholders throughout the article to improve readability and SEO
   - Use bullet points (<ul> and <li> tags) for lists, key points, or comparisons when appropriate
   - Example bullet format: <ul><li>First point</li><li>Second point</li></ul>
   - Balance paragraphs with subheads and bullet points - don't make it all one format
7. RELATED STOCKS CONTEXT (if provided):
   - Focus on percentage moves and market momentum, NOT absolute stock prices
   - Use phrases like "Microsoft's stock is up 0.59%" or "NVIDIA is trading lower, down 0.30%"
   - Provide technical context: "gaining momentum", "trading higher", "under pressure", etc.
   - Avoid stating specific prices like "$436.12" - instead emphasize the movement and percentage change
   - Use the percentage data to show market trends and sector performance
8. PRICE MOVEMENT REPORTING:
   - If the stock had different performance during regular trading hours vs after-hours trading, mention BOTH
   - Example: "Meta Platforms was up 2.5% during regular trading hours, but declined 0.50% in after-hours trading"
   - Always distinguish between regular session performance and after-hours movement when they differ significantly
   - Use the price action data provided to accurately report both regular session and after-hours performance
9. Use professional, journalistic tone suitable for financial news.
10. Focus on current events and recent developments.
11. PRICE ACTION SECTION:
   - If you include a "## Section: Price Action" placeholder, provide ONLY new information not already covered
   - DO NOT repeat the price movement that was already mentioned in the lead paragraph
   - If the price action was already fully described earlier, you can skip adding content to this section or provide only the section marker
   - The price action line at the end is sufficient - don't repeat it in the section content
12. End with a price action line: "${priceAction || `${ticker} price data not available`}, according to Benzinga Pro data."
13. Format the article with proper paragraph breaks using <p> tags.
14. Do NOT include "Also Read" or "Read Next" sections.
15. Do NOT mention "Benzinga" or any source name when referencing the articles - just embed the links naturally.
16. DATA DENSITY RULE: Every paragraph must introduce NEW information. If you find yourself repeating facts, data points, or analysis already mentioned, either:
    - Skip that content entirely
    - Or provide a different angle/context that adds value
    - Avoid phrases like "underscores", "highlights", "reflects" when they're just restating what was already said
    - DO NOT add filler sentences just to reach word count - quality over quantity
    - If you've covered all key information and there's nothing new to add, it's better to end the article than add repetitive fluff

Generate the article now:`;
}

export async function POST(req: Request) {
  try {
    const {
      ticker,
      wordCount = 400,
      template = 'price-movement',
      relatedStocks = [],
      customFocus,
      aiProvider: providerOverride,
    } = await req.json();

    if (!ticker || !ticker.trim()) {
      return NextResponse.json({ error: 'Ticker is required' }, { status: 400 });
    }

    const tickerUpper = ticker.toUpperCase().trim();
    const provider = providerOverride || 'openai';

    console.log(`[QUICK STORY] Generating story for ${tickerUpper}, template: ${template}, word count: ${wordCount}`);

    // Fetch data in parallel
    const [priceData, articles, earningsData] = await Promise.all([
      fetchPriceData(tickerUpper),
      fetchRecentArticles(tickerUpper, 5),
      template === 'earnings-reaction' ? fetchRecentEarningsResults(tickerUpper) : Promise.resolve(null),
    ]);

    // Fetch related stock data if provided
    let relatedStockData: Record<string, any> = {};
    if (relatedStocks && Array.isArray(relatedStocks) && relatedStocks.length > 0) {
      relatedStockData = await fetchRelatedStockData(relatedStocks);
    }

    // Format price action
    const companyName = priceData?.name || tickerUpper;
    const priceAction = formatPriceAction(priceData, tickerUpper);

    // Build prompt
    const prompt = buildPrompt(
      tickerUpper,
      companyName,
      priceAction,
      articles,
      relatedStockData,
      template,
      wordCount,
      customFocus,
      earningsData || undefined,
      priceData || undefined
    );

    // Generate story
    const result = await aiProvider.generateCompletion(
      [
        {
          role: 'system',
          content: 'You are a professional financial journalist writing concise, data-dense articles for a financial news website. HIGHEST PRIORITY: You must hyperlink EVERY article provided - if 5 articles are given, include exactly 5 hyperlinks distributed throughout the story. At least ONE hyperlink MUST appear in the first paragraph. Use HTML format: <a href="URL">text</a> NOT markdown format. Always use HTML <strong> tags to bold company names (not tickers) and prominent people\'s names on their first mention. CRITICAL: On the FIRST mention of ANY company (main or related), you MUST use the FULL company name (e.g., "Microsoft Corporation", "NVIDIA Corporation") with the ticker in parentheses. Use subhead placeholders (## Section:) and bullet points (<ul>/<li>) to break up content and improve readability. Prioritize data density - avoid fluff and repetition.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      {
        model: provider === 'gemini' ? 'gemini-3-pro-preview' : 'gpt-4o',
        temperature: 0.3, // Lower temperature for more consistent instruction following
        maxTokens: Math.max(wordCount * 3, 2000), // Increased to prevent truncation
      },
      provider
    );

    let story = result.content.trim();

    // Clean up any markdown wrappers
    story = story.replace(/^```(?:markdown|html)?\s*/i, '').replace(/\s*```$/i, '');

    // Validate hyperlinks: Count how many article URLs are actually hyperlinked
    // Check for both HTML format <a href="url">text</a> and markdown format [text](url)
    const htmlLinks = (story.match(/<a\s+href=["']https?:\/\/[^"']+["'][^>]*>/gi) || []).length;
    const markdownLinks = (story.match(/\[([^\]]+)\]\(https?:\/\/[^\)]+\)/gi) || []).length;
    const hyperlinkCount = htmlLinks + markdownLinks;
    const expectedHyperlinks = articles.length;
    
    console.log(`[QUICK STORY] Hyperlink detection: ${htmlLinks} HTML links, ${markdownLinks} markdown links, total: ${hyperlinkCount}`);
    
    console.log(`[QUICK STORY] Hyperlink validation: Found ${hyperlinkCount} hyperlinks, expected ${expectedHyperlinks}`);
    
    // If hyperlinks are missing, retry with stronger instructions (max 2 retries)
    let retryCount = 0;
    const maxRetries = 2;
    let currentHyperlinkCount = hyperlinkCount;
    
    while (currentHyperlinkCount < expectedHyperlinks && retryCount < maxRetries) {
      console.log(`[QUICK STORY] Missing hyperlinks detected. Retry ${retryCount + 1}/${maxRetries}...`);
      console.log(`[QUICK STORY] Current hyperlink count: ${currentHyperlinkCount}, expected: ${expectedHyperlinks}`);
      
      // Build a more explicit prompt with hyperlink requirements
      const retryPrompt = buildPrompt(
        tickerUpper,
        companyName,
        priceAction,
        articles,
        relatedStockData,
        template,
        wordCount,
        customFocus,
        earningsData || undefined,
        priceData || undefined
      ) + `\n\nCRITICAL VALIDATION REQUIRED BEFORE SUBMITTING:
- You MUST have exactly ${expectedHyperlinks} hyperlinks in your story (one for each article)
- Current count: ${currentHyperlinkCount} hyperlinks found
- You are MISSING ${expectedHyperlinks - currentHyperlinkCount} hyperlink(s)
- Go through each article listed above and ensure you've created a hyperlink for it
- Each hyperlink must use three sequential words from the article headline
- Format: <a href="URL">three sequential words</a> (use HTML format, NOT markdown)
- After adding the missing hyperlink(s), count again to verify you have exactly ${expectedHyperlinks} hyperlinks
- DO NOT submit until you have exactly ${expectedHyperlinks} hyperlinks`;

      const retryResult = await aiProvider.generateCompletion(
        [
          {
            role: 'system',
            content: 'You are a professional financial journalist writing concise, data-dense articles for a financial news website. CRITICAL HYPERLINK RULE: You must hyperlink EVERY article provided - if 5 articles are given, include exactly 5 hyperlinks distributed throughout the story. At least ONE hyperlink MUST appear in the first paragraph. Use HTML format: <a href="URL">text</a> NOT markdown format. Always use HTML <strong> tags to bold company names (not tickers) and prominent people\'s names on their first mention. CRITICAL: On the FIRST mention of ANY company (main or related), you MUST use the FULL company name (e.g., "Microsoft Corporation", "NVIDIA Corporation") with the ticker in parentheses. Use subhead placeholders (## Section:) and bullet points (<ul>/<li>) to break up content and improve readability.',
          },
          {
            role: 'user',
            content: retryPrompt,
          },
        ],
        {
          model: provider === 'gemini' ? 'gemini-3-pro-preview' : 'gpt-4o',
          temperature: 0.3, // Lower temperature for more consistent instruction following
          maxTokens: Math.max(wordCount * 3, 2000), // Increased to prevent truncation
        },
        provider
      );

      story = retryResult.content.trim();
      story = story.replace(/^```(?:markdown|html)?\s*/i, '').replace(/\s*```$/i, '');
      
      // Re-count hyperlinks (both HTML and markdown)
      const newHtmlLinks = (story.match(/<a\s+href=["']https?:\/\/[^"']+["'][^>]*>/gi) || []).length;
      const newMarkdownLinks = (story.match(/\[([^\]]+)\]\(https?:\/\/[^\)]+\)/gi) || []).length;
      const newHyperlinkCount = newHtmlLinks + newMarkdownLinks;
      console.log(`[QUICK STORY] After retry ${retryCount + 1}: Found ${newHtmlLinks} HTML links, ${newMarkdownLinks} markdown links, total: ${newHyperlinkCount}`);
      
      // Update current count for next iteration
      currentHyperlinkCount = newHyperlinkCount;
      
      if (newHyperlinkCount >= expectedHyperlinks) {
        console.log(`[QUICK STORY] ✅ Successfully added missing hyperlinks after retry ${retryCount + 1}`);
        break;
      }
      
      retryCount++;
    }

    // Final validation warning if still missing hyperlinks
    const finalHtmlLinks = (story.match(/<a\s+href=["']https?:\/\/[^"']+["'][^>]*>/gi) || []).length;
    const finalMarkdownLinks = (story.match(/\[([^\]]+)\]\(https?:\/\/[^\)]+\)/gi) || []).length;
    const finalHyperlinkCount = finalHtmlLinks + finalMarkdownLinks;
    
    if (finalHyperlinkCount < expectedHyperlinks) {
      console.warn(`[QUICK STORY] ⚠️ WARNING: Only ${finalHyperlinkCount} of ${expectedHyperlinks} hyperlinks found after ${maxRetries} retries (${finalHtmlLinks} HTML, ${finalMarkdownLinks} markdown)`);
    }
    
    // Convert any markdown links to HTML format for consistency
    if (finalMarkdownLinks > 0) {
      story = story.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/gi, '<a href="$2">$1</a>');
      console.log(`[QUICK STORY] Converted ${finalMarkdownLinks} markdown links to HTML format`);
    }

    // Ensure price action line is at the end
    if (!story.includes(priceAction) && priceAction) {
      story += `\n\n<p><strong>${tickerUpper} Price Action:</strong> ${priceAction}, according to <a href="https://pro.benzinga.com/dashboard">Benzinga Pro data</a>.</p>`;
    }

    return NextResponse.json({
      story,
      priceAction,
      articlesUsed: articles.length,
      relatedStocksUsed: Object.keys(relatedStockData).length,
      hyperlinksFound: finalHyperlinkCount,
      hyperlinksExpected: expectedHyperlinks,
      hyperlinkWarning: finalHyperlinkCount < expectedHyperlinks ? `Warning: Only ${finalHyperlinkCount} of ${expectedHyperlinks} hyperlinks were found in the story.` : null,
    });
  } catch (error: any) {
    console.error('[QUICK STORY] Error generating story:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to generate story' },
      { status: 500 }
    );
  }
}
