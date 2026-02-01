import { NextResponse } from 'next/server';
import { aiProvider, AIProvider } from '@/lib/aiProvider';
import { fetchETFs, formatETFInfo } from '@/lib/etf-utils';

const BENZINGA_API_KEY = process.env.BENZINGA_API_KEY;
const POLYGON_API_KEY = process.env.POLYGON_API_KEY;
const BZ_NEWS_URL = 'https://api.benzinga.com/api/v2/news';
const BZ_QUOTE_URL = 'https://api.benzinga.com/api/v2/quoteDelayed';

// Helper functions from WGO Generator
function normalizeCompanyName(name: string): string {
  if (!name) return name;
  if (name === name.toUpperCase() && name.length > 1) {
    return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  }
  return name;
}

function getMarketStatusTimeBased(): 'open' | 'premarket' | 'afterhours' | 'closed' {
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
  if (time >= 930 && time < 1600) return 'open';
  if (time >= 1600 && time < 2000) return 'afterhours';
  return 'closed';
}

// Fetch price data from Benzinga API (same as WGO Generator)
async function fetchPriceDataFromBenzinga(ticker: string): Promise<{ quote: any; changePercent: number | undefined } | null> {
  try {
    if (!BENZINGA_API_KEY) {
      console.error('[QUICK STORY] BENZINGA_API_KEY not found');
      return null;
    }
    
    const url = `${BZ_QUOTE_URL}?token=${BENZINGA_API_KEY}&symbols=${ticker}`;
    const res = await fetch(url);
    
    if (!res.ok) {
      console.error(`[QUICK STORY] Failed to fetch price data for ${ticker}:`, res.statusText);
      return null;
    }
    
    const data = await res.json();
    if (!data || typeof data !== 'object') {
      return null;
    }
    
    const quote = data[ticker.toUpperCase()];
    if (!quote || typeof quote !== 'object' || !quote.lastTradePrice) {
      return null;
    }
    
    const changePercent = typeof quote.changePercent === 'number' ? quote.changePercent : undefined;
    return { quote, changePercent };
  } catch (error) {
    console.error(`[QUICK STORY] Error fetching price data for ${ticker}:`, error);
    return null;
  }
}

// Generate price action using Benzinga API (same as WGO Generator)
async function generatePriceAction(ticker: string): Promise<string> {
  try {
    const priceData = await fetchPriceDataFromBenzinga(ticker);
    if (!priceData) {
      return '';
    }
    
    const { quote, changePercent } = priceData;
    const symbol = quote.symbol ?? ticker.toUpperCase();
    const companyName = normalizeCompanyName(quote.name ?? symbol);
    
    if (!symbol || !quote.lastTradePrice) {
      return '';
    }
    
    const marketStatus = getMarketStatusTimeBased();
    
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'long',
    });
    const currentDayName = formatter.format(now);
    const dayOfWeek = (currentDayName === 'Sunday' || currentDayName === 'Saturday') ? 'Friday' : currentDayName;
    const isWeekend = currentDayName === 'Sunday' || currentDayName === 'Saturday';
    
    let regularSessionChange = 0;
    let afterHoursChange = 0;
    let regularUpDown = '';
    let afterHoursUpDown = '';
    
    if (marketStatus === 'afterhours' && quote.close && quote.lastTradePrice && quote.previousClosePrice) {
      regularSessionChange = ((quote.close - quote.previousClosePrice) / quote.previousClosePrice) * 100;
      regularUpDown = regularSessionChange > 0 ? 'up' : regularSessionChange < 0 ? 'down' : 'unchanged';
      afterHoursChange = ((quote.lastTradePrice - quote.close) / quote.close) * 100;
      afterHoursUpDown = afterHoursChange > 0 ? 'up' : afterHoursChange < 0 ? 'down' : 'unchanged';
    }
    
    const lastPrice = typeof quote.lastTradePrice === 'number' ? quote.lastTradePrice : parseFloat(quote.lastTradePrice);
    const formattedPrice = lastPrice.toFixed(2);
    const priceString = String(formattedPrice);
    
    const shouldShowChangePercent = marketStatus === 'open'
      ? (changePercent !== undefined && changePercent !== 0)
      : changePercent !== undefined;
    
    const changePercentForCalc = changePercent ?? 0;
    const upDown = changePercentForCalc > 0 ? 'up' : changePercentForCalc < 0 ? 'down' : 'unchanged';
    const absChange = Math.abs(changePercentForCalc).toFixed(2);
    
    let priceActionText = '';
    
    if (marketStatus === 'open') {
      if (shouldShowChangePercent) {
        priceActionText = `${symbol} Price Action: ${companyName} shares were ${upDown} ${absChange}% at $${priceString} at the time of publication on ${dayOfWeek}`;
      } else {
        priceActionText = `${symbol} Price Action: ${companyName} shares were trading at $${priceString} at the time of publication on ${dayOfWeek}`;
      }
    } else if (marketStatus === 'afterhours' && quote.close && quote.lastTradePrice && quote.previousClosePrice) {
      const absRegularChange = Math.abs(regularSessionChange).toFixed(2);
      const absAfterHoursChange = Math.abs(afterHoursChange).toFixed(2);
      priceActionText = `${symbol} Price Action: ${companyName} shares were ${regularUpDown} ${absRegularChange}% during regular trading and ${afterHoursUpDown} ${absAfterHoursChange}% in after-hours trading on ${dayOfWeek}, last trading at $${priceString}`;
    } else {
      let marketStatusPhrase = '';
      if (marketStatus === 'premarket') {
        marketStatusPhrase = ' during premarket trading';
      } else if (marketStatus === 'afterhours') {
        marketStatusPhrase = ' during after-hours trading';
      } else if (marketStatus === 'closed') {
        marketStatusPhrase = isWeekend ? '' : ' while the market was closed';
      }
      const timePhrase = (marketStatus === 'closed' && !isWeekend) ? ' at the time of publication' : '';
      if (shouldShowChangePercent) {
        priceActionText = `${symbol} Price Action: ${companyName} shares were ${upDown} ${absChange}% at $${priceString}${marketStatusPhrase}${timePhrase} on ${dayOfWeek}`;
      } else {
        priceActionText = `${symbol} Price Action: ${companyName} shares were trading at $${priceString}${marketStatusPhrase}${timePhrase} on ${dayOfWeek}`;
      }
    }
    
    const prefixMatch = priceActionText.match(/^([A-Z]+\s+Price Action:)\s+(.+)$/);
    if (prefixMatch) {
      const prefix = prefixMatch[1];
      const rest = prefixMatch[2];
      return `<strong>${prefix}</strong> ${rest}, according to <a href="https://pro.benzinga.com/dashboard">Benzinga Pro data</a>.`;
    }
    return `<strong>${priceActionText}</strong>, according to <a href="https://pro.benzinga.com/dashboard">Benzinga Pro data</a>.`;
  } catch (error) {
    console.error(`[QUICK STORY] Error generating price action for ${ticker}:`, error);
    return '';
  }
}

// Helper to scrape news URL
async function scrapeNewsUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) return null;

    const html = await response.text();
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return text.substring(0, 5000);
  } catch (error) {
    console.error('[QUICK STORY] Error scraping URL:', error);
    return null;
  }
}

// Market context interface (from WGO Generator)
interface MarketContext {
  indices: Array<{ name: string; ticker: string; change: number }>;
  sectors: Array<{ name: string; ticker: string; change: number }>;
  marketBreadth: { advancers: number; decliners: number; ratio: string };
  topGainers: Array<{ name: string; ticker: string; change: number }>;
  topLosers: Array<{ name: string; ticker: string; change: number }>;
}

// Fetch market context (from WGO Generator)
async function fetchMarketContext(usePreviousDay: boolean = false): Promise<MarketContext | null> {
  try {
    console.log('[QUICK STORY] Fetching market context data...');
    const INDICES = ['SPY', 'QQQ', 'DIA', 'IWM'];
    const SECTORS = ['XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLP', 'XLY', 'XLU', 'XLRE', 'XLC', 'XLB'];
    
    const [indicesRes, sectorsRes, gainersRes, losersRes] = await Promise.all([
      fetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${INDICES.join(',')}&apikey=${POLYGON_API_KEY}`),
      fetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${SECTORS.join(',')}&apikey=${POLYGON_API_KEY}`),
      fetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/gainers?apikey=${POLYGON_API_KEY}`),
      fetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/losers?apikey=${POLYGON_API_KEY}`)
    ]);

    const [indicesData, sectorsData, gainersData, losersData] = await Promise.all([
      indicesRes.json(),
      sectorsRes.json(),
      gainersRes.json(),
      losersRes.json()
    ]);

    const indices = (indicesData.tickers || []).map((idx: any) => ({
      name: idx.ticker === 'SPY' ? 'S&P 500' : 
            idx.ticker === 'QQQ' ? 'Nasdaq' : 
            idx.ticker === 'DIA' ? 'Dow Jones' : 
            idx.ticker === 'IWM' ? 'Russell 2000' : idx.ticker,
      ticker: idx.ticker,
      change: idx.todaysChangePerc || 0
    }));

    const sectors = (sectorsData.tickers || []).map((sector: any) => ({
      name: sector.ticker === 'XLK' ? 'Technology' :
            sector.ticker === 'XLF' ? 'Financials' :
            sector.ticker === 'XLE' ? 'Energy' :
            sector.ticker === 'XLV' ? 'Healthcare' :
            sector.ticker === 'XLI' ? 'Industrials' :
            sector.ticker === 'XLP' ? 'Consumer Staples' :
            sector.ticker === 'XLY' ? 'Consumer Discretionary' :
            sector.ticker === 'XLU' ? 'Utilities' :
            sector.ticker === 'XLRE' ? 'Real Estate' :
            sector.ticker === 'XLC' ? 'Communication Services' :
            sector.ticker === 'XLB' ? 'Materials' : sector.ticker,
      ticker: sector.ticker,
      change: sector.todaysChangePerc || 0
    }));

    const gainers = (gainersData.tickers || [])
      .filter((t: any) => t.lastTrade?.p && t.lastTrade.p > 5 && t.day?.v && t.day.v > 1000000 && !t.ticker.endsWith('W'))
      .slice(0, 5)
      .map((stock: any) => ({
        name: stock.ticker,
        ticker: stock.ticker,
        change: stock.todaysChangePerc || 0
      }));

    const losers = (losersData.tickers || [])
      .filter((t: any) => t.lastTrade?.p && t.lastTrade.p > 5 && t.day?.v && t.day.v > 1000000 && !t.ticker.endsWith('W'))
      .slice(0, 5)
      .map((stock: any) => ({
        name: stock.ticker,
        ticker: stock.ticker,
        change: stock.todaysChangePerc || 0
      }));

    const advancers = sectors.filter((s: { name: string; ticker: string; change: number }) => s.change > 0).length;
    const decliners = sectors.filter((s: { name: string; ticker: string; change: number }) => s.change < 0).length;
    const ratio = decliners > 0 ? (advancers / decliners).toFixed(1) : 'N/A';

    return {
      indices,
      sectors: sectors.sort((a: { name: string; ticker: string; change: number }, b: { name: string; ticker: string; change: number }) => b.change - a.change),
      marketBreadth: { advancers, decliners, ratio },
      topGainers: gainers,
      topLosers: losers
    };
  } catch (error) {
    console.error('[QUICK STORY] Error fetching market context:', error);
    return null;
  }
}

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

// Fetch price data from Benzinga (using WGO Generator approach)
async function fetchPriceData(ticker: string) {
  const priceData = await fetchPriceDataFromBenzinga(ticker);
  if (!priceData) {
    return null;
  }
  
  const { quote, changePercent } = priceData;
  const regularClose = quote.close || quote.lastTradePrice || null;
  const previousClose = quote.previousClosePrice || quote.previous_close || null;
  
  return {
    symbol: quote.symbol || ticker,
    name: quote.name || ticker,
    lastTradePrice: quote.lastTradePrice || null,
    changePercent: changePercent ?? null,
    close: regularClose,
    previousClosePrice: previousClose,
    regularChangePercent: changePercent ?? null,
    extendedHoursPrice: quote.ethPrice || quote.extendedHoursPrice || null,
    extendedHoursChangePercent: quote.ethChangePercent || quote.extendedHoursChangePercent || null,
  };
}

// Fetch recent Benzinga articles, filtered by price action date
async function fetchRecentArticles(ticker: string, count: number = 5, priceActionDate?: Date): Promise<any[]> {
  try {
    if (!BENZINGA_API_KEY) {
      return [];
    }

    // Use price action date if provided, otherwise use current date
    const targetDate = priceActionDate || new Date();
    
    // Fetch articles from the price action date and up to 5 days before (to ensure we have enough articles)
    const dateFrom = new Date(targetDate);
    dateFrom.setDate(dateFrom.getDate() - 5);
    const dateFromStr = dateFrom.toISOString().slice(0, 10);
    
    // Set dateTo to the day after price action date to include all articles from that day
    const dateTo = new Date(targetDate);
    dateTo.setDate(dateTo.getDate() + 1);
    const dateToStr = dateTo.toISOString().slice(0, 10);

    const url = `${BZ_NEWS_URL}?token=${BENZINGA_API_KEY}&tickers=${encodeURIComponent(ticker)}&items=${count * 5}&fields=headline,title,created,url,channels,teaser,body&accept=application/json&displayOutput=full&dateFrom=${dateFromStr}&dateTo=${dateToStr}`;

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      console.error('[QUICK STORY] Failed to fetch articles:', response.status);
      return [];
    }

    const data = await response.json();
    console.log(`[QUICK STORY] API response for ${ticker}:`, {
      isArray: Array.isArray(data),
      length: Array.isArray(data) ? data.length : 'N/A',
      dateRange: `${dateFromStr} to ${dateToStr}`,
    });
    
    if (!Array.isArray(data)) {
      console.warn(`[QUICK STORY] API returned non-array response for ${ticker}`);
      return [];
    }

    // Filter out press releases and filter by date relevance
    const prChannelNames = ['press releases', 'press-releases', 'pressrelease', 'pr'];
    const normalize = (str: string) => str.toLowerCase().replace(/[-_]/g, ' ');
    
    // Get the price action date as a string for comparison (YYYY-MM-DD)
    const priceActionDateStr = targetDate.toISOString().slice(0, 10);
    
    // Get dates for comparison
    const dayBefore = new Date(targetDate);
    dayBefore.setDate(dayBefore.getDate() - 1);
    const dayBeforeStr = dayBefore.toISOString().slice(0, 10);
    
    const twoDaysBefore = new Date(targetDate);
    twoDaysBefore.setDate(twoDaysBefore.getDate() - 2);
    const twoDaysBeforeStr = twoDaysBefore.toISOString().slice(0, 10);

    let filteredArticles = data
      .filter((item: any) => {
        // Filter out press releases
        if (Array.isArray(item.channels) && item.channels.some((ch: any) =>
          typeof ch.name === 'string' && prChannelNames.includes(normalize(ch.name))
        )) {
          return false;
        }
        
        // Filter out insight stories and opinion articles
        const articleUrl = item.url || '';
        if (articleUrl.startsWith('https://www.benzinga.com/insights/')) {
          return false;
        }
        if (articleUrl.startsWith('https://www.benzinga.com/Opinion/')) {
          return false;
        }
        
        return true; // Include all articles within the date range
      })
      .sort((a: any, b: any) => {
        // Sort by date: same day as price action first, then day before, then older
        const aDate = a.created ? new Date(a.created).toISOString().slice(0, 10) : '';
        const bDate = b.created ? new Date(b.created).toISOString().slice(0, 10) : '';
        
        // Priority: same day > day before > 2 days before > older
        const getPriority = (date: string) => {
          if (date === priceActionDateStr) return 1;
          if (date === dayBeforeStr) return 2;
          if (date === twoDaysBeforeStr) return 3;
          return 4;
        };
        
        const aPriority = getPriority(aDate);
        const bPriority = getPriority(bDate);
        
        if (aPriority !== bPriority) return aPriority - bPriority;
        
        // If same priority, sort by date descending (newest first)
        return new Date(b.created || 0).getTime() - new Date(a.created || 0).getTime();
      })
      .slice(0, count)
      .map((item: any) => ({
        headline: item.headline || item.title || 'No headline',
        url: item.url || '',
        date: item.created || '',
        teaser: item.teaser || null,
      }));

    console.log(`[QUICK STORY] Fetched ${filteredArticles.length} articles for ${ticker}, price action date: ${priceActionDateStr}`);
    if (filteredArticles.length > 0) {
      console.log(`[QUICK STORY] Article dates: ${filteredArticles.map((a: any) => new Date(a.date).toISOString().slice(0, 10)).join(', ')}`);
    } else if (data.length > 0) {
      console.warn(`[QUICK STORY] ${data.length} articles returned from API but all were filtered out (likely all press releases)`);
    } else {
      console.warn(`[QUICK STORY] No articles found for ${ticker} in date range ${dateFromStr} to ${dateToStr}`);
    }

    // Fallback: If no articles found in the date range, try a wider range (30 days)
    if (filteredArticles.length === 0) {
      console.log(`[QUICK STORY] No articles found in 5-day range, trying 30-day range for ${ticker}`);
      const fallbackDateFrom = new Date(targetDate);
      fallbackDateFrom.setDate(fallbackDateFrom.getDate() - 30);
      const fallbackDateFromStr = fallbackDateFrom.toISOString().slice(0, 10);
      
      const fallbackUrl = `${BZ_NEWS_URL}?token=${BENZINGA_API_KEY}&tickers=${encodeURIComponent(ticker)}&items=${count * 5}&fields=headline,title,created,url,channels,teaser&accept=application/json&displayOutput=full&dateFrom=${fallbackDateFromStr}&dateTo=${dateToStr}`;
      
      try {
        const fallbackResponse = await fetch(fallbackUrl, {
          headers: { Accept: 'application/json' },
        });
        
        if (fallbackResponse.ok) {
          const fallbackData = await fallbackResponse.json();
          if (Array.isArray(fallbackData) && fallbackData.length > 0) {
            console.log(`[QUICK STORY] Found ${fallbackData.length} articles in 30-day range`);
            
            filteredArticles = fallbackData
              .filter((item: any) => {
                // Filter out press releases
                if (Array.isArray(item.channels) && item.channels.some((ch: any) =>
                  typeof ch.name === 'string' && prChannelNames.includes(normalize(ch.name))
                )) {
                  return false;
                }
                
                // Filter out insight stories and opinion articles
                const articleUrl = item.url || '';
                if (articleUrl.startsWith('https://www.benzinga.com/insights/')) {
                  return false;
                }
                if (articleUrl.startsWith('https://www.benzinga.com/Opinion/')) {
                  return false;
                }
                
                return true;
              })
              .sort((a: any, b: any) => {
                // Sort by date descending (newest first)
                return new Date(b.created || 0).getTime() - new Date(a.created || 0).getTime();
              })
              .slice(0, count)
              .map((item: any) => ({
                headline: item.headline || item.title || 'No headline',
                url: item.url || '',
                date: item.created || '',
                teaser: item.teaser || null,
              }));
            
            console.log(`[QUICK STORY] Using ${filteredArticles.length} articles from fallback search`);
          }
        }
      } catch (fallbackError) {
        console.error(`[QUICK STORY] Fallback search failed for ${ticker}:`, fallbackError);
      }
    }

    return filteredArticles;
  } catch (error) {
    console.error('[QUICK STORY] Error fetching articles:', error);
    return [];
  }
}

// Fetch simplified technical data (RSI, MACD, moving averages, company description)
async function fetchSimplifiedTechnicalData(ticker: string) {
  try {
    const POLYGON_API_KEY = process.env.POLYGON_API_KEY;
    if (!POLYGON_API_KEY) {
      return null;
    }

    const [overviewRes, rsiRes, macdRes, sma20Res, sma100Res] = await Promise.all([
      fetch(`https://api.polygon.io/v3/reference/tickers/${ticker}?apikey=${POLYGON_API_KEY}`),
      fetch(`https://api.polygon.io/v1/indicators/rsi?ticker=${ticker}&timespan=day&adjusted=true&window=14&series_type=close&order=desc&limit=1&apikey=${POLYGON_API_KEY}`),
      fetch(`https://api.polygon.io/v1/indicators/macd?ticker=${ticker}&timespan=day&adjusted=true&short_window=12&long_window=26&signal_window=9&series_type=close&order=desc&limit=1&apikey=${POLYGON_API_KEY}`),
      fetch(`https://api.polygon.io/v1/indicators/sma?ticker=${ticker}&timespan=day&adjusted=true&window=20&series_type=close&order=desc&limit=1&apikey=${POLYGON_API_KEY}`),
      fetch(`https://api.polygon.io/v1/indicators/sma?ticker=${ticker}&timespan=day&adjusted=true&window=100&series_type=close&order=desc&limit=1&apikey=${POLYGON_API_KEY}`),
    ]);

    let description = null;
    if (overviewRes.ok) {
      const overviewData = await overviewRes.json();
      description = overviewData?.results?.description || null;
    }

    let rsi = null;
    if (rsiRes.ok) {
      const rsiData = await rsiRes.json();
      if (rsiData?.results?.values?.[0]?.value) {
        rsi = rsiData.results.values[0].value;
      }
    }

    let macd = null;
    let macdSignal = null;
    if (macdRes.ok) {
      const macdData = await macdRes.json();
      if (macdData?.results?.values?.[0]) {
        macd = macdData.results.values[0].value;
        macdSignal = macdData.results.values[0].signal;
      }
    }

    let sma20 = null;
    if (sma20Res.ok) {
      const sma20Data = await sma20Res.json();
      if (sma20Data?.results?.values?.[0]?.value) {
        sma20 = sma20Data.results.values[0].value;
      }
    }

    let sma100 = null;
    if (sma100Res.ok) {
      const sma100Data = await sma100Res.json();
      if (sma100Data?.results?.values?.[0]?.value) {
        sma100 = sma100Data.results.values[0].value;
      }
    }

    return { description, rsi, macd, macdSignal, sma20, sma100 };
  } catch (error) {
    console.error(`[QUICK STORY] Error fetching technical data for ${ticker}:`, error);
    return null;
  }
}

// Fetch recent analyst actions
async function fetchRecentAnalystActions(ticker: string, limit: number = 3) {
  try {
    if (!BENZINGA_API_KEY) return [];
    const analystUrl = `https://api.benzinga.com/api/v2.1/calendar/ratings?token=${BENZINGA_API_KEY}&parameters[tickers]=${encodeURIComponent(ticker)}&parameters[range]=6m`;
    const analystRes = await fetch(analystUrl, { headers: { Accept: 'application/json' } });
    if (!analystRes.ok) return [];
    
    const analystData = await analystRes.json();
    const ratingsArray = Array.isArray(analystData) ? analystData : (analystData.ratings || []);
    
    return ratingsArray
      .sort((a: any, b: any) => {
        const dateA = new Date(a.date || a.created || 0).getTime();
        const dateB = new Date(b.date || b.created || 0).getTime();
        return dateB - dateA;
      })
      .slice(0, limit)
      .map((rating: any) => {
        const firm = rating.analyst || rating.firm || 'Unknown Firm';
        const actionCompany = rating.action_company || rating.action || '';
        const currentRating = rating.rating_current || rating.rating || '';
        const priceTarget = rating.adjusted_pt_current || rating.pt_current || rating.pt || null;
        const actionPt = rating.action_pt || null;
        
        let actionText = '';
        const actionLower = actionCompany.toLowerCase();
        if (actionLower.includes('downgrade')) {
          actionText = `Downgraded to ${currentRating}`;
        } else if (actionLower.includes('upgrade')) {
          actionText = `Upgraded to ${currentRating}`;
        } else if (actionLower.includes('initiate') || actionLower.includes('reinstated')) {
          actionText = `Initiated with ${currentRating}`;
        } else if (currentRating) {
          actionText = `${currentRating}`;
        }
        
        if (priceTarget && actionPt) {
          const direction = actionPt.charAt(0).toUpperCase() + actionPt.slice(1).toLowerCase();
          actionText += ` (${direction} Target to $${priceTarget})`;
        } else if (priceTarget) {
          actionText += ` (Target $${priceTarget})`;
        }
        
        return { firm, action: actionText, date: rating.date || rating.created || null };
      });
  } catch (error) {
    console.error(`[QUICK STORY] Error fetching analyst actions for ${ticker}:`, error);
    return [];
  }
}

// Fetch Benzinga Edge rankings
async function fetchEdgeRankings(ticker: string) {
  try {
    const BENZINGA_EDGE_API_KEY = process.env.BENZINGA_EDGE_API_KEY;
    if (!BENZINGA_EDGE_API_KEY) return null;
    const url = `https://data-api-next.benzinga.com/rest/v3/tickerDetail?apikey=${BENZINGA_EDGE_API_KEY}&symbols=${encodeURIComponent(ticker)}`;
    const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!response.ok) return null;
    
    const data = await response.json();
    if (data.result && Array.isArray(data.result) && data.result.length > 0) {
      const tickerData = data.result[0];
      if (tickerData.rankings && typeof tickerData.rankings === 'object') {
        const getRankingValue = (obj: any, prefix: string): number | null => {
          if (obj[prefix] !== undefined && obj[prefix] !== null && typeof obj[prefix] === 'number') return obj[prefix];
          if (obj[`${prefix}_score`] !== undefined && obj[`${prefix}_score`] !== null && typeof obj[`${prefix}_score`] === 'number') return obj[`${prefix}_score`];
          return null;
        };
        const edgeData = {
          ticker: ticker.toUpperCase(),
          value_rank: getRankingValue(tickerData.rankings, 'value'),
          growth_rank: getRankingValue(tickerData.rankings, 'growth'),
          quality_rank: getRankingValue(tickerData.rankings, 'quality'),
          momentum_rank: getRankingValue(tickerData.rankings, 'momentum'),
        };
        if (edgeData.value_rank !== null || edgeData.growth_rank !== null || edgeData.quality_rank !== null || edgeData.momentum_rank !== null) {
          return edgeData;
        }
      }
    }
    return null;
  } catch (error) {
    console.error(`[QUICK STORY] Error fetching Edge rankings for ${ticker}:`, error);
    return null;
  }
}

// Fetch consensus ratings from Benzinga
async function fetchConsensusRatings(ticker: string) {
  try {
    if (!BENZINGA_API_KEY) {
      return null;
    }

    const params = new URLSearchParams();
    params.append('token', BENZINGA_API_KEY);
    params.append('parameters[tickers]', ticker);
    
    const consensusUrl = `https://api.benzinga.com/api/v1/consensus-ratings?${params.toString()}`;
    
    const consensusRes = await fetch(consensusUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
    });
      
    if (consensusRes.ok) {
      const consensusData = await consensusRes.json();
      
      let extractedConsensus = null;
      
      if (Array.isArray(consensusData)) {
        extractedConsensus = consensusData.find((item: any) => 
          item.ticker?.toUpperCase() === ticker.toUpperCase() || 
          item.symbol?.toUpperCase() === ticker.toUpperCase()
        ) || consensusData[0];
      } else if (consensusData.consensus) {
        extractedConsensus = consensusData.consensus;
      } else if (consensusData[ticker.toUpperCase()]) {
        extractedConsensus = consensusData[ticker.toUpperCase()];
      } else if (consensusData.ratings && Array.isArray(consensusData.ratings)) {
        extractedConsensus = consensusData.ratings.find((item: any) => 
          item.ticker?.toUpperCase() === ticker.toUpperCase() || 
          item.symbol?.toUpperCase() === ticker.toUpperCase()
        ) || consensusData.ratings[0];
      } else {
        extractedConsensus = consensusData;
      }
      
      if (extractedConsensus) {
        const consensusPriceTarget = 
          extractedConsensus.consensus_price_target ?? 
          extractedConsensus.consensusPriceTarget ??
          extractedConsensus.price_target ??
          extractedConsensus.priceTarget ??
          extractedConsensus.target ??
          extractedConsensus.pt ??
          extractedConsensus.consensus_target ??
          null;
        
        return {
          consensus_rating: extractedConsensus.consensus_rating || extractedConsensus.consensusRating || extractedConsensus.rating || null,
          consensus_price_target: consensusPriceTarget,
          total_analyst_count: extractedConsensus.total_analyst_count || extractedConsensus.totalAnalystCount || extractedConsensus.analyst_count || extractedConsensus.count || null,
        };
      }
    }
    
    return null;
  } catch (error) {
    console.error(`[QUICK STORY] Error fetching consensus ratings for ${ticker}:`, error);
    return null;
  }
}

// Fetch most recent earnings results (with actuals) or upcoming earnings (with estimates)
async function fetchRecentEarningsResults(ticker: string) {
  try {
    if (!BENZINGA_API_KEY) {
      return null;
    }

    const today = new Date();
    const dateTo = today.toISOString().split('T')[0];
    const dateFrom = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // Last 90 days
    const dateToUpcoming = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // Next 90 days

    // Fetch both past and upcoming earnings
    const url = 'https://api.benzinga.com/api/v2/calendar/earnings' +
      `?token=${BENZINGA_API_KEY}` +
      `&parameters[tickers]=${encodeURIComponent(ticker)}` +
      `&parameters[date_from]=${dateFrom}` +
      `&parameters[date_to]=${dateToUpcoming}`;

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

    // Find the most recent earnings with actual results (past earnings)
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

    // If we have recent earnings with actuals, use that
    if (earningsWithActuals.length > 0) {
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

      console.log(`[QUICK STORY] Found recent earnings with actuals for ${ticker}, date: ${earningsDate}`);
      
      return {
        type: 'recent',
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
    }

    // If no recent earnings with actuals, look for upcoming earnings with estimates
    const upcomingEarnings = data.earnings
      .filter((item: any) => {
        const earningsDate = item.date || item.earnings_date || item.earningsDate;
        if (!earningsDate) return false;
        
        // Check if this earnings has estimates
        const hasEstimates = (item.eps_est || item.epsEst || item.eps_estimate || item.epsEstimate || item.estimated_eps) ||
                           (item.revenue_est || item.revenueEst || item.revenue_estimate || item.revenueEstimate || item.estimated_revenue);
        
        if (!hasEstimates) return false;
        
        // Only include future earnings
        const date = new Date(earningsDate);
        return date > today;
      })
      .sort((a: any, b: any) => {
        const dateA = new Date(a.date || a.earnings_date || a.earningsDate || 0);
        const dateB = new Date(b.date || b.earnings_date || b.earningsDate || 0);
        return dateA.getTime() - dateB.getTime(); // Earliest upcoming first
      });

    if (upcomingEarnings.length > 0) {
      const nextEarnings = upcomingEarnings[0];
      const earningsDate = nextEarnings.date || nextEarnings.earnings_date || nextEarnings.earningsDate;
      
      const epsEst = nextEarnings.eps_est || nextEarnings.epsEst || nextEarnings.eps_estimate || 
                    nextEarnings.epsEstimate || nextEarnings.estimated_eps || null;
      const epsPrior = nextEarnings.eps_prior || nextEarnings.epsPrior || nextEarnings.eps_prev || 
                      nextEarnings.previous_eps || null;
      
      const revenueEst = nextEarnings.revenue_est || nextEarnings.revenueEst || nextEarnings.revenue_estimate || 
                        nextEarnings.revenueEstimate || nextEarnings.estimated_revenue || null;
      const revenuePrior = nextEarnings.revenue_prior || nextEarnings.revenuePrior || nextEarnings.rev_prev || 
                          nextEarnings.previous_revenue || null;

      console.log(`[QUICK STORY] Found upcoming earnings with estimates for ${ticker}, date: ${earningsDate}`);
      
      return {
        type: 'upcoming',
        date: earningsDate,
        eps_estimate: epsEst,
        eps_prior: epsPrior,
        revenue_estimate: revenueEst,
        revenue_prior: revenuePrior,
      };
    }

    return null;
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
// Get the date when price action occurred (previous trading day if early morning)
function getPriceActionDate(): { date: Date; dayName: string; isToday: boolean; isYesterday: boolean; temporalContext: string } {
  const now = new Date();
  
  // Get ET time components
  const etFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    weekday: 'long',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour12: false,
  });
  
  const parts = etFormatter.formatToParts(now);
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  const dayOfWeek = parts.find(p => p.type === 'weekday')?.value || 'Monday';
  const day = parseInt(parts.find(p => p.type === 'day')?.value || '1', 10);
  const month = parseInt(parts.find(p => p.type === 'month')?.value || '1', 10);
  const year = parseInt(parts.find(p => p.type === 'year')?.value || '2024', 10);
  
  const time = hour * 100 + minute;
  
  // If it's before 9:30 AM ET, the price action is from the previous trading day
  let priceActionDate = new Date(year, month - 1, day);
  let isToday = true;
  let isYesterday = false;
  
  if (time < 930) {
    // Before market open, price action is from yesterday
    priceActionDate.setDate(priceActionDate.getDate() - 1);
    isToday = false;
    isYesterday = true;
    
    // If yesterday was Sunday, go back to Friday
    if (priceActionDate.getDay() === 0) {
      priceActionDate.setDate(priceActionDate.getDate() - 2);
    }
    // If yesterday was Saturday, go back to Friday
    if (priceActionDate.getDay() === 6) {
      priceActionDate.setDate(priceActionDate.getDate() - 1);
    }
  }
  
  const dayName = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
  }).format(priceActionDate);
  
  let temporalContext = '';
  if (isToday && time >= 930 && time < 1600) {
    temporalContext = 'earlier today during regular trading hours';
  } else if (isToday && time >= 1600) {
    temporalContext = 'today';
  } else if (isYesterday) {
    temporalContext = 'yesterday';
  } else {
    temporalContext = `on ${dayName}`;
  }
  
  return {
    date: priceActionDate,
    dayName,
    isToday,
    isYesterday,
    temporalContext,
  };
}

function formatPriceAction(quote: any, ticker: string): string {
  if (!quote || !quote.lastTradePrice) {
    return '';
  }

  const symbol = quote.symbol || ticker.toUpperCase();
  const companyName = quote.name || symbol;
  const marketSession = getMarketSession();
  const priceActionDate = getPriceActionDate();
  const dayOfWeek = priceActionDate.dayName;
  
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
  
  // Build price action text with temporal context
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

// Get temporal context for prompt
function getTemporalContext(): string {
  const priceActionDate = getPriceActionDate();
  const now = new Date();
  const etTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour = etTime.getHours();
  const minute = etTime.getMinutes();
  const time = hour * 100 + minute;
  
  let context = '';
  if (priceActionDate.isToday && time >= 930 && time < 1600) {
    context = 'The price action occurred earlier today during regular trading hours.';
  } else if (priceActionDate.isToday && time >= 1600) {
    context = 'The price action occurred today.';
  } else if (priceActionDate.isYesterday) {
    context = 'The price action occurred yesterday (the previous trading day).';
  } else {
    context = `The price action occurred on ${priceActionDate.dayName} (the previous trading day).`;
  }
  
  return context;
}

// Format earnings data for prompt
function formatEarningsData(earnings: any, consensusRatings?: any): string {
  if (!earnings) return '';

  const formatRevenue = (val: number | string | null) => {
    if (val === null || val === undefined) return 'N/A';
    const num = typeof val === 'string' ? parseFloat(val) : val;
    if (isNaN(num)) return 'N/A';
    const millions = num / 1000000;
    if (millions >= 1000) {
      return `$${(millions / 1000).toFixed(2)}B`;
    }
    return `$${millions.toFixed(2)}M`;
  };

  // Format earnings date for display
  const formatEarningsDate = (dateStr: string | null | undefined): string => {
    if (!dateStr) return 'N/A';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  let text = '\n\nEARNINGS DATA:\n';
  
  if (earnings.type === 'recent') {
    // Recent earnings with actual results
    const formattedDate = formatEarningsDate(earnings.date);
    text += `Earnings Report Date: ${formattedDate}\n`;
    text += `Status: RECENT REPORT (Actual results available)\n`;
    text += `CRITICAL: You MUST use the exact date "${formattedDate}" in your first paragraph when mentioning the earnings report. DO NOT use "recently" or vague date references - use the actual date.\n\n`;

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
        text += ` (Prior Period: $${prior})`;
      }
      text += '\n';
    }

    if (earnings.revenue_actual !== null && earnings.revenue_estimate !== null) {
      text += `Revenue: Reported ${formatRevenue(earnings.revenue_actual)} vs. Estimate ${formatRevenue(earnings.revenue_estimate)}`;
      if (earnings.revenue_beat_miss) {
        text += ` (${earnings.revenue_beat_miss})`;
      }
      if (earnings.revenue_surprise_pct !== null) {
        const surprise = earnings.revenue_surprise_pct > 0 ? '+' : '';
        text += ` - ${surprise}${earnings.revenue_surprise_pct.toFixed(1)}% surprise`;
      }
      if (earnings.revenue_prior !== null) {
        text += ` (Prior Period: ${formatRevenue(earnings.revenue_prior)})`;
      }
      text += '\n';
    }
  } else if (earnings.type === 'upcoming') {
    // Upcoming earnings with estimates
    const formattedDate = formatEarningsDate(earnings.date);
    text += `Upcoming Earnings Date: ${formattedDate}\n`;
    text += `Status: UPCOMING REPORT (Estimates only)\n`;
    text += `CRITICAL: You MUST use the exact date "${formattedDate}" in your first paragraph when mentioning the upcoming earnings report. DO NOT use "recently" or vague date references - use the actual date.\n\n`;

    if (earnings.eps_estimate !== null) {
      const epsEst = typeof earnings.eps_estimate === 'string' 
        ? parseFloat(earnings.eps_estimate).toFixed(2) 
        : earnings.eps_estimate.toFixed(2);
      
      text += `EPS Estimate: $${epsEst}`;
      if (earnings.eps_prior !== null) {
        const prior = typeof earnings.eps_prior === 'string' 
          ? parseFloat(earnings.eps_prior).toFixed(2) 
          : earnings.eps_prior.toFixed(2);
        const change = parseFloat(epsEst) - parseFloat(prior);
        const changePct = prior != 0 ? ((change / Math.abs(parseFloat(prior))) * 100) : 0;
        const changeText = change > 0 ? `up ${changePct.toFixed(1)}%` : change < 0 ? `down ${Math.abs(changePct).toFixed(1)}%` : 'unchanged';
        text += ` (${changeText} from prior period: $${prior})`;
      }
      text += '\n';
    }

    if (earnings.revenue_estimate !== null) {
      text += `Revenue Estimate: ${formatRevenue(earnings.revenue_estimate)}`;
      if (earnings.revenue_prior !== null) {
        const priorNum = typeof earnings.revenue_prior === 'string' ? parseFloat(earnings.revenue_prior) : earnings.revenue_prior;
        const estNum = typeof earnings.revenue_estimate === 'string' ? parseFloat(earnings.revenue_estimate) : earnings.revenue_estimate;
        const change = estNum - priorNum;
        const changePct = priorNum != 0 ? ((change / Math.abs(priorNum)) * 100) : 0;
        const changeText = change > 0 ? `up ${changePct.toFixed(1)}%` : change < 0 ? `down ${Math.abs(changePct).toFixed(1)}%` : 'unchanged';
        text += ` (${changeText} from prior period: ${formatRevenue(earnings.revenue_prior)})`;
      }
      text += '\n';
    }

    // Add analyst consensus if available
    if (consensusRatings) {
      text += '\nAnalyst Consensus:\n';
      if (consensusRatings.consensus_rating) {
        text += `Consensus Rating: ${consensusRatings.consensus_rating}\n`;
      }
      if (consensusRatings.consensus_price_target) {
        const target = typeof consensusRatings.consensus_price_target === 'string' 
          ? parseFloat(consensusRatings.consensus_price_target).toFixed(2)
          : consensusRatings.consensus_price_target.toFixed(2);
        text += `Consensus Price Target: $${target}\n`;
      }
      if (consensusRatings.total_analyst_count) {
        text += `Analyst Coverage: ${consensusRatings.total_analyst_count} analysts\n`;
      }
    }
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
  priceData?: any,
  consensusRatings?: any,
  customSourceUrls?: string[],
  customSourceContent?: Record<string, string>,
  technicalData?: any,
  analystActions?: any[],
  edgeRankings?: any
): string {
  const templateInfo = STORY_TEMPLATES[template as keyof typeof STORY_TEMPLATES] || STORY_TEMPLATES['price-movement'];
  const focus = template === 'custom' && customFocus ? customFocus : templateInfo.focus;

  // Build custom source verification section if custom template
  let customSourceVerification = '';
  if (template === 'custom') {
    if (customSourceUrls && customSourceUrls.length > 0) {
      customSourceVerification = `\n\nCUSTOM SOURCE URLS FOR VERIFICATION (CRITICAL: Use specific details from these sources):\n`;
      customSourceUrls.forEach((url, index) => {
        customSourceVerification += `${index + 1}. ${url}\n`;
        if (customSourceContent && customSourceContent[url]) {
          // Include more content (up to 3000 chars) and emphasize using specific details
          const content = customSourceContent[url].substring(0, 3000);
          customSourceVerification += `   SOURCE CONTENT (USE SPECIFIC DETAILS FROM THIS): ${content}${customSourceContent[url].length > 3000 ? '...' : ''}\n`;
          customSourceVerification += `   IMPORTANT: Extract and use SPECIFIC details, capabilities, features, quotes, or claims from this source content. Do NOT just summarize - include concrete details.\n`;
        } else {
          customSourceVerification += `   NOTE: Source content not available - verify information from articles and API data only.\n`;
        }
      });
      
      // Add hyperlink requirement for source URLs
      const benzingaUrls = customSourceUrls.filter(url => url.includes('benzinga.com'));
      const nonBenzingaUrls = customSourceUrls.filter(url => !url.includes('benzinga.com'));
      
      if (benzingaUrls.length > 0) {
        customSourceVerification += `\n🚨 HYPERLINK REQUIREMENT FOR BENZINGA SOURCES (MANDATORY) 🚨:\n`;
        benzingaUrls.forEach(url => {
          customSourceVerification += `- You MUST hyperlink "${url}" in your LEAD paragraph using natural text (3 sequential words from the article/page title or content)\n`;
          customSourceVerification += `- Format: <a href="${url}">three sequential words</a>\n`;
          customSourceVerification += `- This is MANDATORY - the hyperlink MUST appear in the first paragraph\n`;
        });
      }
      
      if (nonBenzingaUrls.length > 0) {
        customSourceVerification += `\n🚨 CITATION REQUIREMENT FOR NON-BENZINGA SOURCES (MANDATORY) 🚨:\n`;
        nonBenzingaUrls.forEach(url => {
          customSourceVerification += `- You MUST cite and hyperlink "${url}" in your SECOND paragraph (not the lead) using natural text\n`;
          customSourceVerification += `- Format: <a href="${url}">three sequential words</a>\n`;
          customSourceVerification += `- Example: "According to Google's announcement, Project Genie..." where "Google's announcement" is hyperlinked to ${url}\n`;
          customSourceVerification += `- This is MANDATORY - the hyperlink MUST appear in the second paragraph\n`;
        });
      }
    }
    customSourceVerification += `\n\nCRITICAL VERIFICATION REQUIREMENTS FOR CUSTOM TEMPLATE:\n`;
    customSourceVerification += `- Before using ANY information from custom focus, you MUST verify it matches information in:\n`;
    customSourceVerification += `  1. Articles listed below (MOST AUTHORITATIVE - use these as primary source)\n`;
    customSourceVerification += `  2. API data provided above (price, earnings, consensus)\n`;
    if (customSourceUrls && customSourceUrls.length > 0) {
      customSourceVerification += `  3. Scraped source content above (if URLs provided)\n`;
    }
    customSourceVerification += `- If custom focus contains information that CANNOT be verified from these sources:\n`;
    customSourceVerification += `  * DO NOT use it, OR\n`;
    if (customSourceUrls && customSourceUrls.length > 0) {
      customSourceVerification += `  * If a source URL is provided, use it but note: "according to [source]"\n`;
    } else {
      customSourceVerification += `  * Mark it as unverified or omit it\n`;
    }
    customSourceVerification += `- If information in custom focus CONFLICTS with articles/API data, use the articles/API data (they are authoritative)\n`;
    customSourceVerification += `- Example: If custom focus says "Project Marcus" but articles say "Project Genie", use "Project Genie" from articles\n`;
    customSourceVerification += `- Information Hierarchy (most authoritative first):\n`;
    customSourceVerification += `  1. API data (price, earnings, consensus) - ALWAYS use this\n`;
    customSourceVerification += `  2. Articles listed below - ALWAYS use this\n`;
    if (customSourceUrls && customSourceUrls.length > 0) {
      customSourceVerification += `  3. Scraped source content (if URLs provided) - Use this\n`;
      customSourceVerification += `  4. Custom focus text - ONLY use if verified by sources above\n`;
    } else {
      customSourceVerification += `  3. Custom focus text - ONLY use if verified by sources above\n`;
    }
    customSourceVerification += `\n`;
  }

  let articlesText = '';
  console.log(`[QUICK STORY] buildPrompt: articles.length = ${articles.length}`);
  if (articles.length > 0) {
    const priceActionDate = getPriceActionDate();
    const priceActionDateStr = priceActionDate.date.toISOString().slice(0, 10);
    
    console.log(`[QUICK STORY] buildPrompt: Building articlesText for ${articles.length} articles`);
    articlesText = `\n\n🚨 RECENT BENZINGA ARTICLES (MANDATORY: You MUST create a hyperlink for ALL ${articles.length} articles below - include each one in your story) 🚨:\n`;
    articlesText += `IMPORTANT: The price action occurred on ${priceActionDate.dayName}. Articles are listed below with their publication dates.\n`;
    articlesText += `CRITICAL TEMPORAL CONTEXT RULES:\n`;
    articlesText += `- Articles marked "[SAME DAY AS PRICE ACTION]" are reporting on events from ${priceActionDate.dayName} - you can reference the day if relevant\n`;
    articlesText += `- Articles marked "[X DAYS BEFORE PRICE ACTION]" are providing context about events that happened BEFORE the article was published - use vague temporal references like "recently", "earlier this week", "in recent days", "earlier" - DO NOT use the article's publication day name (e.g., "on Monday") as that refers to when the article was published, not when the event happened\n\n`;
    
    articles.forEach((article, index) => {
      console.log(`[QUICK STORY] buildPrompt: Processing article ${index + 1}/${articles.length}:`, {
        headline: article.headline || article.title || 'NO HEADLINE',
        url: article.url || 'NO URL',
        date: article.date || article.created || 'NO DATE',
        hasTeaser: !!article.teaser
      });
      
      const articleDate = article.date ? new Date(article.date) : null;
      const articleDateStr = articleDate ? articleDate.toISOString().slice(0, 10) : '';
      const articleDayName = articleDate ? new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(articleDate) : 'Unknown date';
      
      // Determine if article is from same day, day before, or older
      let dateContext = '';
      if (articleDateStr === priceActionDateStr) {
        dateContext = `[SAME DAY AS PRICE ACTION - ${priceActionDate.dayName}]`;
      } else {
        const daysDiff = Math.floor((priceActionDate.date.getTime() - (articleDate?.getTime() || 0)) / (1000 * 60 * 60 * 24));
        if (daysDiff === 1) {
          dateContext = `[1 DAY BEFORE PRICE ACTION]`;
        } else if (daysDiff > 1) {
          dateContext = `[${daysDiff} DAYS BEFORE PRICE ACTION - MUST PROVIDE TEMPORAL CONTEXT]`;
        }
      }
      
      const headline = article.headline || article.title || 'NO HEADLINE';
      const url = article.url || 'NO URL';
      
      articlesText += `${index + 1}. ${headline}: ${url}\n   Published: ${articleDayName} ${dateContext}`;
      
      // Include teaser if available
      if (article.teaser) {
        articlesText += `\n   Teaser: ${article.teaser}`;
      }
      
      // Include article body content (up to 2000 characters) for detailed context
      if (article.body) {
        const bodyContent = article.body.length > 2000 
          ? article.body.substring(0, 2000) + '...' 
          : article.body;
        articlesText += `\n   Full Content: ${bodyContent}`;
      } else if (article.teaser) {
        // If no body, use full teaser
        articlesText += `\n   Content: ${article.teaser}`;
      }
      
      articlesText += '\n\n';
    });
    
    console.log(`[QUICK STORY] buildPrompt: articlesText length: ${articlesText.length} characters`);
    articlesText += `\n\n🚨 CRITICAL ARTICLE CONTENT EXTRACTION REQUIREMENTS (HIGHEST PRIORITY) 🚨:
- You MUST extract and use SPECIFIC DETAILS from the article content provided above
- DO NOT just summarize - pull out specific numbers, quotes, dates, names, percentages, dollar amounts, and concrete facts
- Include direct quotes from executives, analysts, or sources when available in the articles
- Extract specific context, background information, and details that explain WHY things are happening
- Use the FULL article content (not just the headline or teaser) to provide rich, detailed context
- Every paragraph should include specific details pulled from the articles - avoid generic statements

🚨 CRITICAL HYPERLINK REQUIREMENTS (MANDATORY) 🚨:
- You MUST create a hyperlink for ALL ${articles.length} articles listed above - NO EXCEPTIONS
- At least ONE hyperlink MUST appear in your FIRST paragraph (the lead paragraph) - THIS IS MANDATORY
- Format: <a href="URL">three sequential words</a> (use HTML format, NOT markdown)
- HYPERLINK TEXT SELECTION RULES (CRITICAL):
  * You may use words from the article headline as inspiration, BUT the hyperlink text MUST flow naturally in your sentence
  * DO NOT use headline fragments that don't make grammatical sense in context (e.g., if headline is "Gold, Silver Are Surging", don't hyperlink "Gold, Silver Are" - that's a headline fragment)
  * DO NOT use the exact headline text as your hyperlink (e.g., if headline is "Can You Buy NASA Stock?", don't hyperlink "Can You Buy NASA Stock?")
  * DO NOT use generic phrases like "recent reports", "according to reports", "recent news", etc. as hyperlink text
  * The hyperlink text should read as a natural part of your sentence, NOT as a headline fragment
  * If the first three words of a headline don't flow naturally, choose different words from the headline or rephrase
  * The hyperlink text must make grammatical sense in the context of your sentence
  * Example: If headline is "Gold, Silver Are Surging to Record Highs", you could hyperlink "record highs" or "surging to record" - NOT "Gold, Silver Are"
  * Example: If headline is "Tariff Fears Reignite on Canada Trade", you could hyperlink "trade tensions" or "tariff concerns" - NOT "Tariff Fears Reignite"
- Embed hyperlinks naturally throughout the article - distribute them across different paragraphs
- Count your hyperlinks before submitting: you need exactly ${articles.length} hyperlinks total
- VALIDATION: Before submitting, verify you have exactly ${articles.length} hyperlinks in your article
- CRITICAL: Write naturally as a journalist - DO NOT explicitly reference articles or reports
- DO NOT use phrases like "as reported", "as discussed", "according to a report", "as covered in an article", "this article", "the report", "in a report", "recent reports", "according to reports", "recent news", etc.
- Simply write the narrative and embed hyperlinks seamlessly within the text - the hyperlink text should flow naturally as part of the sentence
- For older articles (marked "[X DAYS BEFORE PRICE ACTION]"): These articles provide context about events that happened earlier. Use vague temporal references like "recently", "earlier this week", "in recent days", "earlier", etc. - DO NOT use the specific day name (e.g., "on Monday") as the article is reporting on events that occurred before its publication date. The day name refers to when the article was published, not when the event happened.
- Example of GOOD hyperlink embedding: "The company's stock rebounded following a major hardware delivery for its upcoming Neutron rocket."
- Example of BAD hyperlink embedding: "Meta and other Gold, Silver Are social media giants" (headline fragment doesn't flow)
- Example of BAD hyperlink embedding: "factors such as tariff fears reigniting on Canada" (headline fragment doesn't flow)
- Example of BAD hyperlink embedding: "This development was covered in a Rocket Lab Stock Rebounds article."
- Example of BAD hyperlink embedding: "Recent reports indicate the company is expanding."
- Example of BAD hyperlink embedding: "Can You Buy NASA Stock? explores investment options."
- REMINDER: If you fail to include all ${articles.length} hyperlinks, your article will be rejected and regenerated.\n`;
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
    earningsText = formatEarningsData(earningsData, consensusRatings);
  }

  // Technical data removed - will be added in a second step

  // Analyst data removed - only include if mentioned in Benzinga articles

  // Edge rankings removed - will be added in a second step

  const temporalContext = getTemporalContext();
  const priceActionDate = getPriceActionDate();
  
  return `You are a financial journalist writing a ${wordCount}-word article about ${companyName} (${ticker}).

${focus}
${customSourceVerification}
CURRENT PRICE ACTION:
${priceAction || 'Price data not available'}
${temporalContext}
IMPORTANT: The price action occurred on ${priceActionDate.dayName}. Always refer to this day by name (e.g., "on ${priceActionDate.dayName}") rather than using relative terms like "yesterday" or "today".
${priceData && priceData.extendedHoursPrice && priceData.extendedHoursChangePercent !== null ? `\nNOTE: The stock closed ${priceData.regularChangePercent > 0 ? 'up' : 'down'} ${Math.abs(priceData.regularChangePercent || 0).toFixed(2)}% during regular trading hours, but is ${priceData.extendedHoursChangePercent > 0 ? 'up' : 'down'} ${Math.abs(priceData.extendedHoursChangePercent).toFixed(2)}% in after-hours trading. When describing the stock movement, mention both the regular session performance and after-hours movement if they differ significantly.` : ''}
${earningsText}
${articlesText}
${customSourceUrls && customSourceUrls.length > 0 ? `\n\n🚨 SOURCE URL HYPERLINK REQUIREMENT (MANDATORY) 🚨:
${customSourceUrls.filter((url: string) => !url.includes('benzinga.com')).length > 0 ? `- You MUST hyperlink the source URL(s) provided above in your SECOND paragraph (not the lead)
- Format: <a href="SOURCE_URL">natural text from source</a>
- Example: "According to <a href="${customSourceUrls.find((url: string) => !url.includes('benzinga.com')) || ''}">Google's announcement</a>, Project Genie..."
- This is MANDATORY - the source URL hyperlink MUST appear in the second paragraph\n` : ''}
${customSourceUrls.filter((url: string) => url.includes('benzinga.com')).length > 0 ? `- You MUST hyperlink the Benzinga source URL(s) provided above in your LEAD paragraph
- Format: <a href="SOURCE_URL">natural text from source</a>
- This is MANDATORY - the source URL hyperlink MUST appear in the first paragraph\n` : ''}
` : ''}

${relatedStocksText}

REQUIREMENTS:
${template === 'earnings-reaction' && earningsData ? `
EARNINGS REACTION TEMPLATE - CRITICAL INSTRUCTIONS:
- This is an EARNINGS REACTION story - the earnings data provided above MUST be prominently featured
- CRITICAL: You MUST include the exact earnings date (e.g., "on November 10" or "on November 10, 2025") in your FIRST paragraph - DO NOT use "recently" or vague date references
- If earnings data shows "RECENT REPORT": Lead with the actual EPS and revenue results, beats/misses, and surprise percentages, and include the exact report date
- If earnings data shows "UPCOMING REPORT": Lead with the estimates, analyst expectations, and comparisons to prior periods, and include the exact earnings date
- Include specific numbers: EPS ($X.XX), Revenue ($X.XXB or $X.XXM), beat/miss status, surprise percentages
- Compare to estimates and prior periods when available
- Analyst consensus data (if provided) should be mentioned to provide context
- The earnings data is the PRIMARY focus of this story - make it the centerpiece, not just a mention
- REQUIRED: At least ONE hyperlink MUST appear in the FIRST paragraph alongside the earnings information

` : ''}
1. 🚨 CRITICAL HYPERLINK REQUIREMENT (HIGHEST PRIORITY - MANDATORY) 🚨:
   - You MUST create a hyperlink for EVERY article provided above - NO EXCEPTIONS
   - If ${articles.length} articles are provided, you must include EXACTLY ${articles.length} hyperlinks in your story
   - REQUIRED: At least ONE hyperlink MUST appear in the FIRST paragraph (lead paragraph) - THIS IS MANDATORY, NOT OPTIONAL
   - VALIDATION: Before submitting, count your hyperlinks - you need exactly ${articles.length} hyperlinks total
   - If you fail to include all ${articles.length} hyperlinks, your article will be rejected
   - For earnings reaction stories: The first paragraph must include BOTH the earnings date AND at least one hyperlink
   - HYPERLINK TEXT SELECTION RULES (CRITICAL - READ CAREFULLY):
     * You may use words from the article headline as inspiration, BUT the hyperlink text MUST flow naturally in your sentence
     * DO NOT use headline fragments that don't make grammatical sense in context
     * Example BAD: If headline is "Gold, Silver Are Surging", don't hyperlink "Gold, Silver Are" - that's a headline fragment that doesn't flow
     * Example BAD: If headline is "Tariff Fears Reignite", don't hyperlink "Tariff Fears Reignite" - choose words that flow naturally
     * DO NOT use the exact headline text as your hyperlink (e.g., if headline is "Can You Buy NASA Stock?", don't hyperlink "Can You Buy NASA Stock?")
     * DO NOT use generic phrases like "recent reports", "according to reports", "recent news", etc. as hyperlink text
     * The hyperlink text should read as a natural part of your sentence, NOT as a headline fragment
     * If the first three words of a headline don't flow naturally, choose different words from the headline or rephrase
     * The hyperlink text must make grammatical sense in the context of your sentence
     * Example GOOD: If headline is "Gold, Silver Are Surging to Record Highs", hyperlink "record highs" or "surging to record" - NOT "Gold, Silver Are"
     * Example GOOD: If headline is "Tariff Fears Reignite on Canada Trade", hyperlink "trade tensions" or "tariff concerns" - NOT "Tariff Fears Reignite"
   - Format: <a href="URL">three sequential words</a> (use HTML format, NOT markdown)
   - Do NOT mention "Benzinga" or any source name when linking
   - Embed each hyperlink naturally within your sentences throughout the article
   - Distribute the hyperlinks throughout the article - don't cluster them all in one paragraph
   - Before submitting, count your hyperlinks: you need exactly ${articles.length} hyperlinks total
   - CRITICAL WRITING STYLE: Write as a normal journalist - DO NOT explicitly reference articles, reports, or sources
   - DO NOT use phrases like: "as reported", "as discussed", "according to a report", "as covered in an article", "this article", "the report", "in a report", "as noted in", "which was discussed in", "this development was covered in", "recent reports", "according to reports", "recent news", etc.
   - Simply write the narrative naturally and embed hyperlinks seamlessly - the hyperlink text should flow as part of the sentence, not be called out as a reference or headline
   - For older articles (marked "[X DAYS BEFORE PRICE ACTION]"): These articles provide context about events that happened earlier. Use vague temporal references like "recently", "earlier this week", "in recent days", "earlier", etc. - DO NOT use the specific day name (e.g., "on Monday") as the article is reporting on events that occurred before its publication date. The day name refers to when the article was published, not when the event happened.
   - Example of GOOD: "The company's stock rebounded following a major hardware delivery for its upcoming Neutron rocket."
   - Example of BAD: "Meta and other Gold, Silver Are social media giants" (headline fragment doesn't flow)
   - Example of BAD: "factors such as tariff fears reigniting on Canada" (headline fragment doesn't flow)
   - Example of BAD: "This development was covered in a Rocket Lab Stock Rebounds article."
   - Example of BAD: "Recent reports indicate the company is expanding."
   - Example of BAD: "Can You Buy NASA Stock? explores investment options."
2. Article length: Write a comprehensive article with no word count limit. Prioritize DATA DENSITY and completeness.
   - Include all relevant information from the provided data
   - DO NOT add fluff, repetition, or filler content
   - Every sentence must provide NEW information or context - avoid repeating facts already stated
   - If a section would just repeat information from earlier paragraphs, either skip it or provide genuinely new data
3. LEAD PARAGRAPH - CRITICAL REQUIREMENTS:
   - Start with the company name and ticker: <strong>${companyName}</strong> (${ticker.includes(':') ? ticker : `NASDAQ: ${ticker}`})
   - Use HTML <strong> tags to bold ONLY the company name, NOT the ticker
   - CRITICAL: On the FIRST mention of ANY company (main company or related stocks), you MUST include:
     * The FULL company name (e.g., "Microsoft Corporation", "NVIDIA Corporation", not just "Microsoft" or "NVIDIA")
     * The ticker in parentheses (e.g., "(NASDAQ: MSFT)", "(NASDAQ: NVDA)")
     * Bold the company name: <strong>Microsoft Corporation</strong> (NASDAQ: MSFT)
   - After the first mention, use the shortened company name without bolding or ticker (e.g., "Microsoft", "NVIDIA")
   - This applies to ALL companies mentioned in the article (main company and related stocks)
   - LEAD PARAGRAPH CONTENT RULES (MANDATORY):
     * DO NOT simply restate the price action (e.g., "dropped 0.11% to $83.91") - that information is in the price action line at the bottom
     * Instead, focus on WHY the stock moved - provide context from the Benzinga articles
     * You MUST include at least ONE hyperlink to a Benzinga article in the lead paragraph
     * The hyperlink should explain the context or reason for the price movement
     * Example GOOD: "<strong>General Motors Company</strong> (NYSE: GM) shares declined on Friday following <a href="URL">announcements of strategic moves</a> that included a dividend hike and $6 billion stock buyback."
     * Example BAD: "<strong>General Motors Company</strong> (NYSE: GM) experienced a slight decline in its stock price, dropping 0.11% to $83.91 on Friday, as reported by Benzinga Pro data." (This just repeats the price action line)
     * Focus on the news, context, or events that explain the movement, not the movement itself
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
9. TEMPORAL ACCURACY - CRITICAL:
   - The price action occurred ${temporalContext.toLowerCase()}
   - When describing the stock movement, ALWAYS use the day of the week name instead of relative terms like "yesterday" or "today"
   - Use the format: "on [DayName]" (e.g., "on Thursday", "on Friday", "on Monday")
   - The price action day is: ${priceActionDate.dayName}
   - Examples:
     * "surged on ${priceActionDate.dayName}", "climbed on ${priceActionDate.dayName}", "was up on ${priceActionDate.dayName}"
     * "experienced a significant surge on ${priceActionDate.dayName}"
     * "gained momentum on ${priceActionDate.dayName}"
   - DO NOT use: "yesterday", "today", "earlier today" - always use the specific day name: "${priceActionDate.dayName}"
   - Always match the temporal language to when the price action actually occurred, using the day name provided above
10. Use professional, journalistic tone suitable for financial news.
11. Focus on current events and recent developments.
12. PRICE ACTION SECTION:
   - If you include a "## Section: Price Action" placeholder, provide ONLY new information not already covered
   - DO NOT repeat the price movement in this section - the lead paragraph should focus on context, not price details
   - If the price action was already fully described earlier, you can skip adding content to this section or provide only the section marker
   - The price action line at the end is sufficient - don't repeat it in the section content
13. PRICE ACTION LINE (END OF ARTICLE):
   - End with a price action line: "${priceAction || `${ticker} price data not available`}, according to Benzinga Pro data."
   - This line is separate from the lead paragraph and provides the factual price data
   - The lead paragraph should NOT repeat this information - it should focus on the context/reason for the move
14. Format the article with proper paragraph breaks using <p> tags.
15. Do NOT include "Also Read" or "Read Next" sections.
16. Do NOT mention "Benzinga" or any source name when referencing the articles - just embed the links naturally.
17. CRITICAL: Write naturally as a journalist - DO NOT explicitly mention that you're referencing articles or reports. Simply write the story and embed hyperlinks seamlessly within the narrative. Avoid phrases like "as reported", "as discussed", "according to a report", "this article", "the report", etc.
17. DATA DENSITY RULE: Every paragraph must introduce NEW information. If you find yourself repeating facts, data points, or analysis already mentioned, either:
    - Skip that content entirely
    - Or provide a different angle/context that adds value
    - Avoid phrases like "underscores", "highlights", "reflects" when they're just restating what was already said
    - DO NOT add filler sentences just to reach word count - quality over quantity
    - If you've covered all key information and there's nothing new to add, it's better to end the article than add repetitive fluff
18. CRITICAL: DO NOT create standalone sections for analyst sentiment, analyst ratings, or analyst data unless that information is explicitly mentioned in one of the provided Benzinga articles and can be hyperlinked to that article. All sections must be linked to Benzinga articles - do not create sections based on API data alone.
19. ARTICLE CONTENT FOCUS (HIGHEST PRIORITY):
   - Extract SPECIFIC details from the article content provided: quotes, numbers, percentages, dates, names, dollar amounts, specific facts
   - Include direct quotes from executives, analysts, or sources when mentioned in the articles
   - Provide rich context and background information from the articles - explain WHY things are happening, not just WHAT
   - Use the full article content to build a comprehensive narrative with concrete details
   - DO NOT create sections based on technical data (RSI, MACD, Edge rankings, moving averages) - technical analysis will be added in a second step
   - Focus on the story, context, and details from the articles themselves

Generate the article now:`;
}

// Multi-factor analysis generation (4-pass iterative method)
async function generateMultiFactorStory(
  ticker: string,
  companyName: string,
  priceAction: string,
  articles: any[],
  relatedStockData: Record<string, any>,
  wordCount: number,
  priceData: any,
  provider: AIProvider,
  technicalData?: any,
  analystActions?: any[],
  edgeRankings?: any
): Promise<string> {
  console.log(`[QUICK STORY] Multi-factor analysis mode enabled for ${ticker}`);
  
  const relatedStocksList = Object.keys(relatedStockData);
  const priceActionDate = getPriceActionDate();
  const temporalContext = getTemporalContext();
  
  // Fetch earnings/events data for related stocks
  console.log(`[QUICK STORY] Fetching earnings/events data for ${relatedStocksList.length} related stocks...`);
  const relatedStocksEarningsData: Record<string, any> = {};
  const relatedStocksConsensus: Record<string, any> = {};
  
  for (const relatedTicker of relatedStocksList) {
    try {
      const [earnings, consensus] = await Promise.all([
        fetchRecentEarningsResults(relatedTicker),
        fetchConsensusRatings(relatedTicker),
      ]);
      if (earnings) relatedStocksEarningsData[relatedTicker] = earnings;
      if (consensus) relatedStocksConsensus[relatedTicker] = consensus;
    } catch (error) {
      console.error(`[QUICK STORY] Error fetching data for ${relatedTicker}:`, error);
    }
  }
  
  // Pass 1: Generate initial draft with primary factor
  console.log(`[QUICK STORY] Pass 1/4: Generating initial structure...`);
  const primaryFactor = relatedStocksList.length > 0 ? relatedStocksList[0] : null;
  const primaryData = primaryFactor ? relatedStockData[primaryFactor] : null;
  const primaryEarnings = primaryFactor ? relatedStocksEarningsData[primaryFactor] : null;
  
  let primaryFactorText = '';
  if (primaryFactor && primaryData) {
    primaryFactorText = `\nPRIMARY FACTOR:\n`;
    primaryFactorText += `${primaryData.name || primaryFactor} (${primaryFactor}): ${primaryData.change !== null ? `${primaryData.change > 0 ? '+' : ''}${primaryData.change.toFixed(2)}%` : 'N/A'}\n`;
    if (primaryEarnings) {
      if (primaryEarnings.type === 'recent') {
        primaryFactorText += `Recent Earnings: EPS ${primaryEarnings.eps_actual !== null ? `$${typeof primaryEarnings.eps_actual === 'string' ? parseFloat(primaryEarnings.eps_actual).toFixed(2) : primaryEarnings.eps_actual.toFixed(2)}` : 'N/A'} vs Estimate ${primaryEarnings.eps_estimate !== null ? `$${typeof primaryEarnings.eps_estimate === 'string' ? parseFloat(primaryEarnings.eps_estimate).toFixed(2) : primaryEarnings.eps_estimate.toFixed(2)}` : 'N/A'} (${primaryEarnings.eps_beat_miss || 'N/A'})\n`;
      } else if (primaryEarnings.type === 'upcoming') {
        primaryFactorText += `Upcoming Earnings: EPS Estimate ${primaryEarnings.eps_estimate !== null ? `$${typeof primaryEarnings.eps_estimate === 'string' ? parseFloat(primaryEarnings.eps_estimate).toFixed(2) : primaryEarnings.eps_estimate.toFixed(2)}` : 'N/A'}\n`;
      }
    }
  }
  
  let initialPrompt = `You are a financial journalist writing a ${wordCount}-word article about ${companyName} (${ticker}).

CURRENT PRICE ACTION:
${priceAction || 'Price data not available'}
${temporalContext}
IMPORTANT: The price action occurred on ${priceActionDate.dayName}. Always refer to this day by name (e.g., "on ${priceActionDate.dayName}") rather than using relative terms like "yesterday" or "today".
${primaryFactorText}
REQUIREMENTS:
1. Write a concise article explaining why ${ticker} is moving based on the price action${primaryFactor ? ` and how ${primaryData?.name || primaryFactor}'s performance relates` : ''}.
2. Use SEO subheadings: ## Section: [Subhead Title]
3. Start with: <strong>${companyName}</strong> (${ticker.includes(':') ? ticker : `NASDAQ: ${ticker}`})
4. Use HTML <strong> tags for company names on first mention
5. End with price action line: "${priceAction || `${ticker} price data not available`}, according to Benzinga Pro data."
6. Use <p> tags for paragraphs
7. Write comprehensively with no word count limit - prioritize data density and completeness

Generate the initial article:`;

  const initialResult = await aiProvider.generateCompletion(
    [
      {
        role: 'system',
        content: 'You are a professional financial journalist writing concise, data-dense articles for a financial news website.',
      },
      {
        role: 'user',
        content: initialPrompt,
      },
    ],
    {
      model: provider === 'gemini' ? 'gemini-3-pro-preview' : 'gpt-4o',
      temperature: 0.3,
      maxTokens: Math.max(wordCount * 2, 1500),
    },
    provider
  );

  let draft = initialResult.content.trim().replace(/^```(?:markdown|html)?\s*/i, '').replace(/\s*```$/i, '');

  // Pass 2: Integrate all related factors with earnings/events data
  if (relatedStocksList.length > 0) {
    console.log(`[QUICK STORY] Pass 2/4: Integrating all ${relatedStocksList.length} related factors with earnings data...`);
    
    const formatEarningsForPrompt = (ticker: string, earnings: any): string => {
      if (!earnings) return '';
      let text = '';
      if (earnings.type === 'recent') {
        text += `Recent Earnings Report (${earnings.date || 'N/A'}):\n`;
        if (earnings.eps_actual !== null && earnings.eps_estimate !== null) {
          const epsActual = typeof earnings.eps_actual === 'string' ? parseFloat(earnings.eps_actual).toFixed(2) : earnings.eps_actual.toFixed(2);
          const epsEst = typeof earnings.eps_estimate === 'string' ? parseFloat(earnings.eps_estimate).toFixed(2) : earnings.eps_estimate.toFixed(2);
          text += `  EPS: $${epsActual} vs Estimate $${epsEst} (${earnings.eps_beat_miss || 'N/A'})`;
          if (earnings.eps_surprise_pct !== null) {
            text += ` - ${earnings.eps_surprise_pct > 0 ? '+' : ''}${earnings.eps_surprise_pct.toFixed(1)}% surprise`;
          }
          text += '\n';
        }
        if (earnings.revenue_actual !== null && earnings.revenue_estimate !== null) {
          const formatRev = (val: number | string) => {
            const num = typeof val === 'string' ? parseFloat(val) : val;
            const millions = num / 1000000;
            return millions >= 1000 ? `$${(millions / 1000).toFixed(2)}B` : `$${millions.toFixed(2)}M`;
          };
          text += `  Revenue: ${formatRev(earnings.revenue_actual)} vs Estimate ${formatRev(earnings.revenue_estimate)} (${earnings.revenue_beat_miss || 'N/A'})\n`;
        }
      } else if (earnings.type === 'upcoming') {
        text += `Upcoming Earnings (${earnings.date || 'N/A'}):\n`;
        if (earnings.eps_estimate !== null) {
          text += `  EPS Estimate: $${typeof earnings.eps_estimate === 'string' ? parseFloat(earnings.eps_estimate).toFixed(2) : earnings.eps_estimate.toFixed(2)}\n`;
        }
      }
      return text;
    };

    const relatedStocksText = relatedStocksList.map((relatedTicker) => {
      const data = relatedStockData[relatedTicker];
      const earnings = relatedStocksEarningsData[relatedTicker];
      const consensus = relatedStocksConsensus[relatedTicker];
      const changeText = data.change !== null 
        ? `${data.change > 0 ? '+' : ''}${data.change.toFixed(2)}%`
        : 'N/A';
      
      let stockInfo = `${data.name || relatedTicker} (${relatedTicker}): ${changeText}\n`;
      if (earnings) {
        stockInfo += formatEarningsForPrompt(relatedTicker, earnings);
      }
      if (consensus && consensus.consensus_rating) {
        stockInfo += `Analyst Consensus: ${consensus.consensus_rating}`;
        if (consensus.consensus_price_target) {
          stockInfo += `, Price Target: $${typeof consensus.consensus_price_target === 'string' ? parseFloat(consensus.consensus_price_target).toFixed(2) : consensus.consensus_price_target.toFixed(2)}`;
        }
        stockInfo += '\n';
      }
      return stockInfo;
    }).join('\n');

    const refinePrompt = `You are refining a financial news article. Below is the current draft, followed by detailed data for ALL related companies that need to be integrated.

CURRENT DRAFT:
${draft}

ALL RELATED COMPANIES DATA TO INTEGRATE:
${relatedStocksText}

CRITICAL INSTRUCTIONS:
1. Integrate ALL the related companies above into your article with their earnings/consensus data
2. Each related company should get its own dedicated section explaining their results
3. Include specific metrics: earnings beats/misses, revenue numbers, analyst ratings
4. Show how each company's performance relates to ${ticker}
5. Maintain the existing structure but expand with detailed analysis
6. Keep SEO subheadings: ## Section: [Subhead Title]
7. Use specific numbers and data points from the earnings/consensus information
8. Aim for ${wordCount} words but prioritize depth and data density
9. End with: "${priceAction || `${ticker} price data not available`}, according to Benzinga Pro data."

Refine the article to integrate all factors with detailed data:`;

    const refineResult = await aiProvider.generateCompletion(
      [
        {
          role: 'system',
          content: 'You are a professional financial journalist refining an article to integrate multiple companies with their earnings and analyst data. Focus on including specific metrics and data points.',
        },
        {
          role: 'user',
          content: refinePrompt,
        },
      ],
      {
        model: provider === 'gemini' ? 'gemini-3-pro-preview' : 'gpt-4o',
        temperature: 0.3,
        maxTokens: Math.max(wordCount * 3, 2000),
      },
      provider
    );

    draft = refineResult.content.trim().replace(/^```(?:markdown|html)?\s*/i, '').replace(/\s*```$/i, '');
  }

  // Pass 3: Deep causal analysis - build read-through logic
  console.log(`[QUICK STORY] Pass 3/4: Building deep causal analysis and read-through logic...`);
  
  const causalAnalysisPrompt = `You are performing a deep causal analysis on a financial news article. The current article includes multiple related companies, but it needs STRONGER causal connections explaining HOW each factor affects ${ticker}.

CURRENT ARTICLE:
${draft}

RELATED COMPANIES AFFECTING ${ticker}:
${relatedStocksList.map((ticker) => relatedStockData[ticker]?.name || ticker).join(', ')}

CRITICAL CAUSAL ANALYSIS REQUIREMENTS:
1. For EACH related company, you MUST explain the SPECIFIC read-through effect on ${ticker}
2. Build explicit causal chains using this format:
   - "[Related Company] result → sector impact → ${ticker} effect"
   - Example: "Microsoft's AI capex acceleration creates read-through pressure on Meta because..."
3. Use specific causal language:
   - "creates read-through pressure"
   - "signals sector weakness/strength"
   - "spills into [sector/stock]"
   - "converges to create"
   - "ripples through"
   - "amplifies concerns about"
4. Show CONVERGENCE: Explain how these factors COMBINE to create sector pressure/momentum
5. Each related company section should start with HOW their results affect ${ticker}, not just what happened
6. Add a section explaining the convergence: "## Section: How Factors Converge" or similar
7. Prohibit generic statements - every connection must be specific and causal
8. Maintain all existing data and metrics
9. Keep SEO subheadings: ## Section: [Subhead Title]
10. End with: "${priceAction || `${ticker} price data not available`}, according to Benzinga Pro data."

Rewrite the article with deep causal analysis and explicit read-through logic:`;

  const causalResult = await aiProvider.generateCompletion(
    [
      {
        role: 'system',
        content: 'You are a senior financial analyst performing deep causal analysis. You must build explicit read-through logic showing how each factor creates specific effects on the primary stock. Use causal language and show convergence of factors.',
      },
      {
        role: 'user',
        content: causalAnalysisPrompt,
      },
    ],
    {
      model: provider === 'gemini' ? 'gemini-3-pro-preview' : 'gpt-4o',
      temperature: 0.3,
      maxTokens: Math.max(wordCount * 3, 2500),
    },
    provider
  );

  draft = causalResult.content.trim().replace(/^```(?:markdown|html)?\s*/i, '').replace(/\s*```$/i, '');

  // Pass 4: Final refinement - lead paragraph and overall polish
  console.log(`[QUICK STORY] Pass 4/4: Final refinement of lead and overall polish...`);
  
  const finalRefinePrompt = `You are performing final refinement on a multi-factor financial news article. The article has good causal analysis, but the lead paragraph needs to synthesize ALL factors and the overall article needs polish.

CURRENT ARTICLE:
${draft}

RELATED COMPANIES:
${relatedStocksList.map((ticker) => relatedStockData[ticker]?.name || ticker).join(', ')}

FINAL REFINEMENT REQUIREMENTS:
1. Rewrite the FIRST paragraph (lead) to:
   - Mention ALL related companies that affect ${ticker}
   - Explain how their results CONVERGE to create sector pressure/momentum
   - Use specific language: "cascade of read-throughs", "convergence of signals", "risk-off shift", "sector-wide pressure"
   - Show the causal chain in the lead: how factors combine to affect ${ticker}
   - Be 3-4 sentences, data-dense
   - Start with: <strong>${companyName}</strong> (${ticker.includes(':') ? ticker : `NASDAQ: ${ticker}`})
2. Review the body sections:
   - Ensure each section has strong causal language
   - Verify read-through logic is explicit
   - Check that convergence is explained
3. Maintain all specific metrics and data points
4. Keep SEO subheadings: ## Section: [Subhead Title]
5. Ensure smooth flow between sections
6. End with: "${priceAction || `${ticker} price data not available`}, according to Benzinga Pro data."

Provide the fully refined article:`;

  const finalRefineResult = await aiProvider.generateCompletion(
    [
      {
        role: 'system',
        content: 'You are a professional financial journalist performing final refinement on a multi-factor analysis article. Focus on synthesizing all factors in the lead and ensuring strong causal connections throughout.',
      },
      {
        role: 'user',
        content: finalRefinePrompt,
      },
    ],
    {
      model: provider === 'gemini' ? 'gemini-3-pro-preview' : 'gpt-4o',
      temperature: 0.3,
      maxTokens: Math.max(wordCount * 3, 2500),
    },
    provider
  );

  const finalStory = finalRefineResult.content.trim().replace(/^```(?:markdown|html)?\s*/i, '').replace(/\s*```$/i, '');
  
  console.log(`[QUICK STORY] Multi-factor analysis complete (4 passes)`);
  return finalStory;
}

export async function POST(req: Request) {
  try {
    const {
      ticker,
      wordCount = 400,
      template = 'price-movement',
      relatedStocks = [],
      customFocus,
      customSourceUrls,
      selectedArticleUrl,
      multiFactorMode = false,
      aiProvider: providerOverride,
    } = await req.json();

    if (!ticker || !ticker.trim()) {
      return NextResponse.json({ error: 'Ticker is required' }, { status: 400 });
    }

    const tickerUpper = ticker.toUpperCase().trim();
    const provider: AIProvider = (providerOverride as AIProvider) || 'openai';

    console.log(`[QUICK STORY] Generating story for ${tickerUpper}, template: ${template}, word count: ${wordCount}`);

    // Get price action date to filter articles
    const priceActionDate = getPriceActionDate();
    
    // For custom template with selected article, use that as primary source
    let articles: any[] = [];
    if (template === 'custom' && selectedArticleUrl) {
      // Fetch the selected article - try Benzinga API first, then scrape
      try {
        // Try to get article from Benzinga API
        const dateFrom = new Date();
        dateFrom.setDate(dateFrom.getDate() - 30);
        const dateFromStr = dateFrom.toISOString().slice(0, 10);
        
        const articleResponse = await fetch(`${BZ_NEWS_URL}?token=${BENZINGA_API_KEY}&items=100&fields=headline,title,created,url,channels,teaser,body&accept=application/json&displayOutput=full&dateFrom=${dateFromStr}`, {
          headers: { Accept: 'application/json' },
        });
        
        if (articleResponse.ok) {
          const articleData = await articleResponse.json();
          if (Array.isArray(articleData)) {
            const foundArticle = articleData.find((a: any) => a.url === selectedArticleUrl);
            if (foundArticle) {
              articles = [foundArticle]; // Use selected article as primary
            }
          }
        }
        
        // If API lookup fails, scrape the URL
        if (articles.length === 0) {
          const scrapedContent = await scrapeNewsUrl(selectedArticleUrl);
          if (scrapedContent) {
            articles = [{
              headline: 'Selected Article',
              url: selectedArticleUrl,
              teaser: scrapedContent.substring(0, 200),
              body: scrapedContent,
              created: new Date().toISOString(),
            }];
          }
        }
      } catch (error) {
        console.error('[QUICK STORY] Error fetching selected article:', error);
      }
      
      // Also fetch additional related articles for context (up to 4 more)
      // Handle multiple tickers (comma-separated)
      if (tickerUpper.includes(',')) {
        const tickers = tickerUpper.split(',').map((t: string) => t.trim()).filter((t: string) => t);
        const articlePromises = tickers.map((t: string) => fetchRecentArticles(t, 3, priceActionDate.date));
        const articleArrays = await Promise.all(articlePromises);
        const relatedArticles = articleArrays.flat();
        // Deduplicate by URL
        const seenUrls = new Set(articles.map((a: any) => a.url));
        const uniqueRelated = relatedArticles.filter((a: any) => !seenUrls.has(a.url));
        articles = [...articles, ...uniqueRelated];
      } else {
        const relatedArticles = await fetchRecentArticles(tickerUpper, 4, priceActionDate.date);
        articles = [...articles, ...relatedArticles];
      }
    } else {
      // Standard article fetching - handle multiple tickers
      if (tickerUpper.includes(',')) {
        const tickers = tickerUpper.split(',').map((t: string) => t.trim()).filter((t: string) => t);
        // Fetch articles for each ticker, aiming for 5 total
        const articlesPerTicker = Math.ceil(5 / tickers.length);
        const articlePromises = tickers.map((t: string) => fetchRecentArticles(t, articlesPerTicker, priceActionDate.date));
        const articleArrays = await Promise.all(articlePromises);
        // Combine and deduplicate by URL
        const allArticles = articleArrays.flat();
        const seenUrls = new Set<string>();
        articles = allArticles.filter((a: any) => {
          if (seenUrls.has(a.url)) return false;
          seenUrls.add(a.url);
          return true;
        }).slice(0, 5); // Limit to 5 total
      } else {
        articles = await fetchRecentArticles(tickerUpper, 5, priceActionDate.date);
      }
    }
    
    // Log articles after fetching
    console.log(`[QUICK STORY] Total articles fetched: ${articles.length}`);
    console.log(`[QUICK STORY] Article URLs:`, articles.map((a: any) => a.url || 'NO URL'));
    console.log(`[QUICK STORY] Article headlines:`, articles.map((a: any) => a.headline || a.title || 'NO HEADLINE'));
    
    // Fetch comprehensive WGO-style data in parallel
    // Note: For Quick Story Generator, we'll use the full WGO data structure
    // but build the narrative around articles instead of scraped content
    const [priceData, earningsData, technicalData, analystActions, edgeRankings, consensusRatingsData, marketContext] = await Promise.all([
      fetchPriceData(tickerUpper),
      template === 'earnings-reaction' ? fetchRecentEarningsResults(tickerUpper) : Promise.resolve(null),
      fetchSimplifiedTechnicalData(tickerUpper), // Will be replaced with full WGO fetchTechnicalData
      fetchRecentAnalystActions(tickerUpper, 3),
      fetchEdgeRankings(tickerUpper),
      fetchConsensusRatings(tickerUpper),
      fetchMarketContext(), // Add market context like WGO
    ]);

    // Fetch related stock data if provided
    let relatedStockData: Record<string, any> = {};
    if (relatedStocks && Array.isArray(relatedStocks) && relatedStocks.length > 0) {
      relatedStockData = await fetchRelatedStockData(relatedStocks);
    }

    // Use consensus ratings (already fetched above)
    const consensusRatings = consensusRatingsData;

    // Generate price action using WGO Generator function (handles multiple tickers)
    const companyName = priceData?.name || tickerUpper;
    let priceAction = '';
    
    // Handle multiple tickers (comma-separated)
    if (tickerUpper.includes(',')) {
      const tickers = tickerUpper.split(',').map((t: string) => t.trim()).filter((t: string) => t);
      const priceActions = await Promise.all(
        tickers.map((t: string) => generatePriceAction(t))
      );
      priceAction = priceActions.filter((pa: string) => pa).join(' ');
    } else {
      priceAction = await generatePriceAction(tickerUpper);
    }

    // Scrape custom source URLs if provided (for custom template)
    let customSourceContent: Record<string, string> = {};
    if (template === 'custom' && customSourceUrls) {
      const urlArray = typeof customSourceUrls === 'string' 
        ? customSourceUrls.split(',').map(url => url.trim()).filter(url => url)
        : Array.isArray(customSourceUrls) ? customSourceUrls : [];
      
      if (urlArray.length > 0) {
        console.log(`[QUICK STORY] Scraping ${urlArray.length} custom source URLs...`);
        const scrapePromises = urlArray.map(async (url: string) => {
          try {
            const content = await scrapeNewsUrl(url);
            if (content) {
              customSourceContent[url] = content;
              console.log(`[QUICK STORY] Successfully scraped ${url}, content length: ${content.length}`);
            } else {
              console.warn(`[QUICK STORY] Failed to scrape ${url}`);
            }
          } catch (error) {
            console.error(`[QUICK STORY] Error scraping ${url}:`, error);
          }
        });
        await Promise.all(scrapePromises);
      }
    }

    // Use multi-factor analysis if enabled for sector-context template
    let story: string;
    if (template === 'sector-context' && multiFactorMode && Object.keys(relatedStockData).length > 0) {
      console.log(`[QUICK STORY] Using multi-factor analysis mode`);
      story = await generateMultiFactorStory(
        tickerUpper,
        companyName,
        priceAction,
        articles,
        relatedStockData,
        wordCount,
        priceData || undefined,
        provider,
        technicalData || undefined,
        analystActions || undefined,
        edgeRankings || undefined
      );
    } else {
      // Generate Quick Story using original approach (not WGO Generator)
      console.log(`[QUICK STORY] Generating Quick Story with ${articles.length} articles`);
      
      // Generate story using custom prompt
      const customUrlsArray = template === 'custom' && customSourceUrls
        ? (typeof customSourceUrls === 'string' 
            ? customSourceUrls.split(',').map(url => url.trim()).filter(url => url)
            : Array.isArray(customSourceUrls) ? customSourceUrls : [])
        : undefined;
      
      // Log before building prompt
      console.log(`[QUICK STORY] ===== BUILDING PROMPT =====`);
      console.log(`[QUICK STORY] Articles array length: ${articles.length}`);
      console.log(`[QUICK STORY] Articles for prompt:`, articles.map((a: any) => ({
        headline: a.headline || a.title || 'NO HEADLINE',
        url: a.url || 'NO URL',
        hasTeaser: !!a.teaser
      })));
      
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
        priceData || undefined,
        consensusRatings || undefined,
        customUrlsArray,
        Object.keys(customSourceContent).length > 0 ? customSourceContent : undefined,
        technicalData || undefined,
        analystActions || undefined,
        edgeRankings || undefined
      );

      // Generate story
      const result = await aiProvider.generateCompletion(
        [
          {
            role: 'system',
            content: 'You are a professional financial journalist writing concise, data-dense articles for a financial news website. HIGHEST PRIORITY: You must hyperlink EVERY article provided - if 5 articles are given, include exactly 5 hyperlinks distributed throughout the story. CRITICAL LEAD PARAGRAPH RULE: The lead paragraph must focus on WHY the stock moved (context from articles), NOT just restate the price action. At least ONE hyperlink MUST appear in the first paragraph explaining the context. DO NOT repeat the price action details (percentage, price) in the lead - that information is in the price action line at the bottom. Use HTML format: <a href="URL">text</a> NOT markdown format. Always use HTML <strong> tags to bold company names (not tickers) and prominent people\'s names on their first mention. CRITICAL: On the FIRST mention of ANY company (main or related), you MUST use the FULL company name (e.g., "Microsoft Corporation", "NVIDIA Corporation") with the ticker in parentheses. Use subhead placeholders (## Section:) and bullet points (<ul>/<li>) to break up content and improve readability. Prioritize data density - avoid fluff and repetition.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        {
          model: provider === 'gemini' ? 'gemini-3-pro-preview' : 'gpt-4o',
          temperature: 0.3, // Lower temperature for more consistent instruction following
          maxTokens: 8000, // Removed word count limit - allow full story generation
        },
        provider
      );

      story = result.content.trim();
    }

    // Clean up any markdown wrappers
    story = story.replace(/^```(?:markdown|html)?\s*/i, '').replace(/\s*```$/i, '');
    
    // Fix formatting: Ensure proper spacing around section markers
    // First, handle cases where section marker appears directly after text with no newline
    story = story.replace(/([^\n])\s*##\s*Section:/g, '$1\n\n## Section:');
    // Ensure section markers have proper spacing after them
    story = story.replace(/##\s*Section:([^\n]+)\n([^\n#])/g, '## Section:$1\n\n$2');
    
    // Post-process to ensure ALL articles are hyperlinked (WGO only hyperlinks primary article)
    if (articles.length > 1) {
      console.log(`[QUICK STORY] Post-processing to ensure all ${articles.length} articles are hyperlinked`);
      const articleUrls = articles.map((a: any) => a.url).filter((url: string) => url);
      const hyperlinkedUrls = new Set<string>();
      
      // Find all currently hyperlinked URLs
      const hyperlinkMatches = story.match(/<a\s+href=["'](https?:\/\/[^"']+)["'][^>]*>/gi) || [];
      hyperlinkMatches.forEach((match: string) => {
        const urlMatch = match.match(/href=["'](https?:\/\/[^"']+)["']/i);
        if (urlMatch) {
          hyperlinkedUrls.add(urlMatch[1]);
        }
      });
      
      // For each article URL that's not hyperlinked, find a natural place to add it
      articleUrls.forEach((articleUrl: string, index: number) => {
        if (!hyperlinkedUrls.has(articleUrl) && !story.includes(articleUrl)) {
          const article = articles[index];
          if (article && article.headline) {
            // Extract 3 sequential words from headline for hyperlink text
            const headlineWords = article.headline.split(/\s+/).filter((w: string) => w.length > 2);
            if (headlineWords.length >= 3) {
              // Find a good place to insert the hyperlink (prefer paragraphs after the first)
              const paragraphs = story.split(/\n\n/);
              if (paragraphs.length > 1) {
                // Try to find a paragraph that mentions something related to the headline
                for (let i = 1; i < paragraphs.length; i++) {
                  const para = paragraphs[i];
                  // Skip section headers
                  if (!para.match(/^##\s*Section:/) && para.length > 50) {
                    // Find a good spot to insert hyperlink (prefer middle of paragraph)
                    const words = para.split(/\s+/);
                    if (words.length >= 5) {
                      // Insert hyperlink in the middle of the paragraph
                      const insertIndex = Math.floor(words.length / 2);
                      const threeWords = headlineWords.slice(0, 3).join(' ');
                      words.splice(insertIndex, 0, `<a href="${articleUrl}">${threeWords}</a>`);
                      paragraphs[i] = words.join(' ');
                      story = paragraphs.join('\n\n');
                      hyperlinkedUrls.add(articleUrl);
                      console.log(`[QUICK STORY] Added hyperlink for article ${index + 1}: ${articleUrl}`);
                      break;
                    }
                  }
                }
              }
            }
          }
        }
      });
    }

    // Validate hyperlinks: Count how many article URLs are actually hyperlinked
    // Check for both HTML format <a href="url">text</a> and markdown format [text](url)
    const htmlLinks = (story.match(/<a\s+href=["']https?:\/\/[^"']+["'][^>]*>/gi) || []).length;
    const markdownLinks = (story.match(/\[([^\]]+)\]\(https?:\/\/[^\)]+\)/gi) || []).length;
    const hyperlinkCount = htmlLinks + markdownLinks;
    const expectedHyperlinks = articles.length;
    
    console.log(`[QUICK STORY] ===== HYPERLINK VALIDATION =====`);
    console.log(`[QUICK STORY] Articles array length: ${articles.length}`);
    console.log(`[QUICK STORY] Expected hyperlinks: ${expectedHyperlinks}`);
    console.log(`[QUICK STORY] Found HTML links: ${htmlLinks}`);
    console.log(`[QUICK STORY] Found markdown links: ${markdownLinks}`);
    console.log(`[QUICK STORY] Total hyperlinks found: ${hyperlinkCount}`);
    
    // Extract all URLs from hyperlinks in the story
    const htmlLinkMatches = story.match(/<a\s+href=["'](https?:\/\/[^"']+)["'][^>]*>/gi) || [];
    const markdownLinkMatches = story.match(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/gi) || [];
    const htmlLinkUrls = htmlLinkMatches.map((m: string) => {
      const urlMatch = m.match(/href=["'](https?:\/\/[^"']+)["']/i);
      return urlMatch ? urlMatch[1] : 'NO URL';
    });
    const markdownLinkUrls = markdownLinkMatches.map((m: string) => {
      const urlMatch = m.match(/\((https?:\/\/[^\)]+)\)/i);
      return urlMatch ? urlMatch[1] : 'NO URL';
    });
    console.log(`[QUICK STORY] HTML link URLs found:`, htmlLinkUrls);
    console.log(`[QUICK STORY] Markdown link URLs found:`, markdownLinkUrls);
    
    // Check which article URLs are actually hyperlinked
    const articleUrls = articles.map((a: any) => a.url).filter((url: string) => url);
    console.log(`[QUICK STORY] Article URLs that should be hyperlinked:`, articleUrls);
    
    const hyperlinkedArticleUrls = articleUrls.filter((articleUrl: string) => {
      return story.includes(articleUrl);
    });
    console.log(`[QUICK STORY] Article URLs found in story: ${hyperlinkedArticleUrls.length}/${articleUrls.length}`);
    const missingUrls = articleUrls.filter((url: string) => !story.includes(url));
    if (missingUrls.length > 0) {
      console.warn(`[QUICK STORY] ⚠️ MISSING ARTICLE URLs:`, missingUrls);
    }
    console.log(`[QUICK STORY] ===== END HYPERLINK VALIDATION =====`);
    
    // If hyperlinks are missing, retry with stronger instructions (max 2 retries)
    let retryCount = 0;
    const maxRetries = 2;
    let currentHyperlinkCount = hyperlinkCount;
    
    while (currentHyperlinkCount < expectedHyperlinks && retryCount < maxRetries) {
      console.log(`[QUICK STORY] Missing hyperlinks detected. Retry ${retryCount + 1}/${maxRetries}...`);
      console.log(`[QUICK STORY] Current hyperlink count: ${currentHyperlinkCount}, expected: ${expectedHyperlinks}`);
      
      // Build a more explicit prompt with hyperlink requirements
      const customUrlsArrayRetry = template === 'custom' && customSourceUrls
        ? (typeof customSourceUrls === 'string' 
            ? customSourceUrls.split(',').map(url => url.trim()).filter(url => url)
            : Array.isArray(customSourceUrls) ? customSourceUrls : [])
        : undefined;
      
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
        priceData || undefined,
        consensusRatings || undefined,
        customUrlsArrayRetry,
        Object.keys(customSourceContent).length > 0 ? customSourceContent : undefined,
        technicalData || undefined,
        analystActions || undefined,
        edgeRankings || undefined
      ) + `\n\nCRITICAL VALIDATION REQUIRED BEFORE SUBMITTING:
CRITICAL WRITING STYLE REMINDER:
- Write naturally as a journalist - DO NOT explicitly reference articles or reports
- DO NOT use phrases like "as reported", "as discussed", "according to a report", "as covered in an article", "this article", "the report", "in a report", "as noted in", "which was discussed in", "this development was covered in", "recent reports", "according to reports", "recent news", etc.
- DO NOT use the exact headline text as hyperlink text - extract three sequential words that fit naturally into your sentence
- Simply write the narrative and embed hyperlinks seamlessly - the hyperlink text should flow naturally as part of the sentence, not as a headline or reference
- Example of GOOD: "The company's stock rebounded following a major hardware delivery for its upcoming Neutron rocket."
- Example of BAD: "This development was covered in a Rocket Lab Stock Rebounds article."
- Example of BAD: "Recent reports indicate the company is expanding."
- Example of BAD: "Can You Buy NASA Stock? explores investment options."

CRITICAL VALIDATION REQUIRED BEFORE SUBMITTING:
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
            content: 'You are a professional financial journalist writing concise, data-dense articles for a financial news website. CRITICAL HYPERLINK RULE: You must hyperlink EVERY article provided - if 5 articles are given, include exactly 5 hyperlinks distributed throughout the story. CRITICAL LEAD PARAGRAPH RULE: The lead paragraph must focus on WHY the stock moved (context from articles), NOT just restate the price action. At least ONE hyperlink MUST appear in the first paragraph explaining the context. DO NOT repeat the price action details (percentage, price) in the lead - that information is in the price action line at the bottom. Use HTML format: <a href="URL">text</a> NOT markdown format. Always use HTML <strong> tags to bold company names (not tickers) and prominent people\'s names on their first mention. CRITICAL: On the FIRST mention of ANY company (main or related), you MUST use the FULL company name (e.g., "Microsoft Corporation", "NVIDIA Corporation") with the ticker in parentheses. Use subhead placeholders (## Section:) and bullet points (<ul>/<li>) to break up content and improve readability.',
          },
          {
            role: 'user',
            content: retryPrompt,
          },
        ],
        {
          model: provider === 'gemini' ? 'gemini-3-pro-preview' : 'gpt-4o',
          temperature: 0.3, // Lower temperature for more consistent instruction following
          maxTokens: 8000, // Removed word count limit - allow full story generation
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
