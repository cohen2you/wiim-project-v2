import { NextResponse } from 'next/server';

import { aiProvider, AIProvider } from '@/lib/aiProvider';
import { fetchETFs, formatETFInfo } from '@/lib/etf-utils';

const BZ_NEWS_URL = 'https://api.benzinga.com/api/v2/news';
const BENZINGA_EDGE_API_KEY = process.env.BENZINGA_EDGE_API_KEY;



function formatPrice(price: number | null | undefined): string {

  if (price === null || price === undefined || isNaN(price)) return 'N/A';

  return price.toFixed(2);

}

// Helper function to normalize company name capitalization
function normalizeCompanyName(name: string): string {
  if (!name) return name;
  if (name === name.toUpperCase() && name.length > 1) {
    return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  }
  return name;
}

// Helper function to simplify company name for Edge Rankings (remove legal suffixes, stock types, etc.)
function simplifyCompanyNameForEdge(name: string): string {
  if (!name) return name;
  
  let simplified = name;
  
  // Remove stock type suffixes (case-insensitive)
  const stockTypePatterns = [
    /\s+Class\s+[A-Z]\s+Common\s+Stock\s*$/i,
    /\s+Class\s+[A-Z]\s+Stock\s*$/i,
    /\s+Common\s+Stock\s*$/i,
    /\s+Class\s+[A-Z]\s*$/i,
  ];
  
  for (const pattern of stockTypePatterns) {
    simplified = simplified.replace(pattern, '');
  }
  
  // Remove legal entity suffixes (case-insensitive)
  const legalSuffixPatterns = [
    /\s+Inc\.?\s*$/i,
    /\s+Corp\.?\s*$/i,
    /\s+Corporation\s*$/i,
    /\s+LLC\.?\s*$/i,
    /\s+Ltd\.?\s*$/i,
    /\s+Limited\s*$/i,
    /\s+Co\.?\s*$/i,
    /\s+Company\s*$/i,
  ];
  
  for (const pattern of legalSuffixPatterns) {
    simplified = simplified.replace(pattern, '');
  }
  
  // Remove ticker in parentheses if present (e.g., "Company Name (TICKER)")
  simplified = simplified.replace(/\s*\([A-Z]{1,5}\)\s*$/, '');
  
  // Trim any extra whitespace
  simplified = simplified.trim();
  
  return simplified || name; // Return original if simplified becomes empty
}

// Helper function to format EPS values: convert negative values under $1 to "Loss of X cents" format
function formatEPS(epsValue: number | string | null | undefined): string {
  if (epsValue === null || epsValue === undefined) return 'N/A';
  
  const eps = typeof epsValue === 'string' ? parseFloat(epsValue) : epsValue;
  
  if (isNaN(eps)) return 'N/A';
  
  // If negative and absolute value is less than $1, format as "Loss of X cents"
  if (eps < 0 && Math.abs(eps) < 1) {
    const cents = Math.abs(Math.round(eps * 100));
    return `Loss of ${cents} cent${cents !== 1 ? 's' : ''}`;
  }
  
  // For all other values (positive or negative >= $1), format as normal dollar amount
  return `$${eps.toFixed(2)}`;
}

// Helper function to format EPS for use in sentences (handles negative values appropriately)
function formatEPSForSentence(epsValue: number | string | null | undefined): string {
  if (epsValue === null || epsValue === undefined) return 'N/A';
  
  const eps = typeof epsValue === 'string' ? parseFloat(epsValue) : epsValue;
  
  if (isNaN(eps)) return 'N/A';
  
  // If negative, format as "a loss of X cents per share"
  if (eps < 0) {
    const cents = Math.abs(Math.round(eps * 100));
    return `a loss of ${cents} cent${cents !== 1 ? 's' : ''} per share`;
  }
  
  // If positive, format as normal dollar amount
  return `$${eps.toFixed(2)} per share`;
}

// Helper function to get exchange name from exchange code
function getExchangeName(exchangeCode: string | null | undefined): string {
  const exchangeNames: { [key: string]: string } = {
    'XNAS': 'NASDAQ',
    'XNYS': 'NYSE',
    'XASE': 'AMEX',
    'ARCX': 'NYSE ARCA',
    'BATS': 'BATS',
    'EDGX': 'EDGX',
    'EDGA': 'EDGA'
  };
  
  if (!exchangeCode) return 'NASDAQ'; // Default fallback
  
  return exchangeNames[exchangeCode] || exchangeCode;
}

// Helper function to format company name with exchange and ticker
function formatCompanyNameWithExchange(companyName: string, ticker: string, exchangeCode?: string | null): string {
  const exchange = getExchangeName(exchangeCode);
  return `${companyName} (${exchange}:${ticker})`;
}

// Helper to get market status using proper timezone handling
function getMarketStatusTimeBased(): 'open' | 'premarket' | 'afterhours' | 'closed' {
  const now = new Date();
  // Use Intl.DateTimeFormat to get Eastern Time components
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
  if (time >= 930 && time < 1600) return 'open'; // 9:30am - 4:00pm ET
  if (time >= 1600 && time < 2000) return 'afterhours'; // 4:00pm - 8:00pm ET
  return 'closed';
}

// Helper to format price with truncation
function formatPriceValue(val: number | string | undefined): string {
  if (val === undefined || val === null) return 'N/A';
  const num = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(num) || !isFinite(num)) return 'N/A';
  const truncated = Math.floor(num * 100) / 100;
  return truncated.toFixed(2);
}

// Function to fetch related articles from Benzinga
async function fetchRelatedArticles(ticker: string, excludeUrl?: string): Promise<any[]> {
  try {
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - 7);
    const dateFromStr = dateFrom.toISOString().slice(0, 10);
    
    let url: string;
    
    if (ticker && ticker.trim() !== '') {
      // Fetch ticker-specific articles
      url = `${BZ_NEWS_URL}?token=${process.env.BENZINGA_API_KEY}&tickers=${encodeURIComponent(ticker)}&items=20&fields=headline,title,created,url,channels&accept=application/json&displayOutput=full&dateFrom=${dateFromStr}`;
    } else {
      // Fetch general market news when no ticker is provided
      url = `${BZ_NEWS_URL}?token=${process.env.BENZINGA_API_KEY}&items=20&fields=headline,title,created,url,channels&accept=application/json&displayOutput=full&dateFrom=${dateFromStr}`;
    }
    
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    
    if (!res.ok) {
      console.error('Benzinga API error:', await res.text());
      return [];
    }
    
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    
    // Filter out press releases and the current article URL
    const prChannelNames = ['press releases', 'press-releases', 'pressrelease', 'pr'];
    const normalize = (str: string) => str.toLowerCase().replace(/[-_]/g, ' ');
    
    const filteredArticles = data.filter(item => {
      // Exclude press releases
      if (Array.isArray(item.channels) && item.channels.some((ch: any) => 
        typeof ch.name === 'string' && prChannelNames.includes(normalize(ch.name))
      )) {
        return false;
      }
      
      // Exclude the current article URL if provided
      if (excludeUrl && item.url === excludeUrl) {
        return false;
      }
      
      return true;
    });
    
    const relatedArticles = filteredArticles
      .map((item: any) => ({
        headline: item.headline || item.title || '[No Headline]',
        url: item.url,
        created: item.created,
      }))
      .slice(0, 5);
    
    return relatedArticles;
  } catch (error) {
    console.error('Error fetching related articles:', error);
    return [];
  }
}

// Fetch price data from Benzinga API (shared helper for both price action line and sync)
async function fetchPriceDataFromBenzinga(ticker: string): Promise<{ quote: any; changePercent: number | undefined } | null> {
  try {
    const BENZINGA_API_KEY = process.env.BENZINGA_API_KEY;
    if (!BENZINGA_API_KEY) {
      console.error('[PRICE DATA] BENZINGA_API_KEY not found');
      return null;
    }
    
    const url = `https://api.benzinga.com/api/v2/quoteDelayed?token=${BENZINGA_API_KEY}&symbols=${ticker}`;
    const res = await fetch(url);
    
    if (!res.ok) {
      console.error(`[PRICE DATA] Failed to fetch price data for ${ticker}:`, res.statusText);
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
    
    // Use Benzinga's changePercent if provided - don't override it with manual calculations
    // During open market hours, if changePercent is 0, it might not be updated yet by Benzinga's delayed feed
    // In that case, we'll skip showing the percentage to avoid misleading "unchanged 0.00%" messages
    const changePercent = typeof quote.changePercent === 'number' ? quote.changePercent : undefined;
    return { quote, changePercent };
  } catch (error) {
    console.error(`[PRICE DATA] Error fetching price data for ${ticker}:`, error);
    return null;
  }
}

// Generate price action using Benzinga API (matching price-action route logic)
async function generatePriceAction(ticker: string): Promise<string> {
  try {
    // Fetch price action data directly from Benzinga API
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
    
    // Get current day name in Eastern Time (not the close date, which might be previous day)
    // Markets are closed on weekends, so return Friday for Saturday/Sunday
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'long',
    });
    const currentDayName = formatter.format(now);
    // If it's a weekend, return Friday as the last trading day
    const dayOfWeek = (currentDayName === 'Sunday' || currentDayName === 'Saturday') ? 'Friday' : currentDayName;
    const isWeekend = currentDayName === 'Sunday' || currentDayName === 'Saturday';
    
    // Calculate regular session and after-hours changes separately
    let regularSessionChange = 0;
    let afterHoursChange = 0;
    let regularUpDown = '';
    let afterHoursUpDown = '';
    
    if (marketStatus === 'afterhours' && quote.close && quote.lastTradePrice && quote.previousClosePrice) {
      // Regular session change: (regular_close - previous_close) / previous_close * 100
      regularSessionChange = ((quote.close - quote.previousClosePrice) / quote.previousClosePrice) * 100;
      regularUpDown = regularSessionChange > 0 ? 'up' : regularSessionChange < 0 ? 'down' : 'unchanged';
      
      // After-hours change: (current - regular_close) / regular_close * 100
      afterHoursChange = ((quote.lastTradePrice - quote.close) / quote.close) * 100;
      afterHoursUpDown = afterHoursChange > 0 ? 'up' : afterHoursChange < 0 ? 'down' : 'unchanged';
    }
    
    // Format price to ensure exactly 2 decimal places
    const lastPrice = typeof quote.lastTradePrice === 'number' ? quote.lastTradePrice : parseFloat(quote.lastTradePrice);
    const formattedPrice = lastPrice.toFixed(2);
    const priceString = String(formattedPrice);
    
    // During open market hours, if changePercent is 0 or missing, skip the change percentage
    // (Benzinga's delayed feed may not have updated it yet, showing 0.00% is misleading)
    // For other market statuses (premarket, afterhours, closed), show 0 if provided (stock truly unchanged)
    const shouldShowChangePercent = marketStatus === 'open'
      ? (changePercent !== undefined && changePercent !== 0)
      : changePercent !== undefined;
    
    const changePercentForCalc = changePercent ?? 0;
    const upDown = changePercentForCalc > 0 ? 'up' : changePercentForCalc < 0 ? 'down' : 'unchanged';
    const absChange = Math.abs(changePercentForCalc).toFixed(2);
    
    // Build price action text with explicit string concatenation
    let priceActionText = '';
    
    if (marketStatus === 'open') {
      if (shouldShowChangePercent) {
        priceActionText = `${symbol} Price Action: ${companyName} shares were ${upDown} ${absChange}% at $${priceString} at the time of publication on ${dayOfWeek}`;
      } else {
        // Skip change percentage if it's 0 and we couldn't calculate it (Benzinga hasn't updated yet)
        priceActionText = `${symbol} Price Action: ${companyName} shares were trading at $${priceString} at the time of publication on ${dayOfWeek}`;
      }
    } else if (marketStatus === 'afterhours' && quote.close && quote.lastTradePrice && quote.previousClosePrice) {
      // Show both regular session and after-hours moves when we have the necessary data
      const absRegularChange = Math.abs(regularSessionChange).toFixed(2);
      const absAfterHoursChange = Math.abs(afterHoursChange).toFixed(2);
      priceActionText = `${symbol} Price Action: ${companyName} shares were ${regularUpDown} ${absRegularChange}% during regular trading and ${afterHoursUpDown} ${absAfterHoursChange}% in after-hours trading on ${dayOfWeek}, last trading at $${priceString}`;
    } else {
      // For premarket/closed, use standard format
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
        // For premarket/closed/afterhours, if changePercent is undefined, just show price
        priceActionText = `${symbol} Price Action: ${companyName} shares were trading at $${priceString}${marketStatusPhrase}${timePhrase} on ${dayOfWeek}`;
      }
    }
    
    // Only bold the ticker prefix (e.g., "MSFT Price Action:"), not the entire line
    const prefixMatch = priceActionText.match(/^([A-Z]+\s+Price Action:)\s+(.+)$/);
    if (prefixMatch) {
      const prefix = prefixMatch[1];
      const rest = prefixMatch[2];
      return `<strong>${prefix}</strong> ${rest}, according to <a href="https://pro.benzinga.com/dashboard">Benzinga Pro data</a>.`;
    }
    // Fallback: if pattern doesn't match, return as-is with prefix bolded
    return `<strong>${priceActionText}</strong>, according to <a href="https://pro.benzinga.com/dashboard">Benzinga Pro data</a>.`;
  } catch (error) {
    console.error(`Error generating price action for ${ticker}:`, error);
    return '';
  }
}



// Interface for technical analysis data

interface TechnicalAnalysisData {

  symbol: string;

  companyName: string;
  companyNameWithExchange?: string;

  currentPrice: number;
  regularSessionClosePrice?: number; // Regular session close price (separate from after-hours current price)

  changePercent: number;

  

  // Multi-timeframe returns

  twelveMonthReturn?: number;

  

  // Moving averages

  sma20?: number;

  sma50?: number;

  sma100?: number;

  sma200?: number;

  ema20?: number;

  ema50?: number;

  ema100?: number;

  ema200?: number;

  

  // Technical indicators

  rsi?: number;

  rsiSignal?: 'overbought' | 'oversold' | 'neutral';

  macd?: number;

  macdSignal?: number;

  macdHistogram?: number;

  

  // Support/Resistance

  supportLevel?: number | null;

  resistanceLevel?: number | null;

  

  // 52-week range

  fiftyTwoWeekHigh: number;

  fiftyTwoWeekLow: number;

  

  // Volume

  volume?: number;

  averageVolume?: number;

  

  // Market cap

  marketCap?: number;

  // Company description from Polygon
  description?: string | null;

  

  // Analysis output

  analysis?: string;

  

    // Turning points

    turningPoints?: {

      rsiOverboughtDate?: string;

      rsiOversoldDate?: string;

      goldenCrossDate?: string;

      deathCrossDate?: string;

      macdBullishCrossDate?: string; // MACD crosses above signal line

      macdBearishCrossDate?: string; // MACD crosses below signal line

      macdZeroCrossAboveDate?: string; // MACD crosses above zero

      macdZeroCrossBelowDate?: string; // MACD crosses below zero

      recentSwingHighDate?: string;

      recentSwingLowDate?: string;

      fiftyTwoWeekHighDate?: string;

      fiftyTwoWeekLowDate?: string;

      supportBreakDate?: string;

      resistanceBreakDate?: string;

    };

}



// Fetch historical data for different timeframes

async function fetchHistoricalBars(symbol: string, multiplier: number, timespan: 'day' | 'week' | 'month', from: string, to: string) {

  try {

    const url = `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/${multiplier}/${timespan}/${from}/${to}?adjusted=true&apikey=${process.env.POLYGON_API_KEY}`;

    const response = await fetch(url);

    

    if (!response.ok) {

      console.log(`Historical bars API returned status ${response.status} for ${symbol}`);

      return null;

    }

    

    const data = await response.json();

    return data.results || [];

  } catch (error) {

    console.error(`Error fetching historical bars for ${symbol}:`, error);

    return null;

  }

}



// Fetch RSI (current)

async function fetchRSI(symbol: string): Promise<{ rsi: number | undefined; signal: 'overbought' | 'oversold' | 'neutral' }> {

  try {

    const date = new Date();

    const dayOfWeek = date.getDay();

    

    if (dayOfWeek === 1) date.setDate(date.getDate() - 3);

    else if (dayOfWeek === 0) date.setDate(date.getDate() - 2);

    else if (dayOfWeek === 6) date.setDate(date.getDate() - 1);

    else date.setDate(date.getDate() - 1);

    

    const yesterdayStr = date.toISOString().split('T')[0];

    const rsiUrl = `https://api.polygon.io/v1/indicators/rsi/${symbol}?timestamp=${yesterdayStr}&timespan=day&adjusted=true&window=14&series_type=close&order=desc&limit=1&apikey=${process.env.POLYGON_API_KEY}`;

    

    const response = await fetch(rsiUrl);

    if (!response.ok) return { rsi: undefined, signal: 'neutral' };

    

    const data = await response.json();

    if (data.results?.values && data.results.values.length > 0) {

      const rsiValue = data.results.values[0].value;

      let signal: 'overbought' | 'oversold' | 'neutral' = 'neutral';

      if (rsiValue >= 70) signal = 'overbought';

      else if (rsiValue <= 30) signal = 'oversold';

      return { rsi: rsiValue, signal };

    }

    return { rsi: undefined, signal: 'neutral' };

  } catch (error) {

    console.error(`Error fetching RSI for ${symbol}:`, error);

    return { rsi: undefined, signal: 'neutral' };

  }

}



// Fetch historical RSI values to detect turning points

async function fetchHistoricalRSI(symbol: string, fromDate: string, toDate: string): Promise<Array<{ value: number; timestamp: number }>> {

  try {

    const rsiUrl = `https://api.polygon.io/v1/indicators/rsi/${symbol}?timestamp.gte=${fromDate}&timestamp.lte=${toDate}&timespan=day&adjusted=true&window=14&series_type=close&order=desc&limit=250&apikey=${process.env.POLYGON_API_KEY}`;

    const response = await fetch(rsiUrl);

    if (!response.ok) return [];

    

    const data = await response.json();

    if (data.results?.values && data.results.values.length > 0) {

      return data.results.values.map((v: { value: number; timestamp: number }) => ({

        value: v.value,

        timestamp: v.timestamp

      }));

    }

    return [];

  } catch (error) {

    console.error(`Error fetching historical RSI for ${symbol}:`, error);

    return [];

  }

}



// Fetch historical SMA values to detect crossovers

async function fetchHistoricalSMA(symbol: string, window: number, fromDate: string, toDate: string): Promise<Array<{ value: number; timestamp: number }>> {

  try {

    const smaUrl = `https://api.polygon.io/v1/indicators/sma/${symbol}?timestamp.gte=${fromDate}&timestamp.lte=${toDate}&timespan=day&adjusted=true&window=${window}&series_type=close&order=desc&limit=250&apikey=${process.env.POLYGON_API_KEY}`;

    const response = await fetch(smaUrl);

    if (!response.ok) return [];

    

    const data = await response.json();

    if (data.results?.values && data.results.values.length > 0) {

      return data.results.values.map((v: { value: number; timestamp: number }) => ({

        value: v.value,

        timestamp: v.timestamp

      }));

    }

    return [];

  } catch (error) {

    console.error(`Error fetching historical SMA-${window} for ${symbol}:`, error);

    return [];

  }

}



// Fetch SMA

async function fetchSMA(symbol: string, window: number): Promise<number | undefined> {

  try {

    const date = new Date();

    const dayOfWeek = date.getDay();

    if (dayOfWeek === 1) date.setDate(date.getDate() - 3);

    else if (dayOfWeek === 0) date.setDate(date.getDate() - 2);

    else if (dayOfWeek === 6) date.setDate(date.getDate() - 1);

    else date.setDate(date.getDate() - 1);

    

    const yesterdayStr = date.toISOString().split('T')[0];

    const smaUrl = `https://api.polygon.io/v1/indicators/sma/${symbol}?timestamp=${yesterdayStr}&timespan=day&adjusted=true&window=${window}&series_type=close&order=desc&limit=1&apikey=${process.env.POLYGON_API_KEY}`;

    

    const response = await fetch(smaUrl);

    if (!response.ok) return undefined;

    

    const data = await response.json();

    if (data.results?.values && data.results.values.length > 0) {

      return data.results.values[0].value;

    }

    return undefined;

  } catch (error) {

    console.error(`Error fetching SMA-${window} for ${symbol}:`, error);

    return undefined;

  }

}



// Fetch EMA

async function fetchEMA(symbol: string, window: number): Promise<number | undefined> {

  try {

    const date = new Date();

    const dayOfWeek = date.getDay();

    if (dayOfWeek === 1) date.setDate(date.getDate() - 3);

    else if (dayOfWeek === 0) date.setDate(date.getDate() - 2);

    else if (dayOfWeek === 6) date.setDate(date.getDate() - 1);

    else date.setDate(date.getDate() - 1);

    

    const yesterdayStr = date.toISOString().split('T')[0];

    const emaUrl = `https://api.polygon.io/v1/indicators/ema/${symbol}?timestamp=${yesterdayStr}&timespan=day&adjusted=true&window=${window}&series_type=close&order=desc&limit=1&apikey=${process.env.POLYGON_API_KEY}`;

    

    const response = await fetch(emaUrl);

    if (!response.ok) return undefined;

    

    const data = await response.json();

    if (data.results?.values && data.results.values.length > 0) {

      return data.results.values[0].value;

    }

    return undefined;

  } catch (error) {

    console.error(`Error fetching EMA-${window} for ${symbol}:`, error);

    return undefined;

  }

}



// Fetch MACD (current values)

async function fetchMACD(symbol: string): Promise<{ macd: number | undefined; signal: number | undefined; histogram: number | undefined }> {

  try {

    const date = new Date();

    const dayOfWeek = date.getDay();

    if (dayOfWeek === 1) date.setDate(date.getDate() - 3);

    else if (dayOfWeek === 0) date.setDate(date.getDate() - 2);

    else if (dayOfWeek === 6) date.setDate(date.getDate() - 1);

    else date.setDate(date.getDate() - 1);

    

    const yesterdayStr = date.toISOString().split('T')[0];

    const macdUrl = `https://api.polygon.io/v1/indicators/macd/${symbol}?timestamp=${yesterdayStr}&timespan=day&adjusted=true&short_window=12&long_window=26&signal_window=9&series_type=close&order=desc&limit=1&apikey=${process.env.POLYGON_API_KEY}`;

    

    const response = await fetch(macdUrl);

    if (!response.ok) return { macd: undefined, signal: undefined, histogram: undefined };

    

    const data = await response.json();

    

    if (data.results?.values && data.results.values.length > 0) {

      const value = data.results.values[0];

      // Polygon MACD API returns: value.value = MACD line, value.signal = signal line, value.histogram = histogram

      const macdResult = {

        macd: value.value, // MACD line is directly in value.value (a number)

        signal: value.signal, // Signal line is directly in value.signal

        histogram: value.histogram // Histogram is directly in value.histogram

      };

      console.log(`[MACD DATA] Fetched for ${symbol}:`, macdResult);

      return macdResult;

    }

    console.log(`[MACD DATA] No MACD data found for ${symbol}`);

    return { macd: undefined, signal: undefined, histogram: undefined };

  } catch (error) {

    console.error(`Error fetching MACD for ${symbol}:`, error);

    return { macd: undefined, signal: undefined, histogram: undefined };

  }

}



// Fetch historical MACD values to detect crossovers

async function fetchHistoricalMACD(symbol: string, fromDate: string, toDate: string): Promise<Array<{ macd: number; signal: number; histogram: number; timestamp: number }>> {

  try {

    const macdUrl = `https://api.polygon.io/v1/indicators/macd/${symbol}?timestamp.gte=${fromDate}&timestamp.lte=${toDate}&timespan=day&adjusted=true&short_window=12&long_window=26&signal_window=9&series_type=close&order=desc&limit=250&apikey=${process.env.POLYGON_API_KEY}`;

    const response = await fetch(macdUrl);

    if (!response.ok) return [];

    

    const data = await response.json();

    if (data.results?.values && data.results.values.length > 0) {

      return data.results.values

        .filter((v: { value?: number; signal?: number; histogram?: number; timestamp: number }) => 

          v.value !== undefined && v.signal !== undefined && v.histogram !== undefined

        )

        .map((v: { value: number; signal: number; histogram: number; timestamp: number }) => ({

          macd: v.value, // MACD line is directly in value (a number)

          signal: v.signal, // Signal line is directly in signal

          histogram: v.histogram, // Histogram is directly in histogram

          timestamp: v.timestamp

        }));

    }

    return [];

  } catch (error) {

    console.error(`Error fetching historical MACD for ${symbol}:`, error);

    return [];

  }

}



// Analyze turning points from historical data

function analyzeTurningPoints(

  dailyBars: { h: number; l: number; c: number; t: number }[],

  historicalRSI: Array<{ value: number; timestamp: number }>,

  historicalSMA50: Array<{ value: number; timestamp: number }>,

  historicalSMA200: Array<{ value: number; timestamp: number }>,

  historicalMACD: Array<{ macd: number; signal: number; histogram: number; timestamp: number }>,

  currentPrice: number,

  supportLevel: number | null,

  resistanceLevel: number | null,

  fiftyTwoWeekHigh: number,

  fiftyTwoWeekLow: number

) {

  const turningPoints: {

    rsiOverboughtDate?: string;

    rsiOversoldDate?: string;

    goldenCrossDate?: string;

    deathCrossDate?: string;

    macdBullishCrossDate?: string;

    macdBearishCrossDate?: string;

    macdZeroCrossAboveDate?: string;

    macdZeroCrossBelowDate?: string;

    recentSwingHighDate?: string;

    recentSwingLowDate?: string;

    fiftyTwoWeekHighDate?: string;

    fiftyTwoWeekLowDate?: string;

    supportBreakDate?: string;

    resistanceBreakDate?: string;

  } = {};



  // Find RSI turning points (most recent crossing of 70 or 30)

  if (historicalRSI.length > 1) {

    // Sort by timestamp descending (newest first)

    const sortedRSI = [...historicalRSI].sort((a, b) => b.timestamp - a.timestamp);

    

    for (let i = 0; i < sortedRSI.length - 1; i++) {

      const current = sortedRSI[i];

      const previous = sortedRSI[i + 1];

      

      // Check for crossing into overbought (crossing above 70)

      if (current.value >= 70 && previous.value < 70 && !turningPoints.rsiOverboughtDate) {

        turningPoints.rsiOverboughtDate = new Date(current.timestamp).toISOString().split('T')[0];

      }

      

      // Check for crossing into oversold (crossing below 30)

      if (current.value <= 30 && previous.value > 30 && !turningPoints.rsiOversoldDate) {

        turningPoints.rsiOversoldDate = new Date(current.timestamp).toISOString().split('T')[0];

      }

    }

  }



  // Find moving average crossovers

  if (historicalSMA50.length > 0 && historicalSMA200.length > 0) {

    // Create maps for easier lookup

    const sma50Map = new Map(historicalSMA50.map(s => [s.timestamp, s.value]));

    const sma200Map = new Map(historicalSMA200.map(s => [s.timestamp, s.value]));

    

    // Only use timestamps where BOTH SMAs have data

    const allTimestamps = Array.from(sma50Map.keys())

      .filter(ts => sma200Map.has(ts))

      .sort((a, b) => a - b);

    

    if (allTimestamps.length === 0) {

      console.log('[CROSSOVER] No overlapping timestamps between SMA50 and SMA200');

      return turningPoints;

    }

    

    // Check current state (most recent data point)

    const latestTimestamp = allTimestamps[allTimestamps.length - 1];

    const latestSMA50 = sma50Map.get(latestTimestamp);

    const latestSMA200 = sma200Map.get(latestTimestamp);

    const isCurrentlyGoldenCross = latestSMA50 && latestSMA200 && latestSMA50 > latestSMA200;

    const isCurrentlyDeathCross = latestSMA50 && latestSMA200 && latestSMA50 < latestSMA200;

    

    // Find all golden crosses (oldest first)

    const goldenCrossDates: string[] = [];

    const deathCrossDates: string[] = [];

    

    for (let i = 1; i < allTimestamps.length; i++) {

      const currentTs = allTimestamps[i];

      const previousTs = allTimestamps[i - 1];

      

      const currentSMA50 = sma50Map.get(currentTs);

      const currentSMA200 = sma200Map.get(currentTs);

      const previousSMA50 = sma50Map.get(previousTs);

      const previousSMA200 = sma200Map.get(previousTs);

      

      // All values should exist since we filtered for overlapping timestamps

      if (currentSMA50 && currentSMA200 && previousSMA50 && previousSMA200) {

        // Golden cross: 50 crosses above 200

        if (currentSMA50 > currentSMA200 && previousSMA50 <= previousSMA200) {

          const dateStr = new Date(currentTs).toISOString().split('T')[0];

          goldenCrossDates.push(dateStr);

          console.log(`[GOLDEN CROSS DETECTED] Date: ${dateStr}, SMA50: ${currentSMA50.toFixed(2)}, SMA200: ${currentSMA200.toFixed(2)}, Previous SMA50: ${previousSMA50.toFixed(2)}, Previous SMA200: ${previousSMA200.toFixed(2)}`);

        }

        

        // Death cross: 50 crosses below 200

        if (currentSMA50 < currentSMA200 && previousSMA50 >= previousSMA200) {

          const dateStr = new Date(currentTs).toISOString().split('T')[0];

          deathCrossDates.push(dateStr);

          console.log(`[DEATH CROSS DETECTED] Date: ${dateStr}, SMA50: ${currentSMA50.toFixed(2)}, SMA200: ${currentSMA200.toFixed(2)}, Previous SMA50: ${previousSMA50.toFixed(2)}, Previous SMA200: ${previousSMA200.toFixed(2)}`);

        }

      }

    }

    

    console.log(`[CROSSOVER SUMMARY] Golden crosses found: ${goldenCrossDates.join(', ')}, Death crosses found: ${deathCrossDates.join(', ')}, Currently in golden cross: ${isCurrentlyGoldenCross}`);

    

    // If currently in golden cross state, use the oldest (first) golden cross that's still active

    // This means finding the oldest golden cross that hasn't been negated by a subsequent death cross

    if (isCurrentlyGoldenCross && goldenCrossDates.length > 0) {

      // Find the most recent death cross (if any)

      const mostRecentDeathCross = deathCrossDates.length > 0 ? deathCrossDates[deathCrossDates.length - 1] : null;

      

      // Find the oldest golden cross that occurred after the most recent death cross (or the oldest if no death cross)

      if (mostRecentDeathCross) {

        const deathCrossDate = new Date(mostRecentDeathCross);

        const oldestActiveGoldenCross = goldenCrossDates.find(gcDate => new Date(gcDate) > deathCrossDate);

        if (oldestActiveGoldenCross) {

          turningPoints.goldenCrossDate = oldestActiveGoldenCross;

        } else if (goldenCrossDates.length > 0) {

          // If all golden crosses are before the death cross, use the most recent one (after death cross, we're in a new golden cross)

          turningPoints.goldenCrossDate = goldenCrossDates[goldenCrossDates.length - 1];

        }

      } else {

        // No death cross, use the oldest golden cross

        turningPoints.goldenCrossDate = goldenCrossDates[0];

      }

    }

    

    // If currently in death cross state, use the most recent death cross

    // Always include the most recent death cross if it exists (let prompt decide if it's too old)

    if (isCurrentlyDeathCross && deathCrossDates.length > 0) {

      turningPoints.deathCrossDate = deathCrossDates[deathCrossDates.length - 1];

    } else if (deathCrossDates.length > 0) {

      // Include the most recent death cross regardless of age - we'll filter in prompt if needed

      turningPoints.deathCrossDate = deathCrossDates[deathCrossDates.length - 1];

    }

  }



  // Find MACD crossovers

  if (historicalMACD.length > 1) {

    // Sort by timestamp ascending (oldest first)

    const sortedMACD = [...historicalMACD].sort((a, b) => a.timestamp - b.timestamp);

    

    for (let i = 1; i < sortedMACD.length; i++) {

      const current = sortedMACD[i];

      const previous = sortedMACD[i - 1];

      

      // Bullish cross: MACD crosses above signal line

      if (current.macd > current.signal && previous.macd <= previous.signal && !turningPoints.macdBullishCrossDate) {

        turningPoints.macdBullishCrossDate = new Date(current.timestamp).toISOString().split('T')[0];

      }

      

      // Bearish cross: MACD crosses below signal line

      if (current.macd < current.signal && previous.macd >= previous.signal && !turningPoints.macdBearishCrossDate) {

        turningPoints.macdBearishCrossDate = new Date(current.timestamp).toISOString().split('T')[0];

      }

      

      // Zero line cross above: MACD crosses above zero

      if (current.macd > 0 && previous.macd <= 0 && !turningPoints.macdZeroCrossAboveDate) {

        turningPoints.macdZeroCrossAboveDate = new Date(current.timestamp).toISOString().split('T')[0];

      }

      

      // Zero line cross below: MACD crosses below zero

      if (current.macd < 0 && previous.macd >= 0 && !turningPoints.macdZeroCrossBelowDate) {

        turningPoints.macdZeroCrossBelowDate = new Date(current.timestamp).toISOString().split('T')[0];

      }

    }

  }



  // Find swing points with dates

  if (dailyBars && dailyBars.length > 4) {

    const sortedBars = [...dailyBars].sort((a, b) => a.t - b.t);

    const recentBars = sortedBars.slice(-60); // Last 60 days

    

    let recentSwingHigh: { price: number; date: string } | null = null;

    let recentSwingLow: { price: number; date: string } | null = null;

    

    for (let i = 2; i < recentBars.length - 2; i++) {

      const current = recentBars[i];

      const prev2 = recentBars[i - 2];

      const prev1 = recentBars[i - 1];

      const next1 = recentBars[i + 1];

      const next2 = recentBars[i + 2];

      

      // Swing high

      if (current.h > prev2.h && current.h > prev1.h && current.h > next1.h && current.h > next2.h) {

        if (!recentSwingHigh || current.h > recentSwingHigh.price) {

          recentSwingHigh = {

            price: current.h,

            date: new Date(current.t).toISOString().split('T')[0]

          };

        }

      }

      

      // Swing low

      if (current.l < prev2.l && current.l < prev1.l && current.l < next1.l && current.l < next2.l) {

        if (!recentSwingLow || current.l < recentSwingLow.price) {

          recentSwingLow = {

            price: current.l,

            date: new Date(current.t).toISOString().split('T')[0]

          };

        }

      }

    }

    

    if (recentSwingHigh) turningPoints.recentSwingHighDate = recentSwingHigh.date;

    if (recentSwingLow) turningPoints.recentSwingLowDate = recentSwingLow.date;

  }



  // Find 52-week high/low dates

  if (dailyBars && dailyBars.length > 0) {

    let highBar = dailyBars[0];

    let lowBar = dailyBars[0];

    

    dailyBars.forEach(bar => {

      if (bar.h >= fiftyTwoWeekHigh - 0.01) { // Allow small rounding difference

        if (!highBar || bar.h > highBar.h || (bar.h === highBar.h && bar.t > highBar.t)) {

          highBar = bar;

        }

      }

      if (bar.l <= fiftyTwoWeekLow + 0.01) {

        if (!lowBar || bar.l < lowBar.l || (bar.l === lowBar.l && bar.t > lowBar.t)) {

          lowBar = bar;

        }

      }

    });

    

    if (highBar.h >= fiftyTwoWeekHigh - 0.01) {

      turningPoints.fiftyTwoWeekHighDate = new Date(highBar.t).toISOString().split('T')[0];

    }

    if (lowBar.l <= fiftyTwoWeekLow + 0.01) {

      turningPoints.fiftyTwoWeekLowDate = new Date(lowBar.t).toISOString().split('T')[0];

    }

  }



  // Detect support/resistance breaks (price crossing these levels)

  if (dailyBars && dailyBars.length > 1 && (supportLevel || resistanceLevel)) {

    const sortedBars = [...dailyBars].sort((a, b) => b.t - a.t); // Newest first

    

    // Check for resistance break (price crossing above resistance)

    if (resistanceLevel) {

      for (let i = 0; i < sortedBars.length - 1; i++) {

        const current = sortedBars[i];

        const previous = sortedBars[i + 1];

        

        if (current.c > resistanceLevel && previous.c <= resistanceLevel) {

          turningPoints.resistanceBreakDate = new Date(current.t).toISOString().split('T')[0];

          break;

        }

      }

    }

    

    // Check for support break (price crossing below support)

    if (supportLevel) {

      for (let i = 0; i < sortedBars.length - 1; i++) {

        const current = sortedBars[i];

        const previous = sortedBars[i + 1];

        

        if (current.c < supportLevel && previous.c >= supportLevel) {

          turningPoints.supportBreakDate = new Date(current.t).toISOString().split('T')[0];

          break;

        }

      }

    }

  }



  return turningPoints;

}



// Calculate support/resistance from historical data

function calculateSupportResistance(historicalData: { h: number; l: number; c: number; t?: number }[], currentPrice: number) {

  if (!historicalData || historicalData.length < 30) {

    console.log('[SUPPORT/RESISTANCE] Not enough data (need at least 30 days)');

    return { support: null, resistance: null };

  }



  // Use larger timeframes for more significant levels

  const last90Days = historicalData.slice(-90);  // Last 3 months

  const last180Days = historicalData.slice(-180); // Last 6 months

  const last252Days = historicalData.slice(-252); // Last year (trading days)

  

  // Use larger swing detection window (5 days instead of 2) for more significant swings

  const findSwings = (data: typeof historicalData, windowSize: number = 5) => {

    const swingHighs: Array<{price: number; timestamp: number}> = [];

    const swingLows: Array<{price: number; timestamp: number}> = [];

    

    for (let i = windowSize; i < data.length - windowSize; i++) {

      const current = data[i];

      let isSwingHigh = true;

      let isSwingLow = true;

      

      // Check if current high is higher than all surrounding days within the window

      for (let j = i - windowSize; j <= i + windowSize; j++) {

        if (j !== i) {

          if (current.h <= data[j].h) isSwingHigh = false;

          if (current.l >= data[j].l) isSwingLow = false;

        }

      }

      

      if (isSwingHigh) {

        swingHighs.push({price: current.h, timestamp: current.t || 0});

      }

      if (isSwingLow) {

        swingLows.push({price: current.l, timestamp: current.t || 0});

      }

    }

    return { swingHighs, swingLows };

  };

  

  // Find swings with larger window (5 days) for more significant levels

  const recent = findSwings(last90Days, 5);

  const extended = findSwings(last180Days, 5);

  const fullYear = findSwings(last252Days, 5);

  

  // Combine all swings, prioritizing more recent ones

  const allSwingHighs = [...recent.swingHighs, ...extended.swingHighs, ...fullYear.swingHighs];

  const allSwingLows = [...recent.swingLows, ...extended.swingLows, ...fullYear.swingLows];

  

  console.log(`[SUPPORT/RESISTANCE] Found ${allSwingHighs.length} swing highs and ${allSwingLows.length} swing lows`);

  

  // Cluster swings that are close together (within $1.00) and count touches

  // This helps identify levels that have been tested multiple times (more significant)

  const clusterSwings = (swings: Array<{price: number; timestamp: number}>, clusterSize: number = 1.0) => {

    const clusters: Array<{price: number; touches: number; avgPrice: number}> = [];

    

    swings.forEach(swing => {

      // Find existing cluster within clusterSize

      const existingCluster = clusters.find(c => Math.abs(c.avgPrice - swing.price) <= clusterSize);

      

      if (existingCluster) {

        // Add to existing cluster

        existingCluster.touches++;

        existingCluster.avgPrice = (existingCluster.avgPrice * (existingCluster.touches - 1) + swing.price) / existingCluster.touches;

      } else {

        // Create new cluster

        clusters.push({ price: swing.price, touches: 1, avgPrice: swing.price });

      }

    });

    

    return clusters.sort((a, b) => b.touches - a.touches); // Sort by number of touches (most tested first)

  };

  

  const clusteredHighs = clusterSwings(allSwingHighs, 1.0);

  const clusteredLows = clusterSwings(allSwingLows, 1.0);

  

  console.log(`[SUPPORT/RESISTANCE] Found ${allSwingHighs.length} swing highs and ${allSwingLows.length} swing lows`);

  console.log(`[SUPPORT/RESISTANCE] After clustering: ${clusteredHighs.length} resistance clusters, ${clusteredLows.length} support clusters`);

  console.log(`[SUPPORT/RESISTANCE] Current price: $${currentPrice.toFixed(2)}`);

  

  const now = Date.now();

  const sixtyDaysAgo = now - (60 * 24 * 60 * 60 * 1000);

  

  // Filter resistance: above current price, within 20% (expanded from 15%), prioritize recent and well-tested

  const resistanceCandidates = clusteredHighs

    .filter(c => c.avgPrice > currentPrice && c.avgPrice < currentPrice * 1.20)

    .map(c => ({

      price: c.avgPrice,

      touches: c.touches,

      // Check if any swing in this cluster is recent

      isRecent: allSwingHighs.some(s => Math.abs(s.price - c.avgPrice) <= 1.0 && s.timestamp > sixtyDaysAgo)

    }))

    .sort((a, b) => {

      // Prioritize: 1) Recent levels, 2) More touches, 3) Closer to current price

      if (a.isRecent && !b.isRecent) return -1;

      if (!a.isRecent && b.isRecent) return 1;

      if (a.touches !== b.touches) return b.touches - a.touches;

      return a.price - b.price;

    });

  

  // Filter support: below current price, within 20% (expanded from 15%), prioritize recent and well-tested

  const supportCandidates = clusteredLows

    .filter(c => c.avgPrice < currentPrice && c.avgPrice > currentPrice * 0.80)

    .map(c => ({

      price: c.avgPrice,

      touches: c.touches,

      // Check if any swing in this cluster is recent

      isRecent: allSwingLows.some(s => Math.abs(s.price - c.avgPrice) <= 1.0 && s.timestamp > sixtyDaysAgo)

    }))

    .sort((a, b) => {

      // Prioritize: 1) Recent levels, 2) More touches, 3) Closer to current price

      if (a.isRecent && !b.isRecent) return -1;

      if (!a.isRecent && b.isRecent) return 1;

      if (a.touches !== b.touches) return b.touches - a.touches;

      return b.price - a.price; // Descending for support (higher is better)

    });

  

  console.log(`[SUPPORT/RESISTANCE] Resistance candidates (above $${currentPrice.toFixed(2)}, within 20%):`, 

    resistanceCandidates.map(c => `$${c.price.toFixed(2)} (${c.touches} touches${c.isRecent ? ', recent' : ''})`).join(', ') || 'none');

  console.log(`[SUPPORT/RESISTANCE] Support candidates (below $${currentPrice.toFixed(2)}, within 20%):`, 

    supportCandidates.map(c => `$${c.price.toFixed(2)} (${c.touches} touches${c.isRecent ? ', recent' : ''})`).join(', ') || 'none');

  

  // Round to nearest $0.50 for cleaner levels (traders don't need penny precision)

  const resistance = resistanceCandidates.length > 0 

    ? Math.round(resistanceCandidates[0].price * 2) / 2  // Round to nearest $0.50

    : null;

  const support = supportCandidates.length > 0 

    ? Math.round(supportCandidates[0].price * 2) / 2  // Round to nearest $0.50

    : null;

  

  console.log(`[SUPPORT/RESISTANCE] Final levels - Support: $${support?.toFixed(2) || 'N/A'}, Resistance: $${resistance?.toFixed(2) || 'N/A'}`);

  

  return { support, resistance };

}



// Calculate period returns

function calculatePeriodReturn(bars: { c: number; t: number }[], startDate: Date, endDate: Date): number | undefined {

  if (!bars || bars.length === 0) return undefined;

  

  // Sort bars by timestamp (oldest first) to ensure correct order

  const sortedBars = [...bars].sort((a, b) => a.t - b.t);

  

  const startTime = startDate.getTime();

  const endTime = endDate.getTime();

  

  // Find the closest bar to start date (prefer bar on or after start, but use closest if none after)

  // This handles weekends/holidays by finding the nearest trading day

  let startBar = sortedBars.find(bar => bar.t >= startTime);

  if (!startBar) {

    // If no bar found after start, find the closest bar before start

    const barsBefore = sortedBars.filter(bar => bar.t < startTime);

    if (barsBefore.length > 0) {

      // Get the bar closest to startTime (last one before start)

      startBar = barsBefore[barsBefore.length - 1];

    } else {

      // Fallback to first bar if no bars before start

      startBar = sortedBars[0];

    }

  }

  

  // For end date, find the closest bar to endTime (prefer bar on or before end)

  // This ensures we use actual trading data, not trying to match exact "now" timestamp

  let endBar = sortedBars.filter(bar => bar.t <= endTime).pop(); // Last bar on or before end

  if (!endBar) {

    // If no bar before end, use the first bar after end (shouldn't happen, but safety check)

    endBar = sortedBars.find(bar => bar.t > endTime) || sortedBars[sortedBars.length - 1];

  }

  

  if (!startBar || !endBar || !startBar.c || !endBar.c) return undefined;

  

  // Make sure we're calculating forward (start to end)

  if (startBar.t > endBar.t) {

    return undefined; // Invalid if start is after end

  }

  

  // Only calculate if we have valid price data

  if (startBar.c <= 0 || endBar.c <= 0) return undefined;

  

  // Don't calculate if start and end are the same bar (would be 0%)

  if (startBar.t === endBar.t) return undefined;

  

  const returnPct = ((endBar.c - startBar.c) / startBar.c) * 100;

  

  console.log(`Period return: ${new Date(startBar.t).toISOString().split('T')[0]} ($${startBar.c.toFixed(2)}) to ${new Date(endBar.t).toISOString().split('T')[0]} ($${endBar.c.toFixed(2)}) = ${returnPct.toFixed(2)}%`);

  

  return returnPct;

}



// Main function to fetch comprehensive technical data

async function fetchTechnicalData(symbol: string): Promise<TechnicalAnalysisData | null> {

  try {

    console.log(`=== FETCHING TECHNICAL DATA FOR ${symbol} ===`);

    

    const now = new Date();

    const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());

    

    const formatDate = (date: Date) => date.toISOString().split('T')[0];

    const to = formatDate(now);

    const from = formatDate(oneYearAgo);

    

    // Fetch all data in parallel

    const [

      snapshotRes,

      overviewRes,

      dailyBars,

      rsiData,

      sma20,

      sma50,

      sma100,

      sma200,

      ema20,

      ema50,

      ema100,

      ema200,

      macdData,

      ratiosRes,

      historicalRSI,

      historicalSMA50,

      historicalSMA200,

      historicalMACD,

      benzingaRes

    ] = await Promise.all([

      fetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${symbol}?apikey=${process.env.POLYGON_API_KEY}`),

      fetch(`https://api.polygon.io/v3/reference/tickers/${symbol}?apikey=${process.env.POLYGON_API_KEY}`),

      fetchHistoricalBars(symbol, 1, 'day', from, to),

      fetchRSI(symbol),

      fetchSMA(symbol, 20),

      fetchSMA(symbol, 50),

      fetchSMA(symbol, 100),

      fetchSMA(symbol, 200),

      fetchEMA(symbol, 20),

      fetchEMA(symbol, 50),

      fetchEMA(symbol, 100),

      fetchEMA(symbol, 200),

      fetchMACD(symbol),

      fetch(`https://api.polygon.io/stocks/financials/v1/ratios?ticker=${symbol}&apikey=${process.env.POLYGON_API_KEY}`),

      fetchHistoricalRSI(symbol, from, to),

      fetchHistoricalSMA(symbol, 50, from, to),

      fetchHistoricalSMA(symbol, 200, from, to),

      fetchHistoricalMACD(symbol, from, to),

      fetch(`https://api.benzinga.com/api/v2/quoteDelayed?token=${process.env.BENZINGA_API_KEY}&symbols=${symbol}`)

    ]);

    

    // Check overview API response status BEFORE parsing
    console.log(`[POLYGON OVERVIEW] ${symbol}: Overview API response status:`, overviewRes.status, overviewRes.ok ? 'OK' : 'FAILED');
    
    // Parse overview response with error handling
    let overview = null;
    if (overviewRes.ok) {
      try {
        overview = await overviewRes.json();
      } catch (e) {
        console.log(`[POLYGON OVERVIEW] ${symbol}: Failed to parse overview JSON:`, e);
      }
    } else {
      const errorText = await overviewRes.text().catch(() => 'Unable to read error');
      console.log(`[POLYGON OVERVIEW] ${symbol}: Overview API error response:`, errorText.substring(0, 200));
    }
    
    const [snapshot, ratios, benzingaData] = await Promise.all([

      snapshotRes.json(),

      ratiosRes.ok ? ratiosRes.json() : null,

      benzingaRes.ok ? benzingaRes.json() : null

    ]);
    
    // Log overview response structure IMMEDIATELY after parsing
    console.log(`[POLYGON OVERVIEW] ${symbol}: Overview parsed - is null?`, overview === null);
    if (overview) {
      console.log(`[POLYGON OVERVIEW] ${symbol}: Overview response keys:`, Object.keys(overview));
      console.log(`[POLYGON OVERVIEW] ${symbol}: Overview.results exists?`, !!overview.results);
      if (overview.results) {
        console.log(`[POLYGON OVERVIEW] ${symbol}: Overview.results keys:`, Object.keys(overview.results));
        console.log(`[POLYGON OVERVIEW] ${symbol}: Overview.results.description exists?`, !!overview.results.description);
        if (overview.results.description) {
          console.log(`[POLYGON OVERVIEW] ${symbol}: Description found! Length:`, overview.results.description.length);
        }
      }
    } else {
      console.log(`[POLYGON OVERVIEW] ${symbol}: Overview API call failed or returned null`);
    }

    

    const tickerData = snapshot.ticker;

    const currentPrice = tickerData?.lastTrade?.p || tickerData?.day?.c || 0;
    const marketStatus = getMarketStatusTimeBased();

    // Calculate change percent based on market status
    // During premarket, use premarket change (current price vs previous close)
    // Otherwise, use regular session change
    let changePercent = 0;
    let regularSessionClosePrice: number | undefined = undefined; // Regular session close price (separate from after-hours current price)
    
    if (marketStatus === 'premarket' && benzingaData && benzingaData[symbol]) {
      // During premarket, calculate change from current premarket price vs previous close
      const benzingaQuote = benzingaData[symbol];
      const premarketPrice = typeof benzingaQuote.lastTradePrice === 'number' ? benzingaQuote.lastTradePrice : parseFloat(benzingaQuote.lastTradePrice || currentPrice);
      const benzingaPrevClose = typeof benzingaQuote.previousClosePrice === 'number' ? benzingaQuote.previousClosePrice : 
                                 (typeof benzingaQuote.previousClose === 'number' ? benzingaQuote.previousClose : parseFloat(benzingaQuote.previousClose || benzingaQuote.previousClosePrice));
      
      if (premarketPrice && benzingaPrevClose && benzingaPrevClose > 0 && !isNaN(premarketPrice) && !isNaN(benzingaPrevClose)) {
        const premarketChange = ((premarketPrice - benzingaPrevClose) / benzingaPrevClose) * 100;
        changePercent = premarketChange;
        console.log(`Using premarket change from Benzinga: ${changePercent.toFixed(2)}% (premarket price: ${premarketPrice}, previousClose: ${benzingaPrevClose})`);
      } else if (benzingaQuote.changePercent && typeof benzingaQuote.changePercent === 'number') {
        // Fallback: use changePercent from Benzinga (should be premarket change during premarket)
        changePercent = benzingaQuote.changePercent;
        console.log(`Using Benzinga changePercent for premarket: ${changePercent.toFixed(2)}%`);
      }
    } else {
      // Regular session or after-hours: calculate regular session change percent (not including after-hours)
      // Prefer Benzinga data for accurate regular session change calculation
      // Fallback to Polygon's day data if Benzinga unavailable
      
      // If Benzinga data is available, calculate regular session change from close vs previousClosePrice
      // This matches how the price action line calculates it - ensures we use regular session change, not after-hours adjusted change
      if (benzingaData && benzingaData[symbol]) {
        const benzingaQuote = benzingaData[symbol];
        // Try previousClosePrice first (matches price action line calculation), then fallback to previousClose
        const benzingaClose = typeof benzingaQuote.close === 'number' ? benzingaQuote.close : parseFloat(benzingaQuote.close);
        const benzingaPrevClose = typeof benzingaQuote.previousClosePrice === 'number' ? benzingaQuote.previousClosePrice : 
                                   (typeof benzingaQuote.previousClose === 'number' ? benzingaQuote.previousClose : parseFloat(benzingaQuote.previousClose || benzingaQuote.previousClosePrice));
        
        if (benzingaClose && benzingaPrevClose && benzingaPrevClose > 0 && !isNaN(benzingaClose) && !isNaN(benzingaPrevClose)) {
          regularSessionClosePrice = benzingaClose;
          const regularSessionChange = ((benzingaClose - benzingaPrevClose) / benzingaPrevClose) * 100;
          changePercent = regularSessionChange;
          console.log(`Using regular session change from Benzinga: ${changePercent.toFixed(2)}% (close: ${benzingaClose}, previousClosePrice: ${benzingaPrevClose})`);
        } else if (benzingaQuote.change && benzingaPrevClose && benzingaPrevClose > 0) {
          // Fallback: calculate from change amount
          const benzingaChange = typeof benzingaQuote.change === 'number' ? benzingaQuote.change : parseFloat(benzingaQuote.change);
          if (!isNaN(benzingaChange)) {
            // Calculate regular session close from previous close + change
            regularSessionClosePrice = benzingaPrevClose + benzingaChange;
            const regularSessionChange = (benzingaChange / benzingaPrevClose) * 100;
            changePercent = regularSessionChange;
            console.log(`Using regular session change from Benzinga change amount: ${changePercent.toFixed(2)}%`);
          }
        }
      }
      
      // Fallback to Polygon's day data for regular session change if Benzinga data not available
      if (changePercent === 0 && tickerData?.day?.c && tickerData?.day?.o) {
        const dayClose = tickerData.day.c;
        const dayOpen = tickerData.day.o;
        if (dayClose && dayOpen && dayOpen > 0) {
          regularSessionClosePrice = dayClose;
          changePercent = ((dayClose - dayOpen) / dayOpen) * 100;
          console.log(`Using Polygon day change (close vs open): ${changePercent.toFixed(2)}%`);
        }
      }
      
      // Last resort: use Polygon's todaysChangePerc (but this may include after-hours)
      if (changePercent === 0) {
        // Use day.c as regular session close if available
        regularSessionClosePrice = tickerData?.day?.c || undefined;
        changePercent = tickerData?.todaysChangePerc || 0;
        console.log(`Using Polygon todaysChangePerc (may include after-hours): ${changePercent.toFixed(2)}%`);
      }
    }

    const volume = tickerData?.day?.v || 0;

    

    // Polygon v3/reference/tickers returns data in results object
    // Structure: { results: { description: "...", name: "...", market_cap: ..., ... } }
    const overviewData = overview?.results || null;

    // Log overview data structure for debugging
    if (overview) {
      console.log(`[POLYGON OVERVIEW] ${symbol}: Overview response structure:`, {
        hasResults: !!overview.results,
        resultsKeys: overview.results ? Object.keys(overview.results) : 'none'
      });
    } else {
      console.log(`[POLYGON OVERVIEW] ${symbol}: Overview is null - API call may have failed`);
    }

    if (overviewData) {
      console.log(`[POLYGON OVERVIEW] ${symbol}: Overview data keys:`, Object.keys(overviewData));
      console.log(`[POLYGON OVERVIEW] ${symbol}: Has description field?`, overviewData.description ? 'YES' : 'NO');
      if (overviewData.description) {
        console.log(`[POLYGON OVERVIEW] ${symbol}: Description length:`, overviewData.description.length);
        console.log(`[POLYGON OVERVIEW] ${symbol}: Description preview:`, overviewData.description.substring(0, 100));
      } else {
        console.log(`[POLYGON OVERVIEW] ${symbol}: Description field missing. Available fields:`, Object.keys(overviewData).join(', '));
      }
    }

    const companyName = overviewData?.name || symbol;
    const exchangeCode = overviewData?.primary_exchange || overviewData?.market || null;
    const companyNameWithExchange = formatCompanyNameWithExchange(companyName, symbol, exchangeCode);

    const marketCap = overviewData?.market_cap || 0;
    // Access description directly from overview.results.description (v3/reference/tickers structure)
    const description = overview?.results?.description || null;
    
    console.log(`[POLYGON OVERVIEW] ${symbol}: Extracted description:`, description ? `YES (${description.length} chars)` : 'NO');

    

    // Get 52-week range from Benzinga API (directly available, no calculation needed)

    let fiftyTwoWeekHigh = 0;

    let fiftyTwoWeekLow = 0;

    if (benzingaData && benzingaData[symbol]) {

      const benzingaQuote = benzingaData[symbol];

      fiftyTwoWeekHigh = benzingaQuote.fiftyTwoWeekHigh || 0;

      fiftyTwoWeekLow = benzingaQuote.fiftyTwoWeekLow || 0;

      console.log(`52-week range from Benzinga: High $${fiftyTwoWeekHigh}, Low $${fiftyTwoWeekLow}`);

    } else {

      // Fallback: calculate from daily bars if Benzinga data not available

      if (dailyBars && dailyBars.length > 0) {

        dailyBars.forEach((bar: { h: number; l: number }) => {

          fiftyTwoWeekHigh = Math.max(fiftyTwoWeekHigh, bar.h);

          fiftyTwoWeekLow = Math.min(fiftyTwoWeekLow === 0 ? Infinity : fiftyTwoWeekLow, bar.l);

        });

        fiftyTwoWeekLow = fiftyTwoWeekLow === Infinity ? 0 : fiftyTwoWeekLow;

        console.log(`52-week range calculated from bars: High $${fiftyTwoWeekHigh}, Low $${fiftyTwoWeekLow}`);

      }

    }

    

    // Calculate 12-month return from daily bars for accuracy

    // Use the most recent trading day as the end point (not "now" which might be a weekend)

    const mostRecentTradingDay = dailyBars && dailyBars.length > 0 

      ? new Date(Math.max(...dailyBars.map((bar: { t: number }) => bar.t)))

      : now;

    

    const twelveMonthReturn = dailyBars ? calculatePeriodReturn(dailyBars, oneYearAgo, mostRecentTradingDay) : undefined;

    

    // Calculate support/resistance

    const { support, resistance } = calculateSupportResistance(dailyBars || [], currentPrice);

    

    // Analyze turning points

    const turningPoints = analyzeTurningPoints(

      (dailyBars || []).map((bar: { h: number; l: number; c: number; t?: number }) => ({ 

        h: bar.h, 

        l: bar.l, 

        c: bar.c, 

        t: bar.t || 0 

      })),

      historicalRSI || [],

      historicalSMA50 || [],

      historicalSMA200 || [],

      historicalMACD || [],

      currentPrice,

      support,

      resistance,

      fiftyTwoWeekHigh || 0,

      fiftyTwoWeekLow === Infinity ? 0 : fiftyTwoWeekLow

    );

    

    // Get average volume from ratios

    const averageVolume = ratios?.results?.[0]?.average_volume || undefined;

    

    const technicalData: TechnicalAnalysisData = {

      symbol,

      companyName,

      currentPrice,
      regularSessionClosePrice,

      changePercent,

      twelveMonthReturn,

      sma20,

      sma50,

      sma100,

      sma200,

      ema20,

      ema50,

      ema100,

      ema200,

      rsi: rsiData.rsi,

      rsiSignal: rsiData.signal,

      macd: macdData.macd,

      macdSignal: macdData.signal,

      macdHistogram: macdData.histogram,

      supportLevel: support,

      resistanceLevel: resistance,

      fiftyTwoWeekHigh: fiftyTwoWeekHigh || 0,

      fiftyTwoWeekLow: fiftyTwoWeekLow === Infinity ? 0 : fiftyTwoWeekLow,

      volume,

      averageVolume,

      marketCap,

      description: description && description !== 'N/A' ? description : null,

      turningPoints

    };

    

    return technicalData;

  } catch (error) {

    console.error(`Error fetching technical data for ${symbol}:`, error);

    return null;

  }

}

// Interface for market context data
interface MarketContext {
  indices: Array<{ name: string; ticker: string; change: number }>;
  sectors: Array<{ name: string; ticker: string; change: number }>;
  marketBreadth: { advancers: number; decliners: number; ratio: string };
  topGainers: Array<{ name: string; ticker: string; change: number }>;
  topLosers: Array<{ name: string; ticker: string; change: number }>;
}

// Helper function to map sector name to sector ETF ticker
function getSectorETFTicker(sectorName: string): string | null {
  const sectorMap: { [key: string]: string } = {
    'Technology': 'XLK',
    'Financials': 'XLF',
    'Energy': 'XLE',
    'Healthcare': 'XLV',
    'Industrials': 'XLI',
    'Consumer Staples': 'XLP',
    'Consumer Discretionary': 'XLY',
    'Utilities': 'XLU',
    'Real Estate': 'XLRE',
    'Communication Services': 'XLC',
    'Materials': 'XLB'
  };
  
  // Try exact match first
  if (sectorMap[sectorName]) {
    return sectorMap[sectorName];
  }
  
  // Try case-insensitive match
  const sectorLower = sectorName.toLowerCase();
  for (const [key, value] of Object.entries(sectorMap)) {
    if (key.toLowerCase() === sectorLower) {
      return value;
    }
  }
  
  return null;
}

// Helper function to map sector name to readable sector name (same as market-report)
function getSectorName(ticker: string): string {
  return ticker === 'XLK' ? 'Technology' :
         ticker === 'XLF' ? 'Financials' :
         ticker === 'XLE' ? 'Energy' :
         ticker === 'XLV' ? 'Healthcare' :
         ticker === 'XLI' ? 'Industrials' :
         ticker === 'XLP' ? 'Consumer Staples' :
         ticker === 'XLY' ? 'Consumer Discretionary' :
         ticker === 'XLU' ? 'Utilities' :
         ticker === 'XLRE' ? 'Real Estate' :
         ticker === 'XLC' ? 'Communication Services' :
         ticker === 'XLB' ? 'Materials' : ticker;
}

// Helper function to get stock sector and performance
async function getStockSectorPerformance(ticker: string, marketContext: MarketContext | null): Promise<{ sectorName: string; sectorChange: number } | null> {
  if (!marketContext) return null;
  
  try {
    // Fetch stock overview to get sector info
    const overviewRes = await fetch(`https://api.polygon.io/v3/reference/tickers/${ticker}?apikey=${process.env.POLYGON_API_KEY}`);
    if (!overviewRes.ok) return null;
    
    const overview = await overviewRes.json();
    const result = overview.results;
    
    if (!result) return null;
    
    // Try multiple fields - sector is most reliable, then sic_description, then industry
    let sectorField = result.sector || result.sic_description || result.industry || null;
    
    if (!sectorField) return null;
    
    // Map sector name/description to ETF ticker
    // Handle common variations and partial matches
    const sectorLower = sectorField.toLowerCase();
    
    // Direct mapping attempts
    let sectorETF: string | null = null;
    
    if (sectorLower.includes('technology') || sectorLower.includes('software') || sectorLower.includes('tech')) {
      sectorETF = 'XLK';
    } else if (sectorLower.includes('financial') || sectorLower.includes('bank') || sectorLower.includes('insurance')) {
      sectorETF = 'XLF';
    } else if (sectorLower.includes('energy') || sectorLower.includes('oil') || sectorLower.includes('gas')) {
      sectorETF = 'XLE';
    } else if (sectorLower.includes('health') || sectorLower.includes('pharma') || sectorLower.includes('biotech')) {
      sectorETF = 'XLV';
    } else if (sectorLower.includes('industrial') || sectorLower.includes('manufacturing')) {
      sectorETF = 'XLI';
    } else if (sectorLower.includes('consumer staple') || sectorLower.includes('staples')) {
      sectorETF = 'XLP';
    } else if (sectorLower.includes('consumer discretion') || sectorLower.includes('retail') || sectorLower.includes('automotive')) {
      sectorETF = 'XLY';
    } else if (sectorLower.includes('utilit')) {
      sectorETF = 'XLU';
    } else if (sectorLower.includes('real estate') || sectorLower.includes('reit')) {
      sectorETF = 'XLRE';
    } else if (sectorLower.includes('communication') || sectorLower.includes('telecom') || sectorLower.includes('media')) {
      sectorETF = 'XLC';
    } else if (sectorLower.includes('material') || sectorLower.includes('chemical') || sectorLower.includes('mining')) {
      sectorETF = 'XLB';
    } else {
      // Fallback to direct mapping function
      sectorETF = getSectorETFTicker(sectorField);
    }
    
    if (!sectorETF) return null;
    
    // Find sector in market context
    const sector = marketContext.sectors.find(s => s.ticker === sectorETF);
    if (!sector) return null;
    
    return {
      sectorName: getSectorName(sectorETF),
      sectorChange: sector.change
    };
  } catch (error) {
    console.error('Error getting stock sector performance:', error);
    return null;
  }
}

// Fetch market context for broader market analysis
async function fetchMarketContext(usePreviousDay: boolean = false): Promise<MarketContext | null> {
  try {
    console.log('[MARKET CONTEXT] Fetching market context data...');
    const INDICES = ['SPY', 'QQQ', 'DIA', 'IWM'];
    const SECTORS = ['XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLP', 'XLY', 'XLU', 'XLRE', 'XLC', 'XLB'];
    
    // If we need previous day's data (e.g., during premarket), we'll use the previous trading day's snapshot
    // For now, Polygon snapshot API returns current/latest data, which during premarket would be previous day's close
    // The todaysChangePerc during premarket should reflect previous day's change
    const [indicesRes, sectorsRes, gainersRes, losersRes] = await Promise.all([
      fetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${INDICES.join(',')}&apikey=${process.env.POLYGON_API_KEY}`),
      fetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${SECTORS.join(',')}&apikey=${process.env.POLYGON_API_KEY}`),
      fetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/gainers?apikey=${process.env.POLYGON_API_KEY}`),
      fetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/losers?apikey=${process.env.POLYGON_API_KEY}`)
    ]);

    const [indicesData, sectorsData, gainersData, losersData] = await Promise.all([
      indicesRes.json(),
      sectorsRes.json(),
      gainersRes.json(),
      losersRes.json()
    ]);

    // Log detailed raw API response to debug date issues
    console.log('[MARKET CONTEXT] Raw indices data:');
    (indicesData.tickers || []).forEach((idx: any) => {
      console.log(`[MARKET CONTEXT] ${idx.ticker} (${idx.ticker === 'SPY' ? 'S&P 500' : idx.ticker === 'QQQ' ? 'Nasdaq' : idx.ticker === 'DIA' ? 'Dow Jones' : idx.ticker === 'IWM' ? 'Russell 2000' : idx.ticker}):`, {
        ticker: idx.ticker,
        market: idx.market,
        locale: idx.locale,
        primaryExch: idx.primaryExch,
        type: idx.type,
        todaysChangePerc: idx.todaysChangePerc,
        day: idx.day ? {
          o: idx.day.o,
          h: idx.day.h,
          l: idx.day.l,
          c: idx.day.c,
          v: idx.day.v,
          vw: idx.day.vw
        } : null,
        prevDay: idx.prevDay ? {
          o: idx.prevDay.o,
          h: idx.prevDay.h,
          l: idx.prevDay.l,
          c: idx.prevDay.c,
          v: idx.prevDay.v,
          vw: idx.prevDay.vw
        } : null,
        lastTrade: idx.lastTrade ? {
          p: idx.lastTrade.p,
          s: idx.lastTrade.s,
          t: idx.lastTrade.t
        } : null
      });
    });

    const indices = (indicesData.tickers || []).map((idx: any) => ({
      name: idx.ticker === 'SPY' ? 'S&P 500' : 
            idx.ticker === 'QQQ' ? 'Nasdaq' : 
            idx.ticker === 'DIA' ? 'Dow Jones' : 
            idx.ticker === 'IWM' ? 'Russell 2000' : idx.ticker,
      ticker: idx.ticker,
      change: idx.todaysChangePerc || 0
    }));

    // Log detailed raw sectors data
    console.log('[MARKET CONTEXT] Raw sectors data:');
    (sectorsData.tickers || []).forEach((sector: any) => {
      const sectorName = sector.ticker === 'XLK' ? 'Technology' :
            sector.ticker === 'XLF' ? 'Financials' :
            sector.ticker === 'XLE' ? 'Energy' :
            sector.ticker === 'XLV' ? 'Healthcare' :
            sector.ticker === 'XLI' ? 'Industrials' :
            sector.ticker === 'XLP' ? 'Consumer Staples' :
            sector.ticker === 'XLY' ? 'Consumer Discretionary' :
            sector.ticker === 'XLU' ? 'Utilities' :
            sector.ticker === 'XLRE' ? 'Real Estate' :
            sector.ticker === 'XLC' ? 'Communication Services' :
            sector.ticker === 'XLB' ? 'Materials' : sector.ticker;
      console.log(`[MARKET CONTEXT] ${sector.ticker} (${sectorName}):`, {
        ticker: sector.ticker,
        market: sector.market,
        locale: sector.locale,
        primaryExch: sector.primaryExch,
        type: sector.type,
        todaysChangePerc: sector.todaysChangePerc,
        day: sector.day ? {
          o: sector.day.o,
          h: sector.day.h,
          l: sector.day.l,
          c: sector.day.c,
          v: sector.day.v
        } : null,
        prevDay: sector.prevDay ? {
          o: sector.prevDay.o,
          h: sector.prevDay.h,
          l: sector.prevDay.l,
          c: sector.prevDay.c
        } : null
      });
    });

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

    // Filter gainers/losers to meaningful stocks
    const gainers = (gainersData.tickers || [])
      .filter((t: any) => t.lastTrade?.p && t.lastTrade.p > 5 && t.day?.v && t.day.v > 1000000 && !t.ticker.endsWith('W'))
      .slice(0, 5)
      .map((stock: any) => ({
        name: stock.ticker, // Will be replaced with company name if available
        ticker: stock.ticker,
        change: stock.todaysChangePerc || 0
      }));

    const losers = (losersData.tickers || [])
      .filter((t: any) => t.lastTrade?.p && t.lastTrade.p > 5 && t.day?.v && t.day.v > 1000000 && !t.ticker.endsWith('W'))
      .slice(0, 5)
      .map((stock: any) => ({
        name: stock.ticker, // Will be replaced with company name if available
        ticker: stock.ticker,
        change: stock.todaysChangePerc || 0
      }));

    // Calculate market breadth
    const advancers = sectors.filter((s: { name: string; ticker: string; change: number }) => s.change > 0).length;
    const decliners = sectors.filter((s: { name: string; ticker: string; change: number }) => s.change < 0).length;
    const ratio = decliners > 0 ? (advancers / decliners).toFixed(1) : 'N/A';

    console.log('[MARKET CONTEXT] Market data fetched successfully:');
    console.log(`[MARKET CONTEXT] Indices: ${indices.map((i: { name: string; ticker: string; change: number }) => `${i.name} ${i.change > 0 ? '+' : ''}${i.change.toFixed(2)}%`).join(', ')}`);
    console.log(`[MARKET CONTEXT] Top sectors: ${sectors.slice(0, 3).map((s: { name: string; ticker: string; change: number }) => `${s.name} ${s.change > 0 ? '+' : ''}${s.change.toFixed(2)}%`).join(', ')}`);
    console.log(`[MARKET CONTEXT] Market breadth: ${advancers} advancing, ${decliners} declining (ratio: ${ratio})`);

    return {
      indices,
      sectors: sectors.sort((a: { name: string; ticker: string; change: number }, b: { name: string; ticker: string; change: number }) => b.change - a.change), // Sort by performance
      marketBreadth: { advancers, decliners, ratio },
      topGainers: gainers,
      topLosers: losers
    };
  } catch (error) {
    console.error('[MARKET CONTEXT] Error fetching market context:', error);
    return null;
  }
}

// Fetch recent analyst actions (upgrades, downgrades, initiations) from Benzinga
async function fetchRecentAnalystActions(ticker: string, limit: number = 3) {
  try {
    const BENZINGA_API_KEY = process.env.BENZINGA_API_KEY;
    if (!BENZINGA_API_KEY) {
      return [];
    }

    const analystUrl = `https://api.benzinga.com/api/v2.1/calendar/ratings?token=${BENZINGA_API_KEY}&parameters[tickers]=${encodeURIComponent(ticker)}&parameters[range]=6m`;
    
    console.log(`[RECENT ANALYST ACTIONS] Fetching for ticker: ${ticker}`);
    const analystRes = await fetch(analystUrl, {
      headers: { Accept: 'application/json' },
    });
    
    if (analystRes.ok) {
      const analystData = await analystRes.json();
      const ratingsArray = Array.isArray(analystData) ? analystData : (analystData.ratings || []);
      
      console.log(`[RECENT ANALYST ACTIONS] ${ticker}: Raw API returned ${ratingsArray.length} ratings`);
      
      // Sort by date (most recent first) and format recent actions
      const recentActions = ratingsArray
        .sort((a: any, b: any) => {
          const dateA = new Date(a.date || a.created || 0).getTime();
          const dateB = new Date(b.date || b.created || 0).getTime();
          return dateB - dateA; // Most recent first
        })
        .slice(0, limit)
        .map((rating: any) => {
          // Use API field names: analyst, action_company, rating_current, rating_prior, pt_current, pt_prior
          const firm = rating.analyst || rating.firm || rating.analyst_firm || rating.firm_name || 'Unknown Firm';
          const actionCompany = rating.action_company || rating.action || rating.rating_action || '';
          const currentRating = rating.rating_current || rating.rating || rating.new_rating || '';
          const priorRating = rating.rating_prior || rating.rating_prior || '';
          // Use adjusted_pt_current/adjusted_pt_prior if available (already formatted), otherwise fall back to other fields
          const priceTarget = rating.adjusted_pt_current || rating.pt_current || rating.pt || rating.price_target || rating.target || null;
          const priorTarget = rating.adjusted_pt_prior || rating.pt_prior || rating.price_target_prior || null;
          // Use action_pt from API (e.g., "Lowers", "Raises") instead of calculating
          const actionPt = rating.action_pt || null;
          
          console.log(`[RECENT ANALYST ACTIONS] ${ticker}: Processing rating:`, {
            firm,
            actionCompany,
            currentRating,
            priorRating,
            priceTarget,
            priorTarget,
            actionPt,
            date: rating.date || rating.created,
            rawRating: JSON.stringify(rating).substring(0, 200) // First 200 chars of raw data
          });
          
          // Format the action description based ONLY on action_company from API - no fallbacks or inference
          let actionText = '';
          const actionLower = actionCompany.toLowerCase();
          
          // Use ONLY the actionCompany field from the API - no inference or fallbacks
          if (actionLower.includes('downgrade')) {
            actionText = `Downgraded to ${currentRating}`;
          } else if (actionLower.includes('upgrade')) {
            actionText = `Upgraded to ${currentRating}`;
          } else if (actionLower.includes('initiate') || actionLower.includes('reinstated')) {
            actionText = `Initiated with ${currentRating}`;
          } else if (currentRating) {
            // If actionCompany is missing or unclear, just show the rating
            actionText = `${currentRating}`;
          }
          
          // Add price target info if available - use API data directly, NO calculations or fallbacks
          if (priceTarget && priorTarget && actionPt) {
            // Use action_pt from API (e.g., "Lowers", "Raises") - capitalize first letter
            const direction = actionPt.charAt(0).toUpperCase() + actionPt.slice(1).toLowerCase();
            // Use price target as-is from API (already formatted)
            actionText += ` (${direction} Target to $${priceTarget})`;
          } else if (priceTarget) {
            // Use price target as-is from API (already formatted)
            actionText += ` (Target $${priceTarget})`;
          }
          
          const formattedAction = {
            firm,
            action: actionText,
            date: rating.date || rating.created || null
          };
          
          console.log(`[RECENT ANALYST ACTIONS] ${ticker}: Formatted action: ${formattedAction.firm}: ${formattedAction.action} (${formattedAction.date})`);
          
          return formattedAction;
        });
      
      // Filter: If there's only one unique firm, only keep the most recent action from that firm
      const uniqueFirms = new Set(recentActions.map((a: any) => a.firm));
      if (uniqueFirms.size === 1) {
        // Only one firm - keep only the most recent action (already sorted, so first one)
        const filteredActions = recentActions.slice(0, 1);
        console.log(`[RECENT ANALYST ACTIONS] Only one firm (${Array.from(uniqueFirms)[0]}), showing only most recent action`);
        return filteredActions;
      }
      
      console.log(`[RECENT ANALYST ACTIONS] Found ${recentActions.length} recent actions from ${uniqueFirms.size} firms`);
      return recentActions;
    }
    
    return [];
  } catch (error) {
    console.error('Error fetching recent analyst actions:', error);
    return [];
  }
}

// Validate analyst data to filter out stale information
function validateAnalystData(
  consensusRatings: any,
  recentAnalystActions: any[],
  currentPrice: number
): { isValid: boolean; shouldShowPriceTarget: boolean; reason?: string } {
  // If no consensus ratings, nothing to validate
  if (!consensusRatings) {
    return { isValid: false, shouldShowPriceTarget: false };
  }

  const priceTarget = consensusRatings.consensus_price_target;
  const hasPriceTarget = priceTarget !== null && priceTarget !== undefined && !isNaN(parseFloat(priceTarget.toString()));

  // Check if we have recent analyst actions
  let mostRecentActionDate: Date | null = null;
  if (recentAnalystActions && recentAnalystActions.length > 0) {
    // Find the most recent action date
    const dates = recentAnalystActions
      .map((action: any) => {
        if (!action.date) return null;
        try {
          // Parse date string (format: YYYY-MM-DD)
          const dateParts = action.date.split('-');
          if (dateParts.length === 3) {
            return new Date(parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2]));
          }
          return new Date(action.date);
        } catch (e) {
          return null;
        }
      })
      .filter((d: Date | null) => d !== null) as Date[];
    
    if (dates.length > 0) {
      mostRecentActionDate = new Date(Math.max(...dates.map(d => d.getTime())));
    }
  }

  // Check date freshness: use 6 months as primary cutoff, 12 months for limited coverage
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
  
  // Check if coverage is limited (≤2 analysts)
  const hasLimitedCoverage = (consensusRatings.total_analyst_count || 0) <= 2;
  
  // Determine cutoff: 6 months for normal coverage, 12 months for limited coverage
  const cutoffDate = hasLimitedCoverage ? twelveMonthsAgo : sixMonthsAgo;
  const cutoffMonths = hasLimitedCoverage ? 12 : 6;
  
  const isDataStale = mostRecentActionDate === null || mostRecentActionDate < cutoffDate;

  // Check price target reasonableness
  let isPriceTargetReasonable = true;
  if (hasPriceTarget && currentPrice > 0) {
    const targetNum = parseFloat(priceTarget.toString());
    const ratio = targetNum / currentPrice;
    
    // Price target should be between 0.2x and 10x current price
    // (10x allows for some growth stocks, but anything beyond is likely stale)
    if (ratio < 0.2 || ratio > 10) {
      isPriceTargetReasonable = false;
    }
  }

  // If data is stale (no recent actions within cutoff period), omit entire section
  if (isDataStale) {
    return {
      isValid: false, // Don't show any analyst data if all actions are older than cutoff
      shouldShowPriceTarget: false,
      reason: mostRecentActionDate 
        ? `Most recent analyst action is from ${mostRecentActionDate.toLocaleDateString()} (older than ${cutoffMonths} months)`
        : 'No recent analyst actions found'
    };
  }

  // If price target is unreasonable, don't show it but still show rating
  if (hasPriceTarget && !isPriceTargetReasonable) {
    return {
      isValid: true, // Still show rating if available
      shouldShowPriceTarget: false,
      reason: `Price target ($${priceTarget}) is ${priceTarget && currentPrice > 0 ? (parseFloat(priceTarget.toString()) / currentPrice).toFixed(1) : 'N/A'}x current price, which is outside reasonable range`
    };
  }

  // Data is valid
  return {
    isValid: true,
    shouldShowPriceTarget: hasPriceTarget && isPriceTargetReasonable
  };
}

// Fetch consensus ratings from Benzinga
async function fetchConsensusRatings(ticker: string) {
  try {
    const BENZINGA_API_KEY = process.env.BENZINGA_API_KEY;
    if (!BENZINGA_API_KEY) {
      console.error('Error: BENZINGA_API_KEY is missing from environment variables.');
      return null;
    }

    const params = new URLSearchParams();
    params.append('token', BENZINGA_API_KEY);
    params.append('parameters[tickers]', ticker);
    
    // Use v1 consensus-ratings endpoint - if 404, fallback to analyst/insights aggregation
    const consensusUrl = `https://api.benzinga.com/api/v1/consensus-ratings?${params.toString()}`;
    
    console.log(`[CONSENSUS RATINGS] Fetching for ticker: ${ticker}`);
    console.log(`[CONSENSUS RATINGS] URL: ${consensusUrl}`);
    
    const consensusRes = await fetch(consensusUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
    });
    
    console.log(`[CONSENSUS RATINGS] Response status: ${consensusRes.status} ${consensusRes.statusText}`);
      
    if (consensusRes.ok) {
      const consensusData = await consensusRes.json();
      console.log(`[CONSENSUS RATINGS] Raw response data:`, JSON.stringify(consensusData).substring(0, 500));
      
      // Handle different response structures
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
        
        const consensus = {
          consensus_rating: extractedConsensus.consensus_rating || extractedConsensus.consensusRating || extractedConsensus.rating || null,
          consensus_price_target: consensusPriceTarget,
          high_price_target: extractedConsensus.high_price_target || extractedConsensus.highPriceTarget || extractedConsensus.high || extractedConsensus.high_target || null,
          low_price_target: extractedConsensus.low_price_target || extractedConsensus.lowPriceTarget || extractedConsensus.low || extractedConsensus.low_target || null,
          total_analyst_count: extractedConsensus.total_analyst_count || extractedConsensus.totalAnalystCount || extractedConsensus.analyst_count || extractedConsensus.count || null,
          // Rating distributions
          buy_percentage: extractedConsensus.buy_percentage || extractedConsensus.buyPercentage || extractedConsensus.buy || null,
          hold_percentage: extractedConsensus.hold_percentage || extractedConsensus.holdPercentage || extractedConsensus.hold || null,
          sell_percentage: extractedConsensus.sell_percentage || extractedConsensus.sellPercentage || extractedConsensus.sell || null,
        };
        
        if (consensus.consensus_price_target || consensus.consensus_rating) {
          console.log(`[CONSENSUS RATINGS] Successfully extracted:`, {
            rating: consensus.consensus_rating,
            priceTarget: consensus.consensus_price_target,
            totalAnalysts: consensus.total_analyst_count,
            buyPercentage: consensus.buy_percentage
          });
          return consensus;
        } else {
          console.log(`[CONSENSUS RATINGS] No valid rating or price target found in extracted data`);
        }
      } else {
        console.log(`[CONSENSUS RATINGS] Could not extract consensus data from response`);
      }
    } else if (consensusRes.status === 404) {
      // If 404, try analyst/insights endpoint and aggregate consensus data
      console.log(`[CONSENSUS RATINGS] 404 on consensus-ratings endpoint, trying analyst/insights endpoint`);
      const insightsUrl = `https://api.benzinga.com/api/v2/analyst/insights?token=${BENZINGA_API_KEY}&symbols=${encodeURIComponent(ticker)}&pageSize=100`;
      const insightsRes = await fetch(insightsUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });
      
      if (insightsRes.ok) {
        const insightsData = await insightsRes.json();
        console.log(`[CONSENSUS RATINGS] Fetched ${Array.isArray(insightsData) ? insightsData.length : 0} analyst insights`);
        
        if (Array.isArray(insightsData) && insightsData.length > 0) {
          // Aggregate consensus from individual insights
          const validInsights = insightsData.filter((insight: any) => insight.rating || insight.pt);
          if (validInsights.length > 0) {
            // Calculate consensus rating (most common rating)
            const ratingCounts: { [key: string]: number } = {};
            const priceTargets: number[] = [];
            
            validInsights.forEach((insight: any) => {
              if (insight.rating) {
                const rating = insight.rating.toUpperCase();
                ratingCounts[rating] = (ratingCounts[rating] || 0) + 1;
              }
              if (insight.pt) {
                const pt = parseFloat(insight.pt);
                if (!isNaN(pt) && pt > 0) {
                  priceTargets.push(pt);
                }
              }
            });
            
            // Find most common rating
            let consensusRating = null;
            let maxCount = 0;
            Object.keys(ratingCounts).forEach(rating => {
              if (ratingCounts[rating] > maxCount) {
                maxCount = ratingCounts[rating];
                consensusRating = rating;
              }
            });
            
            // Calculate average price target
            const consensusPriceTarget = priceTargets.length > 0 
              ? priceTargets.reduce((sum, pt) => sum + pt, 0) / priceTargets.length 
              : null;
            
            // Calculate rating percentages
            const totalRatings = validInsights.length;
            const buyCount = Object.keys(ratingCounts).filter(r => ['BUY', 'STRONG BUY', 'OVERWEIGHT', 'POSITIVE'].includes(r)).reduce((sum, r) => sum + ratingCounts[r], 0);
            const holdCount = Object.keys(ratingCounts).filter(r => ['HOLD', 'NEUTRAL', 'EQUAL WEIGHT'].includes(r)).reduce((sum, r) => sum + ratingCounts[r], 0);
            const sellCount = Object.keys(ratingCounts).filter(r => ['SELL', 'STRONG SELL', 'UNDERWEIGHT', 'NEGATIVE'].includes(r)).reduce((sum, r) => sum + ratingCounts[r], 0);
            
            if (consensusRating || consensusPriceTarget) {
              const consensus = {
                consensus_rating: consensusRating,
                consensus_price_target: consensusPriceTarget,
                total_analyst_count: totalRatings,
                buy_percentage: totalRatings > 0 ? (buyCount / totalRatings) * 100 : null,
                hold_percentage: totalRatings > 0 ? (holdCount / totalRatings) * 100 : null,
                sell_percentage: totalRatings > 0 ? (sellCount / totalRatings) * 100 : null,
                high_price_target: priceTargets.length > 0 ? Math.max(...priceTargets) : null,
                low_price_target: priceTargets.length > 0 ? Math.min(...priceTargets) : null,
              };
              
              console.log(`[CONSENSUS RATINGS] Successfully aggregated from insights:`, {
                rating: consensus.consensus_rating,
                priceTarget: consensus.consensus_price_target,
                totalAnalysts: consensus.total_analyst_count
              });
              return consensus;
            }
          }
        }
      }
      console.log(`[CONSENSUS RATINGS] Could not aggregate consensus from insights, returning null`);
    } else {
      const errorText = await consensusRes.text().catch(() => '');
      console.log(`[CONSENSUS RATINGS] API error response: ${errorText.substring(0, 300)}`);
    }
    
    console.log(`[CONSENSUS RATINGS] Returning null - no data found`);
    return null;
  } catch (error) {
    console.error('Error fetching consensus ratings:', error);
    return null;
  }
}

// Helper function to format date string without timezone issues
function formatEarningsDate(dateString: string | null | undefined): string {
  if (!dateString) return 'a date to be announced';
  try {
    // Parse date string (format: YYYY-MM-DD) as local date to avoid timezone issues
    const parts = dateString.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed
      const day = parseInt(parts[2], 10);
      const date = new Date(year, month, day);
      return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    }
    // Fallback to standard parsing if format is unexpected
    return new Date(dateString).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  } catch (error) {
    console.error('Error formatting earnings date:', error);
    return dateString;
  }
}

// Helper function to format date in AP style (e.g., "Jan. 11" or "Jan. 11, 2023")
// Parses date strings directly from API (YYYY-MM-DD format) - NO timezone conversions
function formatDateAPStyle(date: Date | string | null, includeYear: boolean = false): string {
  if (!date) return '';
  try {
    let year: number, month: number, day: number;
    
    // If it's already a Date object, extract components (but this shouldn't happen for API dates)
    if (date instanceof Date) {
      year = date.getFullYear();
      month = date.getMonth();
      day = date.getDate();
    } else {
      // Parse date string directly from API format (YYYY-MM-DD) - NO timezone conversion
      const dateStr = String(date);
      const dateMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!dateMatch) return '';
      
      year = parseInt(dateMatch[1], 10);
      month = parseInt(dateMatch[2], 10) - 1; // Month is 0-indexed in JS
      day = parseInt(dateMatch[3], 10);
      
      // Validate parsed values
      if (isNaN(year) || isNaN(month) || isNaN(day) || month < 0 || month > 11 || day < 1 || day > 31) {
        return '';
      }
    }
    
    const monthNames = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'];
    const monthName = monthNames[month];
    
    if (includeYear) {
      return `${monthName} ${day}, ${year}`;
    } else {
      return `${monthName} ${day}`;
    }
  } catch (e) {
    return '';
  }
}

// Helper function to format revenue (converts to billions if >= 1000 million, otherwise millions)
function formatRevenue(revenue: number | string | null | undefined): string {
  if (revenue === null || revenue === undefined) return '';
  try {
    const numRevenue = typeof revenue === 'string' ? parseFloat(revenue) : revenue;
    if (isNaN(numRevenue) || !isFinite(numRevenue)) return '';
    
    const millions = numRevenue / 1000000;
    
    // If >= 1000 million, format as billions
    if (millions >= 1000) {
      const billions = millions / 1000;
      return `$${billions.toFixed(2)} billion`;
    } else {
      // Otherwise format as millions
      return `$${millions.toFixed(2)} million`;
    }
  } catch (error) {
    console.error('Error formatting revenue:', error);
    return '';
  }
}

// Fetch Edge ratings from Benzinga Edge API
async function fetchEdgeRatings(ticker: string) {
  try {
    if (!BENZINGA_EDGE_API_KEY) {
      console.log('[WGO W/ News] BENZINGA_EDGE_API_KEY not configured, skipping Edge ratings');
      return null;
    }

    // Try different possible Edge API endpoints
    const possibleUrls = [
      `https://data-api-next.benzinga.com/rest/v3/tickerDetail?apikey=${BENZINGA_EDGE_API_KEY}&symbols=${encodeURIComponent(ticker)}`,
      `https://api.benzinga.com/api/v2/edge?token=${BENZINGA_EDGE_API_KEY}&symbols=${encodeURIComponent(ticker)}`,
      `https://api.benzinga.com/api/v2/edge/stock/${encodeURIComponent(ticker)}?token=${BENZINGA_EDGE_API_KEY}`,
      `https://api.benzinga.com/api/v2/edge/${encodeURIComponent(ticker)}?token=${BENZINGA_EDGE_API_KEY}`,
      `https://api.benzinga.com/api/v2/edge/ratings?token=${BENZINGA_EDGE_API_KEY}&symbols=${encodeURIComponent(ticker)}`
    ];
    
    let data = null;
    
    for (const url of possibleUrls) {
      console.log('[WGO W/ News] Trying Edge API URL:', url);
      const response = await fetch(url, {
        headers: { 
          'Accept': 'application/json'
        },
      });
      
      if (response.ok) {
        data = await response.json();
        console.log('[WGO W/ News] Edge API success with URL:', url);
        break;
      } else {
        console.log('[WGO W/ News] Edge API failed with URL:', url, response.status);
      }
    }
    
    if (!data) {
      console.log('[WGO W/ News] All Edge API endpoints failed');
      return null;
    }
    
    console.log('[WGO W/ News] Edge API response:', data);
    
    // Extract the relevant ratings data - try different possible data structures
    let edgeData = null;
    
    // Handle the tickerDetail API response structure
    if (data.result && Array.isArray(data.result) && data.result.length > 0) {
      const tickerData = data.result[0];
      
      // Check if rankings exist and extract directly from rankings object
      if (tickerData.rankings && typeof tickerData.rankings === 'object') {
        // Log the raw rankings for debugging
        console.log('[WGO W/ News] Raw rankings object:', JSON.stringify(tickerData.rankings, null, 2));
        
        // Extract rankings - check for both rank and score properties
        // The API may return rankings as direct properties or nested in score fields
        const getRankingValue = (obj: any, prefix: string): number | null => {
          // Try various possible property names
          if (obj[prefix] !== undefined && obj[prefix] !== null && typeof obj[prefix] === 'number') return obj[prefix];
          if (obj[`${prefix}_score`] !== undefined && obj[`${prefix}_score`] !== null && typeof obj[`${prefix}_score`] === 'number') return obj[`${prefix}_score`];
          if (obj[`${prefix}Score`] !== undefined && obj[`${prefix}Score`] !== null && typeof obj[`${prefix}Score`] === 'number') return obj[`${prefix}Score`];
          if (obj[`${prefix}Rank`] !== undefined && obj[`${prefix}Rank`] !== null && typeof obj[`${prefix}Rank`] === 'number') return obj[`${prefix}Rank`];
          return null;
        };
        
        edgeData = {
          ticker: ticker.toUpperCase(),
          value_rank: getRankingValue(tickerData.rankings, 'value'),
          growth_rank: getRankingValue(tickerData.rankings, 'growth'),
          quality_rank: getRankingValue(tickerData.rankings, 'quality'),
          momentum_rank: getRankingValue(tickerData.rankings, 'momentum'),
        };
        
        // Also check percentiles array if rankings object didn't have the data
        if ((!edgeData.value_rank && !edgeData.growth_rank && !edgeData.quality_rank && !edgeData.momentum_rank) && 
            tickerData.percentiles && Array.isArray(tickerData.percentiles)) {
          console.log('[WGO W/ News] Checking percentiles array for ranking data');
          // Percentiles array might contain ranking data
          for (const percentile of tickerData.percentiles) {
            if (percentile && typeof percentile === 'object') {
              if (!edgeData.value_rank) edgeData.value_rank = getRankingValue(percentile, 'value');
              if (!edgeData.growth_rank) edgeData.growth_rank = getRankingValue(percentile, 'growth');
              if (!edgeData.quality_rank) edgeData.quality_rank = getRankingValue(percentile, 'quality');
              if (!edgeData.momentum_rank) edgeData.momentum_rank = getRankingValue(percentile, 'momentum');
            }
          }
        }
      }
    }
    
    // Fallback to other possible data structures
    if (!edgeData) {
      edgeData = {
        ticker: ticker.toUpperCase(),
        value_rank: data.value_rank || data.valueRank || data.value || (data.rankings && data.rankings.value) || null,
        growth_rank: data.growth_rank || data.growthRank || data.growth || (data.rankings && data.rankings.growth) || null,
        quality_rank: data.quality_rank || data.qualityRank || data.quality || (data.rankings && data.rankings.quality) || null,
        momentum_rank: data.momentum_rank || data.momentumRank || data.momentum || (data.rankings && data.rankings.momentum) || null,
      };
    }
    
    // Only return if we have at least one valid ranking (non-null, non-undefined)
    // Note: 0 is a valid score, so we check specifically for null/undefined
    if (!edgeData || 
        (edgeData.value_rank === null && edgeData.growth_rank === null && 
         edgeData.quality_rank === null && edgeData.momentum_rank === null)) {
      console.log('[WGO W/ News] No valid Edge rankings found in response');
      return null;
    }
    
    console.log('[WGO W/ News] Processed Edge data:', edgeData);
    return edgeData;
  } catch (error) {
    console.error('[WGO W/ News] Error fetching Edge ratings:', error);
    return null;
  }
}

// Fetch next earnings date from Benzinga calendar
async function fetchNextEarningsDate(ticker: string) {
  try {
    const BENZINGA_API_KEY = process.env.BENZINGA_API_KEY;
    if (!BENZINGA_API_KEY) {
      return null;
    }

    const today = new Date();
    const dateFrom = today.toISOString().split('T')[0];
    // Look ahead 180 days (6 months) for earnings dates
    const dateTo = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    // Use the v2 calendar/earnings endpoint with proper parameters
    const url = 'https://api.benzinga.com/api/v2/calendar/earnings' +
      `?token=${BENZINGA_API_KEY}` +
      `&parameters[tickers]=${encodeURIComponent(ticker)}` +
      `&parameters[date_from]=${dateFrom}` +
      `&parameters[date_to]=${dateTo}` +
      `&pagesize=20`;
    
    const earningsRes = await fetch(url, {
      headers: { accept: 'application/json' }
    });
      
    if (earningsRes.ok) {
      const raw = await earningsRes.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.trim());
      } catch {
        console.log('Earnings calendar: Invalid JSON response');
        return null;
      }
      
      // Handle different response structures (array or wrapped in object)
      interface EarningsResponse {
        earnings?: unknown[];
        results?: unknown[];
        data?: unknown[];
      }
      
      const results: unknown[] = Array.isArray(parsed)
        ? parsed
        : ((parsed as EarningsResponse).earnings 
          || (parsed as EarningsResponse).results 
          || (parsed as EarningsResponse).data 
          || []);
      
      // Find the earliest upcoming earnings date
      interface EarningsItem {
        date?: string;
        earnings_date?: string;
        earningsDate?: string;
        [key: string]: unknown;
      }
      
      const upcomingEarnings = results
        .filter((item: unknown): item is EarningsItem => {
          const earningsItem = item as EarningsItem;
          const earningsDate = earningsItem.date || earningsItem.earnings_date || earningsItem.earningsDate;
          if (!earningsDate) return false;
          const date = new Date(earningsDate);
          return date >= today;
        })
        .sort((a: EarningsItem, b: EarningsItem) => {
          const dateA = new Date(a.date || a.earnings_date || a.earningsDate || 0);
          const dateB = new Date(b.date || b.earnings_date || b.earningsDate || 0);
          return dateA.getTime() - dateB.getTime();
        });
      
      if (upcomingEarnings.length > 0) {
        const nextEarnings = upcomingEarnings[0];
        const earningsDate = nextEarnings.date || nextEarnings.earnings_date || nextEarnings.earningsDate;
        if (earningsDate) {
          // Return full earnings data including estimates
          // Note: Benzinga API returns eps_est and revenue_est (not eps_estimate/revenue_estimate)
          return {
            date: earningsDate,
            eps_estimate: nextEarnings.eps_est || nextEarnings.epsEst || nextEarnings.eps_estimate || nextEarnings.epsEstimate || nextEarnings.estimated_eps || null,
            eps_prior: nextEarnings.eps_prior || nextEarnings.epsPrior || nextEarnings.eps_prev || nextEarnings.previous_eps || null,
            revenue_estimate: nextEarnings.revenue_est || nextEarnings.revenueEst || nextEarnings.revenue_estimate || nextEarnings.revenueEstimate || nextEarnings.estimated_revenue || null,
            revenue_prior: nextEarnings.revenue_prior || nextEarnings.revenuePrior || nextEarnings.rev_prev || nextEarnings.previous_revenue || null,
          };
        }
      }
    } else {
      const errorText = await earningsRes.text().catch(() => '');
      console.log('Earnings calendar error:', errorText.substring(0, 300));
    }
    
    return null;
  } catch (error) {
    console.error('Error fetching next earnings date:', error);
    return null;
  }
}

// Generate comprehensive technical analysis using AI provider

async function generateTechnicalAnalysis(data: TechnicalAnalysisData, provider?: AIProvider, newsContext?: { scrapedContent?: string; selectedArticles?: any[]; newsUrl?: string; primaryArticle?: any }, marketContext?: MarketContext | null): Promise<string> {

  try {

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    const today = new Date();
    const currentDay = today.getDay();
    
    // Markets are closed on weekends, so return Friday for Saturday/Sunday
    // If it's a weekend, return Friday as the last trading day
    const dayOfWeek = (currentDay === 0 || currentDay === 6) ? 'Friday' : dayNames[currentDay];
    const isWeekend = currentDay === 0 || currentDay === 6;

    // Get market status to adjust language appropriately
    const marketStatus = getMarketStatusTimeBased();
    
    // Define URL and outlet variables for use throughout the prompt
    let primaryUrl = '';
    let isBenzinga = false;
    let outletName = '';
    
    if (newsContext && (newsContext.scrapedContent || (newsContext.selectedArticles && newsContext.selectedArticles.length > 0))) {
      primaryUrl = newsContext.newsUrl || (newsContext.selectedArticles && newsContext.selectedArticles[0]?.url) || '';
      isBenzinga = primaryUrl.includes('benzinga.com');
      try {
        const urlDomain = primaryUrl ? new URL(primaryUrl).hostname.replace('www.', '') : '';
        outletName = urlDomain ? urlDomain.split('.')[0].charAt(0).toUpperCase() + urlDomain.split('.')[0].slice(1) : '';
      } catch (e) {
        // Invalid URL, skip outlet name extraction
      }
      // Debug logging
      console.log('[HYPERLINK DEBUG] primaryUrl:', primaryUrl);
      console.log('[HYPERLINK DEBUG] isBenzinga:', isBenzinga);
      console.log('[HYPERLINK DEBUG] outletName:', outletName);
    }
    
    // Get stock sector performance for comparison line
    const sectorPerformance = await getStockSectorPerformance(data.symbol, marketContext || null);
    const sp500Change = marketContext?.indices.find(idx => idx.ticker === 'SPY')?.change || null;

    // Fetch consensus ratings, earnings date, recent analyst actions, and edge ratings
    const [consensusRatings, nextEarnings, recentAnalystActions, edgeRatings] = await Promise.all([
      fetchConsensusRatings(data.symbol),
      fetchNextEarningsDate(data.symbol),
      fetchRecentAnalystActions(data.symbol, 3),
      fetchEdgeRatings(data.symbol)
    ]);
    
    // Validate analyst data to filter out stale information
    let validatedConsensusRatings = consensusRatings;
    if (consensusRatings) {
      const validation = validateAnalystData(
        consensusRatings,
        recentAnalystActions || [],
        data.currentPrice
      );
      
      if (validation.reason) {
        console.log(`[ANALYST VALIDATION] ${validation.reason}`);
      }
      
      // If price target should not be shown, remove it from the consensus ratings object
      if (!validation.shouldShowPriceTarget && consensusRatings) {
        validatedConsensusRatings = {
          ...consensusRatings,
          consensus_price_target: null,
          high_price_target: null,
          low_price_target: null
        };
        console.log('[ANALYST VALIDATION] Removed price target due to stale or unreasonable data');
      }
      
      // If data is completely invalid (no rating either), set to null
      if (!validation.isValid) {
        validatedConsensusRatings = null;
        console.log('[ANALYST VALIDATION] Removed entire consensus ratings due to invalid data');
      }
    }
    
    // Filter out stale analyst actions: 6 months for normal coverage, 12 months for limited coverage (≤2 analysts)
    let validatedRecentAnalystActions = recentAnalystActions || [];
    if (validatedRecentAnalystActions.length > 0) {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      const twelveMonthsAgo = new Date();
      twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
      
      // Check if coverage is limited (≤2 analysts) - use original consensusRatings before validation
      const hasLimitedCoverage = consensusRatings 
        ? (consensusRatings.total_analyst_count || 0) <= 2
        : false;
      
      // Use 6 months for normal coverage, 12 months for limited coverage
      const cutoffDateRaw = hasLimitedCoverage ? twelveMonthsAgo : sixMonthsAgo;
      const cutoffMonths = hasLimitedCoverage ? 12 : 6;
      
      // Normalize cutoff date to midnight for accurate comparison (create new date to avoid mutation)
      const cutoffDate = new Date(cutoffDateRaw);
      cutoffDate.setHours(0, 0, 0, 0);
      
      const initialCount = validatedRecentAnalystActions.length;
      
      validatedRecentAnalystActions = validatedRecentAnalystActions.filter((action: any) => {
        if (!action.date) {
          console.log(`[ANALYST VALIDATION] Filtering out action with no date:`, action);
          return false;
        }
        
        try {
          // Parse date string (format: YYYY-MM-DD)
          const dateParts = action.date.split('-');
          let actionDate: Date;
          if (dateParts.length === 3) {
            actionDate = new Date(parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2]));
          } else {
            actionDate = new Date(action.date);
          }
          
          // Normalize action date to midnight for accurate comparison
          actionDate.setHours(0, 0, 0, 0);
          
          const isRecent = actionDate >= cutoffDate;
          if (!isRecent) {
            console.log(`[ANALYST VALIDATION] Filtering out stale action: ${action.firm} from ${action.date} (cutoff: ${cutoffDate.toISOString().split('T')[0]})`);
          }
          return isRecent;
        } catch (e) {
          // If date parsing fails, exclude the action
          console.log(`[ANALYST VALIDATION] Filtering out action with invalid date format: ${action.date}`, e);
          return false;
        }
      });
      
      if (validatedRecentAnalystActions.length < initialCount) {
        const removedCount = initialCount - validatedRecentAnalystActions.length;
        console.log(`[ANALYST VALIDATION] Filtered out ${removedCount} stale analyst action(s) older than ${cutoffMonths} months${hasLimitedCoverage ? ' (using 12-month cutoff for limited coverage)' : ''}`);
      }
    }
    
    // If no recent actions remain after filtering (or none to begin with), invalidate consensus ratings
    if (validatedRecentAnalystActions.length === 0 && validatedConsensusRatings) {
      validatedConsensusRatings = null;
      const hasLimitedCoverage = consensusRatings ? (consensusRatings.total_analyst_count || 0) <= 2 : false;
      const cutoffMonths = hasLimitedCoverage ? 12 : 6;
      console.log(`[ANALYST VALIDATION] Removed consensus ratings - no recent analyst actions within ${cutoffMonths} months`);
    }
    
    // Log fetched data for debugging
    if (validatedConsensusRatings) {
      console.log('[WGO W/ News] Consensus ratings fetched:', {
        rating: validatedConsensusRatings.consensus_rating,
        priceTarget: validatedConsensusRatings.consensus_price_target,
        buyPercentage: validatedConsensusRatings.buy_percentage,
        totalAnalysts: validatedConsensusRatings.total_analyst_count
      });
    } else {
      console.log('[WGO W/ News] No consensus ratings data available');
    }
    
    if (nextEarnings) {
      console.log('[WGO W/ News] Next earnings fetched:', typeof nextEarnings === 'object' ? nextEarnings : { date: nextEarnings });
    } else {
      console.log('[WGO W/ News] No earnings data available');
    }
    
    // Handle earnings data - could be string (old format) or object (new format)
    const nextEarningsDate = typeof nextEarnings === 'string' ? nextEarnings : nextEarnings?.date || null;

    // Fetch P/E ratio from Benzinga quote API
    let peRatio: number | null = null;
    let useForwardPE = false;
    try {
      const BENZINGA_API_KEY = process.env.BENZINGA_API_KEY;
      if (BENZINGA_API_KEY) {
        const benzingaRes = await fetch(`https://api.benzinga.com/api/v2/quoteDelayed?token=${BENZINGA_API_KEY}&symbols=${data.symbol}`);
        if (benzingaRes.ok) {
          const benzingaData = await benzingaRes.json();
          if (benzingaData && benzingaData[data.symbol]) {
            const quote = benzingaData[data.symbol];
            peRatio = quote.pe || quote.priceEarnings || quote.pe_ratio || null;
            
            // Determine if we should use Forward P/E
            // Rule: IF TrailingEPS < 0 AND ForwardEPS > 0, display "Forward P/E"
            if (nextEarnings && typeof nextEarnings === 'object') {
              const trailingEPS = nextEarnings.eps_prior ? parseFloat(nextEarnings.eps_prior.toString()) : null;
              const forwardEPS = nextEarnings.eps_estimate ? parseFloat(nextEarnings.eps_estimate.toString()) : null;
              
              if (trailingEPS !== null && forwardEPS !== null) {
                useForwardPE = trailingEPS < 0 && forwardEPS > 0;
                console.log(`[P/E RATIO] Trailing EPS: ${trailingEPS}, Forward EPS: ${forwardEPS}, Using Forward P/E: ${useForwardPE}`);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Error fetching P/E ratio:', error);
    }

    

    // Calculate MA relationships

    const maRelationships = [];

    if (data.sma20 && data.currentPrice) {

      const pct = ((data.currentPrice - data.sma20) / data.sma20 * 100).toFixed(1);

      maRelationships.push(`20-day SMA: ${Math.abs(parseFloat(pct))}% ${parseFloat(pct) >= 0 ? 'above' : 'below'}`);

    }

    if (data.sma50 && data.currentPrice) {

      const pct = ((data.currentPrice - data.sma50) / data.sma50 * 100).toFixed(1);

      maRelationships.push(`50-day SMA: ${Math.abs(parseFloat(pct))}% ${parseFloat(pct) >= 0 ? 'above' : 'below'}`);

    }

    if (data.sma100 && data.currentPrice) {

      const pct = ((data.currentPrice - data.sma100) / data.sma100 * 100).toFixed(1);

      maRelationships.push(`100-day SMA: ${Math.abs(parseFloat(pct))}% ${parseFloat(pct) >= 0 ? 'above' : 'below'}`);

    }

    if (data.sma200 && data.currentPrice) {

      const pct = ((data.currentPrice - data.sma200) / data.sma200 * 100).toFixed(1);

      maRelationships.push(`200-day SMA: ${Math.abs(parseFloat(pct))}% ${parseFloat(pct) >= 0 ? 'above' : 'below'}`);

    }

    

    // Check for MA crossovers

    // Only mention golden/death cross if we have a historical date for it

    // Otherwise, just describe the current relationship

    const crossovers = [];

    if (data.sma20 && data.sma50) {

      if (data.sma20 > data.sma50) crossovers.push('20-day SMA above 50-day SMA (bullish)');

      else crossovers.push('20-day SMA below 50-day SMA (bearish)');

    }

    if (data.sma50 && data.sma200) {

      if (data.sma50 > data.sma200) {

        // Only call it "golden cross" if we have a historical date

        if (data.turningPoints?.goldenCrossDate) {

          crossovers.push('50-day SMA above 200-day SMA (golden cross)');

        } else {

          crossovers.push('50-day SMA above 200-day SMA (bullish long-term trend)');

        }

      } else {

        // Only call it "death cross" if we have a historical date

        if (data.turningPoints?.deathCrossDate) {

          crossovers.push('50-day SMA below 200-day SMA (death cross)');

        } else {

          crossovers.push('50-day SMA below 200-day SMA (bearish long-term trend)');

        }

      }

    }
    
    // CRITICAL: Fetch fresh price data RIGHT BEFORE generating the article to ensure lead and Catalyst use the same data as price action line
    // This MUST happen right before building the prompt, after all other data fetching is complete
    console.log(`[PRICE ACTION SYNC] ===== Starting sync for ${data.symbol} (RIGHT BEFORE PROMPT BUILD) =====`);
    console.log(`[PRICE ACTION SYNC] Fetching fresh price data for ${data.symbol} using shared helper...`);
    const freshPriceData = await fetchPriceDataFromBenzinga(data.symbol);
    console.log(`[PRICE ACTION SYNC] Fresh price data received: ${freshPriceData ? `changePercent=${freshPriceData.changePercent ?? 'undefined'}` : 'null'}`);
    
    if (freshPriceData) {
      const oldChangePercent = data.changePercent;
      // Update changePercent with fresh data from API (use 0 as fallback for data structure)
      data.changePercent = freshPriceData.changePercent ?? 0;
      // Also update currentPrice if available
      if (freshPriceData.quote.lastTradePrice) {
        data.currentPrice = typeof freshPriceData.quote.lastTradePrice === 'number' 
          ? freshPriceData.quote.lastTradePrice 
          : parseFloat(freshPriceData.quote.lastTradePrice);
      }
      console.log(`[PRICE ACTION SYNC] ✅ SUCCESS: Updated data.changePercent from ${oldChangePercent}% to ${data.changePercent}% for ${data.symbol}`);
      console.log(`[PRICE ACTION SYNC] Verified: data.changePercent is now ${data.changePercent}%`);
    } else {
      console.warn(`[PRICE ACTION SYNC] ⚠️ Failed to fetch fresh price data for ${data.symbol}`);
    }

    // Log description availability before building prompt
    console.log(`[PROMPT BUILD] ${data.symbol}: data.description exists?`, !!data.description);
    console.log(`[PROMPT BUILD] ${data.symbol}: data.description value:`, data.description ? `${data.description.substring(0, 100)}...` : 'null');
    console.log(`[PROMPT BUILD] ${data.symbol}: Will include Company Context section?`, data.description && data.description !== 'N/A' ? 'YES' : 'NO');

    const prompt = `You are a professional technical analyst writing a comprehensive stock analysis focused on longer-term trends and technical indicators. Today is ${dayOfWeek}.

CURRENT MARKET STATUS: ${marketStatus === 'open' ? 'Markets are currently OPEN' : marketStatus === 'premarket' ? 'Markets are in PREMARKET trading' : marketStatus === 'afterhours' ? 'Markets are CLOSED (after-hours session ended)' : 'Markets are CLOSED'}

CRITICAL: Adjust your language based on market status:
- If markets are OPEN or in PREMARKET: Use present tense (e.g., "the market is experiencing", "the sector is gaining", "stocks are trading")
- If markets are CLOSED or AFTER-HOURS: Use past tense (e.g., "the market experienced", "the sector gained", "stocks closed", "on the trading day")
${isWeekend ? '- CRITICAL WEEKEND RULE: Today is a weekend (Saturday or Sunday). Markets are CLOSED on weekends. In the lead paragraph, you MUST use PAST TENSE ("were down", "were up", "closed down", "closed up") instead of present tense ("are down", "are up"). Reference Friday as the last trading day.' : ''}



STOCK: ${data.companyNameWithExchange || `${data.companyName} (${data.symbol})`}

Current Price: $${formatPrice(data.currentPrice)}${marketStatus === 'afterhours' && data.regularSessionClosePrice ? `
Regular Session Close Price: $${formatPrice(data.regularSessionClosePrice)}
CRITICAL: During after-hours, the "Current Price" above is the AFTER-HOURS price. When writing about the closing price in the lede, use ONLY the "Regular Session Close Price" shown above, or better yet, DO NOT include a specific closing price amount in the lede - only mention the direction (up/down) and day. The specific closing price is already provided in the price action line at the bottom of the article.` : ''}

${marketStatus === 'premarket' ? `Premarket Change: ${data.changePercent.toFixed(2)}%

CRITICAL: The "Premarket Change" value above is the PREMARKET change percentage (current premarket price vs previous day's close). Use this value to determine if shares are UP or DOWN during premarket trading. ${data.changePercent >= 0 ? 'Shares are UP during premarket trading.' : 'Shares are DOWN during premarket trading.'} Use this direction when writing the lead paragraph and comparison line.` : `Daily Change (REGULAR SESSION ONLY): ${data.changePercent.toFixed(2)}%

CRITICAL: The "Daily Change (REGULAR SESSION ONLY)" value above is the REGULAR TRADING SESSION change percentage only (does NOT include after-hours movement). Use this value to determine if shares were UP or DOWN during regular trading. ${data.changePercent >= 0 ? 'Shares were UP during regular trading.' : 'Shares were DOWN during regular trading.'} Use this direction when writing the lead paragraph and comparison line.`}

${sectorPerformance && sp500Change !== null ? `
COMPARISON LINE (USE THIS EXACT FORMAT AT THE START OF THE ARTICLE, IMMEDIATELY AFTER THE HEADLINE):
${data.companyNameWithExchange || data.companyName} stock ${isWeekend ? 'was' : 'is'} ${data.changePercent >= 0 ? 'up' : 'down'} approximately ${Math.abs(data.changePercent).toFixed(1)}% on ${dayOfWeek} versus a ${sectorPerformance.sectorChange.toFixed(1)}% ${sectorPerformance.sectorChange >= 0 ? 'gain' : 'loss'} in the ${sectorPerformance.sectorName} sector and a ${Math.abs(sp500Change).toFixed(1)}% ${sp500Change >= 0 ? 'gain' : 'loss'} in the S&P 500.

CRITICAL: This comparison line should appear immediately after the headline and before the main story content. Use this EXACT format with these EXACT numbers:
- Stock direction: ${data.changePercent >= 0 ? 'up' : 'down'}
- Stock percentage: ${Math.abs(data.changePercent).toFixed(1)}%
- Sector change: ${sectorPerformance.sectorChange.toFixed(1)}% ${sectorPerformance.sectorChange >= 0 ? 'gain' : 'loss'}
- S&P 500 change: ${Math.abs(sp500Change).toFixed(1)}% ${sp500Change >= 0 ? 'gain' : 'loss'}
DO NOT make up your own numbers - use ONLY the values provided above.
` : ''}

${marketContext ? `
BROADER MARKET CONTEXT (use this to explain the stock's move):

Major Indices:
${marketContext.indices.map(idx => `- ${idx.name} (${idx.ticker}): ${idx.change > 0 ? '+' : ''}${idx.change.toFixed(2)}%`).join('\n')}

Sector Performance (sorted by performance):
${marketContext.sectors.slice(0, 5).map(s => `- ${s.name} (${s.ticker}): ${s.change > 0 ? '+' : ''}${s.change.toFixed(2)}%`).join('\n')}

Market Breadth:
- Sectors advancing: ${marketContext.marketBreadth.advancers}
- Sectors declining: ${marketContext.marketBreadth.decliners}
- Advance/Decline Ratio: ${marketContext.marketBreadth.ratio}

Top Gainers: ${marketContext.topGainers.map(g => `${g.ticker} +${g.change.toFixed(1)}%`).join(', ')}
Top Losers: ${marketContext.topLosers.map(l => `${l.ticker} ${l.change.toFixed(1)}%`).join(', ')}

CRITICAL: Use this market context to explain the stock's move. For example:
- If the stock is down but the broader market/sector is up, note that the stock is underperforming despite positive market conditions (suggesting company-specific concerns)
- If the stock is up and the broader market/sector is also up, note that the stock is moving with broader market trends
- If the stock is down and the broader market/sector is also down, note that the stock is caught in a broader sell-off
- Reference specific sector performance when relevant (e.g., "Technology stocks are broadly lower today, contributing to the decline")
` : ''}



MULTI-TIMEFRAME PERFORMANCE:

${data.twelveMonthReturn !== undefined ? `- 12-Month: ${data.twelveMonthReturn.toFixed(2)}%` : '- 12-Month: N/A'}



MOVING AVERAGES:

${data.sma20 ? `- 20-day SMA: $${formatPrice(data.sma20)}` : '- 20-day SMA: N/A'}

${data.sma50 ? `- 50-day SMA: $${formatPrice(data.sma50)}` : '- 50-day SMA: N/A'}

${data.sma100 ? `- 100-day SMA: $${formatPrice(data.sma100)}` : '- 100-day SMA: N/A'}

${data.sma200 ? `- 200-day SMA: $${formatPrice(data.sma200)}` : '- 200-day SMA: N/A'}

${data.ema20 ? `- 20-day EMA: $${formatPrice(data.ema20)}` : '- 20-day EMA: N/A'}

${data.ema50 ? `- 50-day EMA: $${formatPrice(data.ema50)}` : '- 50-day EMA: N/A'}

${data.ema100 ? `- 100-day EMA: $${formatPrice(data.ema100)}` : '- 100-day EMA: N/A'}

${data.ema200 ? `- 200-day EMA: $${formatPrice(data.ema200)}` : '- 200-day EMA: N/A'}



PRICE RELATIVE TO MOVING AVERAGES:

${maRelationships.join('\n')}



MOVING AVERAGE CROSSOVERS:

${crossovers.length > 0 ? crossovers.join('\n') : 'No significant crossovers detected'}



TECHNICAL INDICATORS:

- RSI: ${data.rsi ? data.rsi.toFixed(2) : 'N/A'} ${data.rsiSignal ? `(${data.rsiSignal})` : ''}

- MACD: ${data.macd !== undefined && data.macdSignal !== undefined ? (data.macd > data.macdSignal ? 'MACD is above signal line (bullish)' : 'MACD is below signal line (bearish)') : 'N/A'}



SUPPORT/RESISTANCE:

- Support Level: ${data.supportLevel ? `$${formatPrice(data.supportLevel)}` : 'N/A'}

- Resistance Level: ${data.resistanceLevel ? `$${formatPrice(data.resistanceLevel)}` : 'N/A'}



52-WEEK RANGE:

- High: $${formatPrice(data.fiftyTwoWeekHigh)}

- Low: $${formatPrice(data.fiftyTwoWeekLow)}

- Current Price: $${formatPrice(data.currentPrice)}



KEY TURNING POINTS:

${data.turningPoints?.rsiOverboughtDate ? `- RSI entered overbought territory (>70) on ${data.turningPoints.rsiOverboughtDate}` : ''}

${data.turningPoints?.rsiOversoldDate ? `- RSI entered oversold territory (<30) on ${data.turningPoints.rsiOversoldDate}` : ''}

${(() => {

  // Only include golden cross if it's recent (within last 4 months)

  if (data.turningPoints?.goldenCrossDate) {

    // Use the exact date string from API - parse it to get month name

    const dateParts = data.turningPoints.goldenCrossDate.split('-');

    const year = parseInt(dateParts[0], 10);

    const monthIndex = parseInt(dateParts[1], 10) - 1; // Month is 0-indexed

    const day = parseInt(dateParts[2], 10);

    const crossDate = new Date(year, monthIndex, day);

    

    // Always include if date exists (remove 4-month restriction for now to debug)

    // Get month name from the exact date string

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    const monthName = monthNames[monthIndex];

    const monthNumber = parseInt(dateParts[1], 10); // 1-12

    

      console.log(`[GOLDEN CROSS DATE] API Date String: ${data.turningPoints.goldenCrossDate}, Month Number: ${monthNumber}, Month Name: ${monthName}, Month Index: ${monthIndex}, Parsed Date: ${crossDate.toISOString()}`);

      

      const fourMonthsAgo = new Date();

      fourMonthsAgo.setMonth(fourMonthsAgo.getMonth() - 4);

      const isRecent = crossDate >= fourMonthsAgo;

      console.log(`[GOLDEN CROSS DATE] Is recent (>= ${fourMonthsAgo.toISOString().split('T')[0]}): ${isRecent}`);

      

      // Always include in prompt with explicit month, but mark if recent

      const recentTag = isRecent ? ' [RECENT]' : '';

      // Pass the exact date with clear instructions - use proper case, not ALL CAPS

      return `- Golden cross occurred (50-day SMA crossed above 200-day SMA) on ${monthName} ${day}, ${year} (date string: ${data.turningPoints.goldenCrossDate})${recentTag} [CRITICAL: The golden cross happened in ${monthName}. You MUST write "In ${monthName}" or "The golden cross in ${monthName}" using proper capitalization (first letter uppercase, rest lowercase - e.g., "June" or "September", NOT "JUNE" or "SEPTEMBER"). Use ${monthName} exactly as shown here.]`;

  }

  return '';

})()}

${(() => {

  // Include death cross if it exists (already filtered for recency in analyzeTurningPoints)

  if (data.turningPoints?.deathCrossDate) {

    // Use the exact date string from API

    const dateParts = data.turningPoints.deathCrossDate.split('-');

    const year = parseInt(dateParts[0], 10);

    const monthIndex = parseInt(dateParts[1], 10) - 1; // Month is 0-indexed

    const day = parseInt(dateParts[2], 10);

    const crossDate = new Date(year, monthIndex, day);

    

    console.log(`[DEATH CROSS DATE] API Date String: ${data.turningPoints.deathCrossDate}, Month Number: ${parseInt(dateParts[1], 10)}, Month Index: ${monthIndex}, Parsed Date: ${crossDate.toISOString()}`);

    

    // Get month name from the exact date string

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    const monthName = monthNames[monthIndex];

    const monthNumber = parseInt(dateParts[1], 10); // 1-12

    

    console.log(`[DEATH CROSS DATE] Month name: ${monthName}, Month number: ${monthNumber}`);

    

    // Pass the exact date with very explicit instructions - use proper case, not ALL CAPS

    // CRITICAL: Make it absolutely clear what month to use and explicitly forbid using current month

    const today = new Date();

    const currentMonthName = monthNames[today.getMonth()];

    

    return `- Death cross occurred (50-day SMA crossed below 200-day SMA) on ${data.turningPoints.deathCrossDate} (which is ${monthName} ${day}, ${year}) [CRITICAL INSTRUCTION: The death cross happened in ${monthName.toUpperCase()}. The date ${data.turningPoints.deathCrossDate} = Year ${year}, Month ${monthNumber} = ${monthName}. You MUST write "In ${monthName}" or "The death cross in ${monthName}". DO NOT use "${currentMonthName}" (the current month). DO NOT use any other month. The month is ${monthName.toUpperCase()} - use ONLY ${monthName} with proper capitalization (first letter uppercase, rest lowercase).]`;

  }

  return '';

})()}

${data.turningPoints?.macdBullishCrossDate ? `- MACD bullish cross (MACD crossed above signal line) on ${data.turningPoints.macdBullishCrossDate}` : ''}

${data.turningPoints?.macdBearishCrossDate ? `- MACD bearish cross (MACD crossed below signal line) on ${data.turningPoints.macdBearishCrossDate}` : ''}

${data.turningPoints?.macdZeroCrossAboveDate ? `- MACD crossed above zero line on ${data.turningPoints.macdZeroCrossAboveDate}` : ''}

${data.turningPoints?.macdZeroCrossBelowDate ? `- MACD crossed below zero line on ${data.turningPoints.macdZeroCrossBelowDate}` : ''}

${data.turningPoints?.recentSwingHighDate ? `- Recent swing high on ${data.turningPoints.recentSwingHighDate}` : ''}

${data.turningPoints?.recentSwingLowDate ? `- Recent swing low on ${data.turningPoints.recentSwingLowDate}` : ''}

${data.turningPoints?.fiftyTwoWeekHighDate ? `- 52-week high reached on ${data.turningPoints.fiftyTwoWeekHighDate}` : ''}

${data.turningPoints?.fiftyTwoWeekLowDate ? `- 52-week low reached on ${data.turningPoints.fiftyTwoWeekLowDate}` : ''}

${data.turningPoints?.resistanceBreakDate ? `- Price broke above resistance on ${data.turningPoints.resistanceBreakDate}` : ''}

${data.turningPoints?.supportBreakDate ? `- Price broke below support on ${data.turningPoints.supportBreakDate}` : ''}

${!data.turningPoints || Object.keys(data.turningPoints).length === 0 ? '- No significant turning points identified in the past year' : ''}

${validatedConsensusRatings || nextEarnings ? `
EARNINGS AND ANALYST OUTLOOK SECTION (forward-looking):
After the technical analysis section, you MUST include a separate section with the header "## Section: Earnings & Analyst Outlook". This section should be forward-looking and help investors understand both the stock's value proposition and how analysts view it.

CRITICAL INSTRUCTIONS FOR THIS SECTION:
- Start with ONE introductory sentence (e.g., "Investors are looking ahead to the next earnings report on [DATE].")
- Then format the data as HTML bullet points with bold labels
- Group "Hard Numbers" together: EPS Estimate, Revenue Estimate, and Valuation (P/E Ratio) as separate bullet points
- Group "Opinions" together: Create a subsection "Analyst Consensus & Recent Actions" that includes:
  - The consensus rating and average price target
  - Recent analyst moves (last 3) with firm names, specific actions, and dates (e.g., "Goldman Sachs: Upgraded to Buy (Raised Target to $500) (Jan. 15)" or "Goldman Sachs: Upgraded to Buy (Raised Target to $500) (Jan. 15, 2023)" if from previous year)
- Format example:
  <ul>
  <li><strong>EPS Estimate</strong>: $X.XX (Up/Down from $X.XX YoY)</li>
  <li><strong>Revenue Estimate</strong>: $X.XX Billion (Up/Down from $X.XX Billion YoY)</li>
  ${peRatio !== null ? `<li><strong>Valuation</strong>: ${useForwardPE ? 'Forward' : ''} P/E of ${peRatio.toFixed(1)}x (Indicates ${peRatio > 25 ? 'premium valuation' : peRatio < 15 ? 'value opportunity' : 'fair valuation'})</li>` : ''}
  </ul>
  
  <strong>Analyst Consensus & Recent Actions:</strong>
  The stock carries a ${validatedConsensusRatings?.consensus_rating ? validatedConsensusRatings.consensus_rating.charAt(0) + validatedConsensusRatings.consensus_rating.slice(1).toLowerCase() : 'N/A'} Rating${validatedConsensusRatings?.consensus_price_target ? ` with an <a href="https://www.benzinga.com/quote/${data.symbol}/analyst-ratings">average price target</a> of $${parseFloat(validatedConsensusRatings.consensus_price_target.toString()).toFixed(2)}` : ''}. ${validatedRecentAnalystActions && validatedRecentAnalystActions.length > 0 ? `Recent analyst moves include:\n${validatedRecentAnalystActions.map((action: any) => {
    let dateStr = '';
    if (action.date) {
      try {
        const actionDate = new Date(action.date);
        const currentYear = new Date().getFullYear();
        const actionYear = actionDate.getFullYear();
        const formattedDate = formatDateAPStyle(actionDate, actionYear < currentYear);
        if (formattedDate) {
          dateStr = ` (${formattedDate})`;
        }
      } catch (e) {
        // If date parsing fails, skip date
      }
    }
    return `${action.firm}: ${action.action}${dateStr}`;
  }).join('\n')}` : 'No recent analyst actions available.'}

${nextEarnings ? `
UPCOMING EARNINGS DATA:
- Next Earnings Date: ${typeof nextEarnings === 'object' && nextEarnings.date ? formatEarningsDate(nextEarnings.date) : nextEarningsDate ? formatEarningsDate(nextEarningsDate) : 'Not available'}
${typeof nextEarnings === 'object' && nextEarnings.eps_estimate ? `- EPS Estimate: ${formatEPS(nextEarnings.eps_estimate as number | string | null | undefined)}` : ''}
${typeof nextEarnings === 'object' && nextEarnings.eps_prior ? `- Previous EPS: ${formatEPS(nextEarnings.eps_prior as number | string | null | undefined)}` : ''}
${typeof nextEarnings === 'object' && nextEarnings && 'revenue_estimate' in nextEarnings && nextEarnings.revenue_estimate != null ? `- Revenue Estimate: ${formatRevenue(nextEarnings.revenue_estimate as string | number | null)}` : ''}
${typeof nextEarnings === 'object' && nextEarnings && 'revenue_prior' in nextEarnings && nextEarnings.revenue_prior != null ? `- Previous Revenue: ${formatRevenue(nextEarnings.revenue_prior as string | number | null)}` : ''}

` : ''}

${validatedConsensusRatings ? `
ANALYST OUTLOOK DATA:
- Consensus Rating: ${validatedConsensusRatings.consensus_rating ? validatedConsensusRatings.consensus_rating.charAt(0) + validatedConsensusRatings.consensus_rating.slice(1).toLowerCase() : 'N/A'}
- Consensus Price Target: ${validatedConsensusRatings.consensus_price_target ? '$' + parseFloat(validatedConsensusRatings.consensus_price_target.toString()).toFixed(2) : 'N/A'}
${validatedConsensusRatings.high_price_target ? `- High Price Target: $${parseFloat(validatedConsensusRatings.high_price_target.toString()).toFixed(2)}` : ''}
${validatedConsensusRatings.low_price_target ? `- Low Price Target: $${parseFloat(validatedConsensusRatings.low_price_target.toString()).toFixed(2)}` : ''}
${validatedConsensusRatings.total_analyst_count ? `- Total Analysts: ${validatedConsensusRatings.total_analyst_count}` : ''}
${validatedConsensusRatings.buy_percentage ? `- Buy Rating: ${parseFloat(validatedConsensusRatings.buy_percentage.toString()).toFixed(1)}%` : ''}
${validatedConsensusRatings.hold_percentage ? `- Hold Rating: ${parseFloat(validatedConsensusRatings.hold_percentage.toString()).toFixed(1)}%` : ''}
${validatedConsensusRatings.sell_percentage ? `- Sell Rating: ${parseFloat(validatedConsensusRatings.sell_percentage.toString()).toFixed(1)}%` : ''}
` : ''}

${peRatio !== null ? `
P/E RATIO CONTEXT:
- ${useForwardPE ? 'Forward' : 'Current'} P/E Ratio: ${peRatio.toFixed(1)}x
- Valuation Assessment: ${peRatio > 25 ? 'Indicates premium valuation' : peRatio < 15 ? 'Indicates value opportunity' : 'Suggests fair valuation'} relative to peers
` : ''}

${validatedRecentAnalystActions && validatedRecentAnalystActions.length > 0 ? `
RECENT ANALYST ACTIONS (Last 3 Major Actions):
${validatedRecentAnalystActions.map((action: any) => {
  let dateStr = '';
  if (action.date) {
    try {
      // Use date string directly from API - no Date object conversion (avoids timezone issues)
      const dateString = String(action.date);
      // Extract year from date string (YYYY-MM-DD format) to determine if year should be included
      const dateMatch = dateString.match(/^(\d{4})-/);
      const currentYear = new Date().getFullYear();
      const actionYear = dateMatch ? parseInt(dateMatch[1], 10) : currentYear;
      const formattedDate = formatDateAPStyle(dateString, actionYear < currentYear);
      if (formattedDate) {
        dateStr = ` (${formattedDate})`;
      }
    } catch (e) {
      // If date parsing fails, skip date
    }
  }
  return `- ${action.firm}: ${action.action}${dateStr}`;
}).join('\n')}
` : ''}

CRITICAL FORMATTING REQUIREMENTS:
- Start with ONE introductory sentence (e.g., "Investors are looking ahead to the company's next earnings report on [DATE].")
- Then format the data as separate lines (not HTML bullets) with bold labels
- Each data point should be on its own line with a blank line between them
- Format example:
  <strong>EPS Estimate</strong>: $X.XX (Up/Down from $X.XX YoY)

  <strong>Revenue Estimate</strong>: $X.XX Billion (Up/Down from $X.XX Billion YoY)

  <strong>Analyst Consensus</strong>: [Rating] Rating ($X.XX Avg Price Target)

MANDATORY: You MUST include "## Section: Earnings & Analyst Outlook" as a separate section header AFTER "## Section: Technical Analysis" and ${edgeRatings ? 'BEFORE "## Section: Benzinga Edge Rankings"' : 'BEFORE "## Section: Price Action"'}. Write 2-3 sentences that integrate earnings data (if available), analyst consensus (if available), and P/E ratio (if available) into a cohesive narrative that helps investors understand the stock's value proposition and analyst sentiment. Do NOT write separate paragraphs for each data point - weave them together naturally.
${edgeRatings ? `
## Section: Benzinga Edge Rankings
After the "## Section: Earnings & Analyst Outlook" section, include a section analyzing the Benzinga Edge rankings.

CRITICAL FORMATTING: Immediately after the "## Section: Benzinga Edge Rankings" header, add this line: "Below is the <a href=\"https://www.benzinga.com/screener\">Benzinga Edge scorecard</a> for ${simplifyCompanyNameForEdge(data.companyName || data.symbol)}, highlighting its strengths and weaknesses compared to the broader market:"

BENZINGA EDGE RANKINGS DATA:
- Value Rank: ${edgeRatings.value_rank !== null && edgeRatings.value_rank !== undefined && edgeRatings.value_rank !== 0 ? edgeRatings.value_rank.toString() : 'N/A'}
- Growth Rank: ${edgeRatings.growth_rank !== null && edgeRatings.growth_rank !== undefined && edgeRatings.growth_rank !== 0 ? edgeRatings.growth_rank.toString() : 'N/A'}
- Quality Rank: ${edgeRatings.quality_rank !== null && edgeRatings.quality_rank !== undefined && edgeRatings.quality_rank !== 0 ? edgeRatings.quality_rank.toString() : 'N/A'}
- Momentum Rank: ${edgeRatings.momentum_rank !== null && edgeRatings.momentum_rank !== undefined && edgeRatings.momentum_rank !== 0 ? edgeRatings.momentum_rank.toString() : 'N/A'}

CRITICAL: Use the EXACT numbers from the data above. Do NOT convert or multiply the values. Display them exactly as provided:
- If the value is a decimal (e.g., 0.89), display it as "0.89" - do NOT convert to 89 or multiply by 100
- If the value is already 0-100 (e.g., 83), display it as "83/100"
- If a ranking is "N/A", null, undefined, OR if the value is exactly 0 (zero), OMIT IT COMPLETELY from the output - do NOT display it as "0/100" or mention it at all. A value of 0 means no data, not a score of zero.

BENZINGA EDGE SECTION RULES - FORMAT AS "TRADER'S SCORECARD":

1. FORMAT: Use a bulleted list with HTML <ul> and <li> tags, NOT paragraphs. This structured format helps with SEO and Featured Snippets.

2. SCORING LOGIC & LABELS:
   IMPORTANT: The normal range is 1-100. Scores below 1 are very weak and bearish.
   
   For scores BELOW 1 (e.g., 0.89, 0.45, 0.12):
   - ALWAYS label as "Weak" or "Bearish" - these are very weak scores
   - A score of 0.89 means the stock is performing poorly, not well
   
   For scores 1-5 (very low, barely above threshold):
   - ALWAYS label as "Weak" or "Bearish" - these scores are extremely low and indicate poor performance
   - A score of 1.47 means the stock is performing very poorly, similar to sub-1 scores
   - Do NOT label scores in the 1-5 range as "Bullish" - they are bearish indicators
   
   For scores 5-30:
   - Label as "Weak" or "Bearish" - still indicating poor performance
   
   For scores 30-70:
   - Label as "Neutral" or "Moderate"
   
   For scores > 70:
   - Label as "Strong" or "Bullish"
   
   CRITICAL: Any score less than 1.0 OR between 1.0 and 5.0 is very weak and bearish. Do NOT label scores like 0.89 or 1.47 as "Bullish" or "Neutral" - they should be labeled as "Weak" or "Bearish".

3. INTERPRETATION: Do NOT just list the number. Add a 1-sentence interpretation after each score.

4. FORMAT EXAMPLE (use HTML bullets):
   - For decimal values below 1 (very weak): <li><strong>Momentum</strong>: Weak (Score: 0.89) — Stock is underperforming the broader market.</li>
   - For very low scores (1-5 range): <li><strong>Momentum</strong>: Bearish (Score: 1.47) — Stock is showing very weak performance indicators.</li>
   - For low scores (5-30 range): <li><strong>Value</strong>: Weak (Score: 15/100) — Trading at a steep premium relative to peers.</li>
   - For moderate scores (30-70 range): <li><strong>Quality</strong>: Neutral (Score: 66/100) — Balance sheet remains healthy.</li>
   - For high scores (>70): <li><strong>Momentum</strong>: Bullish (Score: 83/100) — Stock is outperforming the broader market.</li>
   
   IMPORTANT: Display the score exactly as provided in the data above. If it's 0.89, show "0.89" (NOT "0.89/1" or "89/100"). If it's 83, show "83/100". Do NOT convert decimals to whole numbers or multiply by 100.

5. HANDLING N/A OR ZERO: If a ranking is "N/A", null, undefined, OR if the value is exactly 0 (zero), OMIT IT COMPLETELY. Do NOT write "Quality ranking N/A" or "Quality: Weak (Score: 0/100)" - simply do not include that ranking at all. A value of 0 means no data exists, not a score of zero. Only include rankings that have actual non-zero numeric values.

6. THE VERDICT: After the bullet list, add a 2-sentence summary that synthesizes the rankings and provides actionable insight. Start with "<strong>The Verdict:</strong> ${simplifyCompanyNameForEdge(data.companyName || data.symbol)}'s Benzinga Edge signal reveals..." and continue with the analysis. Example: "<strong>The Verdict:</strong> Tesla's Benzinga Edge signal reveals a classic 'High-Flyer' setup. While the Momentum (83) confirms the strong trend, the extremely low Value (4) score warns that the stock is priced for perfection—investors should ride the trend but use tight stop-losses."

7. IMAGE: After "The Verdict" summary, add this image HTML: <p><img src="https://www.benzinga.com/edge/${data.symbol.toUpperCase()}.png" alt="Benzinga Edge Rankings for ${simplifyCompanyNameForEdge(data.companyName || data.symbol)}" style="max-width: 100%; height: auto;" /></p>

8. ORDER: Present rankings in order of importance: Momentum first, then Quality, then Value, then Growth (if available).
` : ''}

IMPORTANT: CRITICAL RULE - Only mention "analysts expecting earnings per share" if eps_estimate is actually available. Do NOT use eps_prior (same quarter from prior year) as an expectation. eps_prior is only for comparison purposes when eps_estimate exists. If eps_estimate is null/not available, do NOT write "analysts expecting earnings per share" - instead, just mention the earnings date without specific estimates.

When earnings estimates ARE available, ALWAYS compare them to the same quarter from the previous year (year-over-year comparison):
- If eps_estimate AND eps_prior are both available, compare eps_estimate to eps_prior (e.g., "analysts expecting earnings per share of $0.75, up from $0.65 in the same quarter last year" or "compared to $0.65 from the prior-year period")
- If revenue_estimate AND revenue_prior are both available, compare revenue_estimate to revenue_prior (e.g., "revenue of $25.5M, up from $23.2M from the same quarter last year")
- NOTE: eps_prior and revenue_prior represent the same quarter from the previous year, NOT the sequentially previous quarter
- This year-over-year comparison helps investors understand whether expectations show growth, decline, or stability compared to the same period last year

EXAMPLE APPROACH (adapt based on available data):
${nextEarnings && consensusRatings && peRatio !== null ? `
"Investors are looking ahead to the company's next earnings report, scheduled for ${typeof nextEarnings === 'object' && nextEarnings.date ? formatEarningsDate(nextEarnings.date) : nextEarningsDate ? formatEarningsDate(nextEarningsDate) : 'a date to be announced'}, with analysts expecting earnings per share of $${typeof nextEarnings === 'object' && nextEarnings.eps_estimate ? parseFloat(nextEarnings.eps_estimate.toString()).toFixed(2) : 'N/A'}${typeof nextEarnings === 'object' && nextEarnings.eps_prior ? `, ${parseFloat(nextEarnings.eps_estimate?.toString() || '0') > parseFloat(nextEarnings.eps_prior.toString()) ? 'up from' : parseFloat(nextEarnings.eps_estimate?.toString() || '0') < parseFloat(nextEarnings.eps_prior.toString()) ? 'down from' : 'compared to'} $${parseFloat(nextEarnings.eps_prior.toString()).toFixed(2)} from the same quarter last year` : ''}${typeof nextEarnings === 'object' && nextEarnings && 'revenue_estimate' in nextEarnings && 'revenue_prior' in nextEarnings && nextEarnings.revenue_estimate && nextEarnings.revenue_prior ? ` and revenue of ${formatRevenue(nextEarnings.revenue_estimate as string | number | null)}${parseFloat((nextEarnings.revenue_estimate as string | number).toString()) > parseFloat((nextEarnings.revenue_prior as string | number).toString()) ? ', up from' : parseFloat((nextEarnings.revenue_estimate as string | number).toString()) < parseFloat((nextEarnings.revenue_prior as string | number).toString()) ? ', down from' : ', compared to'} ${formatRevenue(nextEarnings.revenue_prior as string | number | null)} from the same quarter last year` : ''}. ${data.companyName || data.symbol} has a consensus ${consensusRatings.consensus_rating ? consensusRatings.consensus_rating.charAt(0) + consensusRatings.consensus_rating.slice(1).toLowerCase() : 'N/A'} rating among analysts${consensusRatings.consensus_price_target ? ` with an average price target of $${parseFloat(consensusRatings.consensus_price_target.toString()).toFixed(2)}` : ''}, which ${peRatio > 25 ? 'suggests the stock may be trading at a premium' : peRatio < 15 ? 'suggests the stock may offer value' : 'aligns with current valuation levels'}. ${consensusRatings.buy_percentage && parseFloat(consensusRatings.buy_percentage.toString()) > 50 ? `The analyst community is largely bullish, with ${parseFloat(consensusRatings.buy_percentage.toString()).toFixed(0)}% buy ratings, ` : consensusRatings.hold_percentage && parseFloat(consensusRatings.hold_percentage.toString()) > 50 ? `Analysts are cautious, with ${parseFloat(consensusRatings.hold_percentage.toString()).toFixed(0)}% hold ratings, ` : ''}${consensusRatings.total_analyst_count ? `with ${consensusRatings.total_analyst_count} analysts covering the stock.` : 'as investors await the earnings results.'}"
` : nextEarnings && validatedConsensusRatings ? `
"Investors are looking ahead to the company's next earnings report, scheduled for ${typeof nextEarnings === 'object' && nextEarnings.date ? formatEarningsDate(nextEarnings.date) : nextEarningsDate ? formatEarningsDate(nextEarningsDate) : 'a date to be announced'}, with analysts expecting earnings per share of $${typeof nextEarnings === 'object' && nextEarnings.eps_estimate ? parseFloat(nextEarnings.eps_estimate.toString()).toFixed(2) : 'N/A'}${typeof nextEarnings === 'object' && nextEarnings.eps_prior ? `, ${parseFloat(nextEarnings.eps_estimate?.toString() || '0') > parseFloat(nextEarnings.eps_prior.toString()) ? 'up from' : parseFloat(nextEarnings.eps_estimate?.toString() || '0') < parseFloat(nextEarnings.eps_prior.toString()) ? 'down from' : 'compared to'} $${parseFloat(nextEarnings.eps_prior.toString()).toFixed(2)} from the same quarter last year` : ''}${typeof nextEarnings === 'object' && nextEarnings && 'revenue_estimate' in nextEarnings && 'revenue_prior' in nextEarnings && nextEarnings.revenue_estimate && nextEarnings.revenue_prior ? ` and revenue of ${formatRevenue(nextEarnings.revenue_estimate as string | number | null)}${parseFloat((nextEarnings.revenue_estimate as string | number).toString()) > parseFloat((nextEarnings.revenue_prior as string | number).toString()) ? ', up from' : parseFloat((nextEarnings.revenue_estimate as string | number).toString()) < parseFloat((nextEarnings.revenue_prior as string | number).toString()) ? ', down from' : ', compared to'} ${formatRevenue(nextEarnings.revenue_prior as string | number | null)} from the same quarter last year` : ''}. ${data.companyName || data.symbol} has a consensus ${validatedConsensusRatings.consensus_rating ? validatedConsensusRatings.consensus_rating.charAt(0) + validatedConsensusRatings.consensus_rating.slice(1).toLowerCase() : 'N/A'} rating among analysts${validatedConsensusRatings.consensus_price_target ? ` with an average price target of $${parseFloat(validatedConsensusRatings.consensus_price_target.toString()).toFixed(2)}` : ''}, ${validatedConsensusRatings.buy_percentage && parseFloat(validatedConsensusRatings.buy_percentage.toString()) > 50 ? `reflecting a bullish outlook from the analyst community with ${parseFloat(validatedConsensusRatings.buy_percentage.toString()).toFixed(0)}% buy ratings.` : validatedConsensusRatings.hold_percentage && parseFloat(validatedConsensusRatings.hold_percentage.toString()) > 50 ? `reflecting a cautious stance with ${parseFloat(validatedConsensusRatings.hold_percentage.toString()).toFixed(0)}% hold ratings.` : 'as investors monitor the stock ahead of the earnings release.'}"
` : validatedConsensusRatings && peRatio !== null ? `
"${data.companyName || data.symbol} has a consensus ${validatedConsensusRatings.consensus_rating ? validatedConsensusRatings.consensus_rating.charAt(0) + validatedConsensusRatings.consensus_rating.slice(1).toLowerCase() : 'N/A'} rating among analysts${validatedConsensusRatings.consensus_price_target ? ` with an average price target of $${parseFloat(validatedConsensusRatings.consensus_price_target.toString()).toFixed(2)}` : ''}, which ${peRatio > 25 ? 'suggests the stock may be trading at a premium relative to analyst expectations' : peRatio < 15 ? 'suggests the stock may offer value relative to analyst expectations' : 'aligns with current valuation levels'}. ${validatedConsensusRatings.buy_percentage && parseFloat(validatedConsensusRatings.buy_percentage.toString()) > 50 ? `The analyst community is largely bullish, with ${parseFloat(validatedConsensusRatings.buy_percentage.toString()).toFixed(0)}% buy ratings, ` : validatedConsensusRatings.hold_percentage && parseFloat(validatedConsensusRatings.hold_percentage.toString()) > 50 ? `Analysts are cautious, with ${parseFloat(validatedConsensusRatings.hold_percentage.toString()).toFixed(0)}% hold ratings, ` : ''}${validatedConsensusRatings.total_analyst_count ? `with ${validatedConsensusRatings.total_analyst_count} analysts covering the stock.` : 'as investors evaluate the stock\'s prospects.'}"
` : nextEarnings && peRatio !== null ? `
"Investors are looking ahead to the company's next earnings report, scheduled for ${typeof nextEarnings === 'object' && nextEarnings.date ? formatEarningsDate(nextEarnings.date) : nextEarningsDate ? formatEarningsDate(nextEarningsDate) : 'a date to be announced'}, with analysts expecting earnings per share of $${typeof nextEarnings === 'object' && nextEarnings.eps_estimate ? parseFloat(nextEarnings.eps_estimate.toString()).toFixed(2) : 'N/A'}${typeof nextEarnings === 'object' && nextEarnings.eps_prior ? `, ${parseFloat(nextEarnings.eps_estimate?.toString() || '0') > parseFloat(nextEarnings.eps_prior.toString()) ? 'up from' : parseFloat(nextEarnings.eps_estimate?.toString() || '0') < parseFloat(nextEarnings.eps_prior.toString()) ? 'down from' : 'compared to'} $${parseFloat(nextEarnings.eps_prior.toString()).toFixed(2)} from the same quarter last year` : ''}${typeof nextEarnings === 'object' && nextEarnings && 'revenue_estimate' in nextEarnings && 'revenue_prior' in nextEarnings && nextEarnings.revenue_estimate && nextEarnings.revenue_prior ? ` and revenue of ${formatRevenue(nextEarnings.revenue_estimate as string | number | null)}${parseFloat((nextEarnings.revenue_estimate as string | number).toString()) > parseFloat((nextEarnings.revenue_prior as string | number).toString()) ? ', up from' : parseFloat((nextEarnings.revenue_estimate as string | number).toString()) < parseFloat((nextEarnings.revenue_prior as string | number).toString()) ? ', down from' : ', compared to'} ${formatRevenue(nextEarnings.revenue_prior as string | number | null)} from the same quarter last year` : ''}. At current levels, the P/E ratio of ${peRatio.toFixed(1)} ${peRatio > 25 ? 'suggests the stock may be overvalued relative to peers' : peRatio < 15 ? 'suggests the stock may offer value relative to peers' : 'suggests the stock is fairly valued relative to peers'}, which investors will be watching closely as earnings approach."
` : nextEarnings ? `
"Investors are looking ahead to the company's next earnings report, scheduled for ${typeof nextEarnings === 'object' && nextEarnings.date ? formatEarningsDate(nextEarnings.date) : nextEarningsDate ? formatEarningsDate(nextEarningsDate) : 'a date to be announced'}, ${typeof nextEarnings === 'object' && nextEarnings.eps_estimate ? `with analysts expecting earnings per share of $${parseFloat(nextEarnings.eps_estimate.toString()).toFixed(2)}${typeof nextEarnings === 'object' && nextEarnings.eps_prior ? `, ${parseFloat(nextEarnings.eps_estimate.toString()) > parseFloat(nextEarnings.eps_prior.toString()) ? 'up from' : parseFloat(nextEarnings.eps_estimate.toString()) < parseFloat(nextEarnings.eps_prior.toString()) ? 'down from' : 'compared to'} $${parseFloat(nextEarnings.eps_prior.toString()).toFixed(2)} from the same quarter last year` : ''}${typeof nextEarnings === 'object' && nextEarnings && 'revenue_estimate' in nextEarnings && 'revenue_prior' in nextEarnings && nextEarnings.revenue_estimate && nextEarnings.revenue_prior ? ` and revenue of ${formatRevenue(nextEarnings.revenue_estimate as string | number | null)}${parseFloat((nextEarnings.revenue_estimate as string | number).toString()) > parseFloat((nextEarnings.revenue_prior as string | number).toString()) ? ', up from' : parseFloat((nextEarnings.revenue_estimate as string | number).toString()) < parseFloat((nextEarnings.revenue_prior as string | number).toString()) ? ', down from' : ', compared to'} ${formatRevenue(nextEarnings.revenue_prior as string | number | null)} from the same quarter last year` : ''}.` : 'which will provide key insights into the company\'s financial performance and outlook.'}"
` : validatedConsensusRatings ? `
"${data.companyName || data.symbol} has a consensus ${validatedConsensusRatings.consensus_rating ? validatedConsensusRatings.consensus_rating.charAt(0) + validatedConsensusRatings.consensus_rating.slice(1).toLowerCase() : 'N/A'} rating among analysts${validatedConsensusRatings.consensus_price_target ? ` with an average price target of $${parseFloat(validatedConsensusRatings.consensus_price_target.toString()).toFixed(2)}` : ''}, ${validatedConsensusRatings.buy_percentage && parseFloat(validatedConsensusRatings.buy_percentage.toString()) > 50 ? `reflecting a bullish outlook from the analyst community with ${parseFloat(validatedConsensusRatings.buy_percentage.toString()).toFixed(0)}% buy ratings.` : validatedConsensusRatings.hold_percentage && parseFloat(validatedConsensusRatings.hold_percentage.toString()) > 50 ? `reflecting a cautious stance with ${parseFloat(validatedConsensusRatings.hold_percentage.toString()).toFixed(0)}% hold ratings.` : 'as analysts monitor the stock\'s performance.'} ${validatedConsensusRatings.total_analyst_count ? `${validatedConsensusRatings.total_analyst_count} analysts are currently covering the stock.` : ''}"
` : ''}
` : ''}

${newsContext && (newsContext.scrapedContent || (newsContext.selectedArticles && newsContext.selectedArticles.length > 0)) ? `
PRIMARY NEWS ARTICLE (LEAD WITH THIS):

${newsContext.scrapedContent ? `
Scraped Article URL: ${newsContext.newsUrl || 'N/A'}
Scraped Article Content (EXTRACT DETAILS FROM THIS):
${newsContext.scrapedContent.substring(0, 5000)}${newsContext.scrapedContent.length > 5000 ? '...' : ''}

CRITICAL: The article content above contains detailed information. You MUST extract and use specific numbers, figures, percentages, dates, metrics, analyst commentary, regional variations, product details, and other concrete facts from this content. Do NOT summarize - use the actual details.
` : ''}

${newsContext.selectedArticles && newsContext.selectedArticles.length > 0 && !newsContext.scrapedContent ? `
Primary Article (EXTRACT DETAILS FROM THIS):
Headline: ${newsContext.selectedArticles[0].headline}
Content: ${newsContext.selectedArticles[0].body?.substring(0, 5000) || ''}${newsContext.selectedArticles[0].body && newsContext.selectedArticles[0].body.length > 5000 ? '...' : ''}
URL: ${newsContext.selectedArticles[0].url || 'N/A'}

CRITICAL: The article content above contains detailed information. You MUST extract and use specific numbers, figures, percentages, dates, metrics, analyst commentary, regional variations, product details, and other concrete facts from this content. Do NOT summarize - use the actual details.
` : ''}

${newsContext.selectedArticles && newsContext.selectedArticles.length > 1 ? `
Additional Articles (for context only):
${newsContext.selectedArticles.slice(1).map((article: any, index: number) => `
Article ${index + 2}:
Headline: ${article.headline}
Content: ${article.body?.substring(0, 500) || ''}...
URL: ${article.url || 'N/A'}
`).join('\n')}` : ''}

CRITICAL INSTRUCTIONS FOR NEWS INTEGRATION:

1. LEAD THE STORY WITH PRICE ACTION: The first paragraph MUST start with the stock's current price move (direction and day of week, e.g., "shares closed up on Thursday" or "shares closed down on Monday"). ${marketStatus === 'premarket' ? `CRITICAL: Use the "Premarket Change" value provided above (${data.changePercent.toFixed(2)}%) to determine direction. If it's positive (>= 0), say "are up during premarket trading on [day]"; if it's negative (< 0), say "are down during premarket trading on [day]". You MUST include the phrase "during premarket trading" in the first sentence. The direction MUST match the sign of ${data.changePercent.toFixed(2)}% - ${data.changePercent >= 0 ? 'POSITIVE means UP' : 'NEGATIVE means DOWN'}. Example: "Apple Inc. (NASDAQ:AAPL) shares are ${data.changePercent >= 0 ? 'up' : 'down'} during premarket trading on Friday".` : `CRITICAL: Use the "Daily Change (REGULAR SESSION ONLY)" value provided above (${data.changePercent.toFixed(2)}%) to determine direction. If it's positive (>= 0), say "closed up" or "were up"; if it's negative (< 0), say "closed down" or "were down". The direction MUST match the sign of ${data.changePercent.toFixed(2)}% - ${data.changePercent >= 0 ? 'POSITIVE means UP' : 'NEGATIVE means DOWN'}. DO NOT make up your own direction - use ONLY the value provided.`} ${marketStatus === 'afterhours' ? 'CRITICAL: During after-hours, DO NOT include a specific closing price amount (e.g., do NOT write "closing at $22.18"). The "Current Price" shown above is the after-hours price, not the regular session closing price. Only mention the direction (up/down) and day - do NOT include any dollar amount or percentage. Example: "ZIM Integrated Shipping Services Ltd. (NYSE:ZIM) shares surged on Monday during regular trading" NOT "closing at $22.18" or "closing up 3.33%".' : ''} When mentioning the day, use ONLY the day name (e.g., "on Thursday", "on Monday") - DO NOT include the date (e.g., do NOT use "on Thursday, December 18, 2025" or any date format). ${isWeekend ? 'CRITICAL WEEKEND RULE: Today is a weekend (Saturday or Sunday). Markets are CLOSED on weekends. You MUST use PAST TENSE throughout BOTH sentences ("were down", "were up", "closed down", "closed up", "the move came", "stocks were lower", "the decline came") instead of present tense ("are down", "are up", "the move comes", "stocks are lower", "the decline comes"). Reference Friday as the last trading day.' : marketStatus === 'open' || marketStatus === 'premarket' ? 'Use present tense (e.g., "shares are tumbling", "shares are surging", "shares are up", "shares are down") since markets are currently open or in premarket.' : 'Use past tense (e.g., "shares closed up", "shares closed down", "shares were up", "shares were down") since markets are closed.'} CRITICAL WORD CHOICE: DO NOT use the word "amidst" anywhere in the lead paragraph - it's a clear AI writing pattern. Use natural alternatives like "as", "during", "on", or "following" instead. For example, use "The stock's decline came as" or "during a mixed market day" instead of "comes amidst" or "amidst a mixed market day". DO NOT include the percentage in the first paragraph - it's already in the price action section. Then reference the news article to explain what's going on - either the news is contributing to the move, OR the stock is moving despite positive/negative news (suggesting larger market elements may be at play). The angle should answer "What's Going On" by connecting the price action to the news context.

2. HYPERLINK FORMATTING (MANDATORY - MUST BE IN FIRST PARAGRAPH):
   ${primaryUrl ? (isBenzinga ? `- This is a Benzinga article. You MUST include a hyperlink in the first paragraph by choosing ANY THREE CONSECUTIVE WORDS from your first paragraph and wrapping them in a hyperlink with format: <a href="${primaryUrl}">[three consecutive words]</a>
   - The hyperlink should be embedded naturally within the sentence flow - do NOT use phrases like "as detailed in a recent article" or "according to reports" to introduce it
   - Simply select three consecutive words that are part of the natural sentence structure and hyperlink them
   - Example: "Apple Inc. (AAPL) shares closed up on Thursday as the company is <a href="${primaryUrl}">reportedly deepening its</a> India strategy" or "The stock moved higher amid <a href="${primaryUrl}">signs of resilient</a> iPhone demand"
   - The three words should flow naturally - they don't need to explicitly mention "article" or "report"
   - CRITICAL: The hyperlink MUST appear in the first paragraph - this is mandatory, not optional
   - THE URL TO USE IS: ${primaryUrl}` : `- This is NOT a Benzinga article (${outletName || 'external source'}). You MUST include a ONE-WORD hyperlink with outlet credit in the first paragraph.
   - Format: <a href="${primaryUrl}">${outletName || 'Source'}</a> reports
   - Example: <a href="${primaryUrl}">CNBC</a> reports or <a href="${primaryUrl}">Reuters</a> reports
   - Extract the outlet name from the URL domain and capitalize it properly (e.g., "cnbc.com" → "CNBC", "reuters.com" → "Reuters", "bloomberg.com" → "Bloomberg")
   - CRITICAL: The hyperlink MUST appear in the first paragraph - this is mandatory, not optional
   - THE URL TO USE IS: ${primaryUrl}`) : `- CRITICAL: No source URL was provided, so no hyperlink is required in this case.`}

3. The hyperlink MUST appear in the FIRST paragraph of the story, integrated naturally into the text flow without calling attention to the fact that it links to an article. Do NOT use phrases like "as detailed in a recent article", "according to reports", or "as highlighted in" - just hyperlink three consecutive words naturally within the sentence. This is MANDATORY - the first paragraph must contain a hyperlink to the source article.

4. SECOND PARAGRAPH WITH SUBSTANTIVE NEWS DETAILS (MANDATORY): The second paragraph MUST provide detailed, specific information from the news source article. This is CRITICAL - do NOT just summarize. Focus on the first set of key details such as:
   - Analyst ratings, price targets, or specific analyst commentary if mentioned
   - Primary metrics, numbers, figures, or percentages (e.g., "iPhone 17 lead times have increased to around five days, up from three days a year ago")
   - Key comparative data or timeframes
   
   The goal is to give readers concrete, actionable details from the source article - not vague generalities. This paragraph should be 2 sentences and contain substantive details. Do NOT try to pack everything into this paragraph - save additional details for the third paragraph.

5. THIRD PARAGRAPH WITH ADDITIONAL NEWS DETAILS (MANDATORY): The third paragraph MUST continue extracting detailed, specific information from the news source article. Include additional specifics such as:
   - Regional variations or geographic specifics (e.g., "In the U.S., lead times for the iPhone 17 have reached eight days")
   - Product-specific details, model variations, or technical specifications (e.g., "base-model lead times exceeding one week")
   - Additional metrics, comparative data, or year-over-year comparisons
   - Any other concrete facts that provide depth and context
   
   This paragraph should also be 2 sentences and contain substantive details that complement the second paragraph. Together, paragraphs 2 and 3 should provide comprehensive coverage of the article's key details.

6. After the lead paragraph (teaser), "Also Read" section, section marker, and two news content paragraphs (paragraphs 2 and 3, where paragraph 2 contains the specific details like analyst names and price targets), and the broader market/sector paragraph (paragraph 4, if applicable), naturally transition to the technical analysis data provided above.

6. Maximum 2 sentences per paragraph throughout the story.

7. SECTION MARKERS (MANDATORY): You MUST insert section markers between major logical blocks. Format: "## Section: [Label]" on its own line. Required markers:
   ${newsContext && (newsContext.scrapedContent || (newsContext.selectedArticles && newsContext.selectedArticles.length > 0)) ? '- "## Section: The Catalyst" - after the "Also Read" section (which appears after the first paragraph), before the detailed news paragraphs (Paragraph 2 with specific details)' : ''}
   - "## Section: Technical Analysis" - after news paragraphs${!newsContext || (!newsContext.scrapedContent && (!newsContext.selectedArticles || newsContext.selectedArticles.length === 0)) ? ' (or after lead paragraph if no news)' : ''}, before technical data
   ${data.description && data.description !== 'N/A' ? '- "## Section: Company Context" - after "## Section: Technical Analysis", before "## Section: Earnings & Analyst Outlook" (or before "## Section: Benzinga Edge Rankings" or "## Section: Price Action" if those come next). Use this section to explain why this company matters and provide context about its business model and market position.' : ''}
   - "## Section: Analyst Ratings" - only if Analyst Overview is included
   - "## Section: Price Action" immediately before the automatically-generated price action line (do NOT write any content in this section - just place the marker)
   Use these EXACT labels - do not skip them.` : ''}

7. COMPANY TICKER FORMATTING: When mentioning OTHER companies (not the primary stock being analyzed), you MUST include their ticker symbol with exchange in parentheses immediately after the company name. Format: "Company Name (EXCHANGE:TICKER)". Examples:
   - "Snowflake Inc. (NYSE:SNOW)" not just "Snowflake Inc."
   - "Microsoft Corp. (NASDAQ:MSFT)" not just "Microsoft Corp."
   - "Apple Inc. (NASDAQ:AAPL)" not just "Apple Inc."
   - Only the PRIMARY stock (${data.symbol}) should use the format: "**Company Name** (EXCHANGE:TICKER)" with bold formatting
   - All OTHER companies should use: "Company Name (EXCHANGE:TICKER)" without bold
   - If you're unsure of a company's ticker, try to infer it from the article content or use the most common ticker for that company
   - Common examples: Alphabet/Google (NASDAQ:GOOGL), Microsoft (NASDAQ:MSFT), Apple (NASDAQ:AAPL), Amazon (NASDAQ:AMZN), Meta (NASDAQ:META), Tesla (NASDAQ:TSLA), Nvidia (NASDAQ:NVDA), Snowflake (NYSE:SNOW), Oracle (NYSE:ORCL), IBM (NYSE:IBM), Salesforce (NYSE:CRM)

${data.description && data.description !== 'N/A' ? `
*** MANDATORY COMPANY CONTEXT SECTION ***

COMPANY DESCRIPTION (You MUST use this in the "## Section: Company Context" section):
${data.description}

CRITICAL REQUIREMENT: You MUST include a "## Section: Company Context" section in your output. This is NOT optional. Place it AFTER "## Section: Technical Analysis" and BEFORE "## Section: Earnings & Analyst Outlook" (or before "## Section: Benzinga Edge Rankings" if that section exists, or before "## Section: Price Action" if no earnings/analyst section exists).

This section MUST:
- Start with the exact section marker: "## Section: Company Context"
- Use the company description provided above to explain what ${data.companyName || data.symbol} does and why it matters
- Explain why this company matters${newsContext && (newsContext.scrapedContent || (newsContext.selectedArticles && newsContext.selectedArticles.length > 0)) ? ' in the context of the news/article' : ' and provide context about its business'}
- Be written in plain text (NO HTML tags like <p> or </p>)
- Be written in a conversational, accessible style
- Help readers understand the company's significance and business context after reviewing the technical analysis
- If the description is long (4+ sentences), split it into 2-3 paragraphs for better readability, with each paragraph containing 2-3 sentences

REQUIRED FORMAT (plain text, no HTML):
## Section: Company Context

[Use the description above to explain what ${data.companyName || data.symbol} does]. ${newsContext && (newsContext.scrapedContent || (newsContext.selectedArticles && newsContext.selectedArticles.length > 0)) ? '[Connect to why this matters for the current news/price action].' : '[Explain why this company is relevant in the current market context].'} [Additional context about market position or relevance].

If the description is long, format as multiple paragraphs:
## Section: Company Context

[First paragraph: 2-3 sentences about what the company does and its core business model.]

[Second paragraph: 2-3 sentences about market position, licensing model, or other relevant context.]

DO NOT SKIP THIS SECTION. It is mandatory when company description is provided.

` : ''}

TASK: ${newsContext && (newsContext.scrapedContent || (newsContext.selectedArticles && newsContext.selectedArticles.length > 0)) ? `Write a conversational WGO article that helps readers understand "What's Going On" with the stock. LEAD with the current price move (direction and day of week, e.g., "shares are tumbling on Monday" or "shares are surging on Tuesday"). Use ONLY the day name (e.g., "on Thursday", "on Monday") - DO NOT include the date (e.g., do NOT use "on Thursday, December 18, 2025" or any date format). DO NOT include the percentage in the first paragraph. Then reference the news article provided above AND broader market context to explain what's going on - either the news is contributing to the move, OR the stock is moving despite positive/negative news (suggesting larger market elements may be at play). ${marketContext ? 'Use the broader market context (indices, sectors, market breadth) to provide additional context - is the stock moving with or against broader market trends? Reference specific sector performance when relevant (e.g., "Technology stocks are broadly lower today, contributing to the decline" or "Despite a strong market day, the stock is down, suggesting company-specific concerns").' : ''} Include the appropriate hyperlink in the first paragraph (three-word for Benzinga, one-word with outlet credit for others). When mentioning other companies in the article, always include their ticker symbol with exchange (e.g., "Snowflake Inc. (NYSE:SNOW)").

MANDATORY: You MUST include section markers in your output. ${newsContext && (newsContext.scrapedContent || (newsContext.selectedArticles && newsContext.selectedArticles.length > 0)) ? 'Insert "## Section: The Catalyst" AFTER the "Also Read" section (which comes after the FIRST paragraph)' : ''}, "## Section: Technical Analysis" after news paragraphs${!newsContext || (!newsContext.scrapedContent && (!newsContext.selectedArticles || newsContext.selectedArticles.length === 0)) ? ' (or after lead paragraph if no news)' : ''}${data.description && data.description !== 'N/A' ? ', "## Section: Company Context" after "## Section: Technical Analysis"' : ''}, "## Section: Earnings & Analyst Outlook" if earnings or analyst data is available (MANDATORY if consensus ratings or earnings date data is provided)${edgeRatings ? ', "## Section: Benzinga Edge Rankings" after the Earnings & Analyst Outlook section' : ''}, and "## Section: Price Action" immediately before the automatically-generated price action line at the end. CRITICAL: Do NOT write any paragraph or content in the "## Section: Price Action" section - the price action line is automatically generated and added after your article. Just place the section marker "## Section: Price Action" and end your article there. These section markers are REQUIRED - do not skip them.

CRITICAL: The second paragraph (which appears AFTER "## Section: The Catalyst") and optionally third paragraph MUST include detailed, specific information from the news source article. Do NOT just summarize or use vague language. Extract and include:
- Specific numbers, figures, percentages, dates, or metrics from the article
- Analyst ratings, price targets, or specific analyst commentary
- Regional variations or geographic specifics
- Product details, model names, or technical specifications
- Timeframes or comparative data
- Key quotes or notable statements

Use concrete facts and data points from the source article. For example, instead of "delivery times have increased", use "delivery lead times now run around five days, up from three days a year ago" or "In the U.S., lead times reached eight days for the iPhone 17 and four days for the Air." Include as much specific detail as possible while keeping paragraphs concise (2-3 sentences each).

After the lead paragraph (teaser), "Also Read" section, section marker, and two news content paragraphs (paragraphs 2 and 3, where paragraph 2 contains the specific details like analyst names and price targets), and the broader market/sector paragraph (paragraph 4, if applicable), transition to technical analysis focusing on longer-term trends (12-month). Then include the analyst overview section (if consensus data is available) and P/E ratio section (if P/E data is available) after the technical analysis.` : `Write a conversational WGO article that helps readers understand "What's Going On" with the stock. LEAD with the current price move and note that there's no company-specific news driving the move. ${marketContext ? 'Then use broader market context (indices, sectors, market breadth) to explain the move - is the stock moving with or against broader market trends? Reference specific sector performance when relevant. For example, if the stock is down but the broader market/sector is up, note that the stock is underperforming despite positive market conditions. If the stock is down and the broader market/sector is also down, note that the stock is caught in a broader sell-off (e.g., "Technology stocks are broadly lower today, contributing to the decline").' : ''} Then use technical indicators (moving averages, RSI, MACD, support/resistance) to create a narrative that explains what's happening and why traders are seeing this price action. Focus on using technical data to tell the story - what do the charts reveal about the stock's current situation? After the technical analysis section, include the analyst overview section (if consensus data is available) and P/E ratio section (if P/E data is available).`}

*** CRITICAL STRUCTURAL UPDATE: THE "SPLIT LEDE" ***

You must strictly follow this paragraph order to ensure SEO headers capture the main news:

1. **Paragraph 1 (The Teaser):** State that the stock is moving and briefly mention the *general* reason (e.g., "following a bullish analyst report" or "after Q3 earnings"). Do NOT give the specific numbers (Price Targets, EPS) here. Do NOT mention analyst names or firm names here. Include the Market Context (indices/sector) here if applicable.

2. **The "Also Read" Link:** Insert the provided "Also Read" hyperlink immediately after Paragraph 1.

3. **HEADER MARKER:** Insert ## Section: The Catalyst right here.

4. **Paragraph 2 (The Meat):** NOW provide the specific high-value details. This is where you write "Needham raised the target to $90" or "Revenue hit $50M." Include analyst names, firm names, price targets, specific numbers, and other key metrics here. This ensures the header sits directly above the key data.

5. **Paragraph 3 (Context):** Additional details (background info, secondary news, context).

*** MANDATORY: SECTION MARKERS (REQUIRED IN ALL ARTICLES) ***
You MUST insert GENERIC SECTION HEADERS between the major logical blocks of the story. This is MANDATORY - every article must include these section markers.

Rules for Headers:
1. Format: Use "## Section: [Label]" (markdown H2 format)
2. Placement (MANDATORY):
   - Insert "## Section: The Catalyst" AFTER the "Also Read" section (which appears after the first paragraph) and BEFORE the detailed news paragraphs (Paragraph 2 with the specific details).
   - Insert "## Section: Technical Analysis" immediately after the news paragraphs and BEFORE the transition to technical data.
   - Insert "## Section: Earnings & Analyst Outlook" AFTER "## Section: Technical Analysis" if earnings data or analyst consensus ratings are available (this is MANDATORY when earnings/analyst data is provided).
   ${edgeRatings ? '- Insert "## Section: Benzinga Edge Rankings" AFTER "## Section: Earnings & Analyst Outlook" and BEFORE "## Section: Price Action".' : ''}
   - Insert "## Section: Price Action" immediately before the automatically-generated price action line at the end of the article. CRITICAL: Do NOT write any paragraph or content in this section - just place the section marker. The price action line is automatically generated and will be added after your article ends.

CRITICAL: 
- Do not try to write creative headers. Use these EXACT generic labels.
- These section markers are REQUIRED - do not skip them.
- The logic of your paragraph flow (Lead Teaser -> Also Read -> Section Marker -> Detailed News -> Technicals) remains unchanged; you are simply placing these markers between the blocks.
- Each section marker should be on its own line with proper spacing before and after.

Weave data points naturally into your analysis rather than listing them. Write like you're explaining the stock's technical picture to a colleague - clear, direct, and engaging. When relevant, mention key turning points and when they occurred to provide context for the current technical setup. Think like a trader: prioritize actionable insights and key technical signals over routine price updates.


CRITICAL RULES - PARAGRAPH LENGTH IS MANDATORY:

- NEWS PARAGRAPHS (second and third paragraphs when news is present): Can be 2-3 sentences to accommodate detailed information extraction from the source article.

- TECHNICAL ANALYSIS AND OTHER PARAGRAPHS: Must be 2 sentences or less. If you find yourself writing a third sentence, start a new paragraph instead.

- COMPANY TICKER FORMATTING - MANDATORY: When mentioning OTHER companies (not the primary stock ${data.symbol}), you MUST include their ticker symbol with exchange in parentheses. Format: "Company Name (EXCHANGE:TICKER)". Examples: "Snowflake Inc. (NYSE:SNOW)", "Microsoft Corp. (NASDAQ:MSFT)", "Apple Inc. (NASDAQ:AAPL)". Only the PRIMARY stock uses bold formatting: "**Company Name** (EXCHANGE:TICKER)". All OTHER companies use regular formatting: "Company Name (EXCHANGE:TICKER)".

- Write in a CONVERSATIONAL, DIRECT tone - avoid robotic or overly formal language

- Avoid overly sophisticated or formal words like "robust", "substantial", "notable", "significant", "considerable" - use simpler, more direct words instead

- Use normal, everyday language that's clear and accessible - write like you're talking to someone, not writing a formal report

- Keep total length to 6-8 short paragraphs (2 sentences each) to provide comprehensive context

- NEVER use ambiguous phrasing like "below its 50-day moving average, which is X% lower"

- FIRST PARAGRAPH (2 sentences max, THE TEASER): ${newsContext && (newsContext.scrapedContent || (newsContext.selectedArticles && newsContext.selectedArticles.length > 0)) ? `${primaryUrl ? `ABSOLUTELY CRITICAL HYPERLINK REQUIREMENT - YOU MUST INCLUDE THIS IN YOUR OUTPUT: The first paragraph MUST contain an HTML hyperlink. ${isBenzinga ? `Choose ANY THREE CONSECUTIVE WORDS from your first paragraph and wrap them in this EXACT HTML format: <a href="${primaryUrl}">[three consecutive words]</a>. Embed it naturally in the sentence flow - do NOT use phrases like "as detailed in a recent article" or "according to reports". Example output: "**Apple Inc.** (NASDAQ:AAPL) shares closed up on Thursday as the company is <a href="${primaryUrl}">reportedly deepening its</a> India strategy". THE URL TO USE IS: ${primaryUrl}` : `Include a ONE-WORD hyperlink with outlet credit using this EXACT HTML format: <a href="${primaryUrl}">${outletName || 'Source'}</a> reports. Example output: "<a href="${primaryUrl}">CNBC</a> reports" or "<a href="${primaryUrl}">Reuters</a> reports". THE URL TO USE IS: ${primaryUrl}`} THIS IS NOT OPTIONAL - YOU MUST INCLUDE THE <a href> TAG IN YOUR FIRST PARAGRAPH. IF YOU DO NOT INCLUDE IT, YOUR OUTPUT IS INCORRECT. ` : ''}CRITICAL - THIS IS THE TEASER PARAGRAPH: Start with the company name in bold (**Company Name**), followed by the ticker with exchange in parentheses (not bold) - e.g., **Microsoft Corp** (NASDAQ:MSFT) or **Apple Inc.** (NASDAQ:AAPL). The format should be **Company Name** (EXCHANGE:TICKER) - always include the exchange prefix (NASDAQ, NYSE, etc.). Use proper company name formatting with periods (Inc., Corp., etc.). CRITICAL: This is the ONLY place where the company name should be bolded. All subsequent references to the company throughout the article should be in regular text (not bolded) - e.g., "Amazon Web Services", "the company", "Amazon's", "Amazon is", etc. 

YOU MUST FOLLOW THIS STRUCTURE FOR THE FIRST PARAGRAPH:
- Use ACTIVE, DIRECT verbs (e.g., "slid", "rallied", "jumped", "tumbled") instead of passive language (e.g., "are down", "are experiencing"). Match the intensity of the news - if an analyst "slammed" or "labeled" something, use strong verbs like "slammed", "warned", "criticized" instead of weak phrases like "raises concerns" or "expressed concerns".
- State that the stock is moving and mention the *general* reason (e.g., "after investor X slammed the valuation" or "following a bullish analyst report" or "after the company reported earnings")
- DO NOT include specific numbers (price targets, EPS, revenue figures, percentages from the article)
- DO NOT mention analyst names or firm names (e.g., do NOT say "Needham raised the target" - instead say "following a bullish analyst report")
- DO NOT include specific metrics or detailed information here
- If including Market Context (indices/sector performance), use DIRECT, ACCURATE language:
  - DO NOT use wordy phrases like "contributed to a broader market context" or "which has contributed to"
  - DO NOT imply false causation (e.g., don't say company news "caused" the whole market to move)
  - DO use phrases like "adding pressure as broader markets edged lower" or "while the Nasdaq slid 0.11%" or "as the S&P 500 fell" - this accurately describes the relationship without implying causation
  - Keep it concise and active: "as broader markets edged lower" or "while major indices slid" - no need for "broader market context" fluff
- When mentioning the day, use ONLY the day name (e.g., "on Wednesday", "on Monday") - DO NOT include "on" before the day when using premarket/after-hours (e.g., "in premarket trading Wednesday" not "in premarket trading on Wednesday")
- ${primaryUrl ? 'Include the hyperlink as specified above' : ''}

Example of CORRECT first paragraph (active, direct): "**Rocket Lab Corporation** (NASDAQ:RKLB) shares rallied on Tuesday as the company carved out status as a serious rival to SpaceX. The stock gained ground while the Nasdaq slid 0.11%."

Example of CORRECT first paragraph (strong verbs, accurate context): "**Tesla, Inc.** (NASDAQ:TSLA) shares slid in premarket trading Wednesday after investor Michael Burry slammed the company's valuation. Burry labeled the stock 'ridiculously overvalued' citing decelerating sales momentum, adding pressure to shares as broader markets edged lower."

Example of INCORRECT first paragraph (DO NOT DO THIS): "**Rocket Lab Corporation** (NASDAQ:RKLB) shares are up on Tuesday as Needham analyst Ryan Koontz reiterated a Buy rating and raised the price target from $63 to $90." This is WRONG because it includes specific analyst name, firm name, and price targets in the first paragraph.` : `Start with the company name in bold (**Company Name**), followed by the ticker with exchange in parentheses (not bold) - e.g., **Apple Inc.** (NASDAQ:AAPL) or **Applied Digital Corp.** (NASDAQ:APLD). The format should be **Company Name** (EXCHANGE:TICKER) - always include the exchange prefix (NASDAQ, NYSE, etc.). Use proper company name formatting with periods (Inc., Corp., etc.). CRITICAL: This is the ONLY place where the company name should be bolded. All subsequent references to the company throughout the article should be in regular text (not bolded) - e.g., "the company", "Apple's", "Apple is", etc. LEAD with the current price move direction using the Daily Change data provided - note ONLY the direction and day of week (e.g., "shares are tumbling on Monday" if down, "shares are surging on Tuesday" if up). Use ONLY the day name (e.g., "on Thursday", "on Monday") - DO NOT include the date. DO NOT include the percentage in the first paragraph - it's already in the price action section. ${marketContext ? 'Then IMMEDIATELY reference broader market context to explain the move - is the stock moving with or against broader market trends? Reference specific sector performance when relevant (e.g., "The move comes as Technology stocks are broadly lower today, contributing to the decline" or "Despite a strong market day with the S&P 500 up 0.5%, the stock is down, suggesting company-specific concerns" or "The stock is caught in a broader sell-off, with the Nasdaq down 1.2% and Technology sector declining 1.5%").' : 'Then immediately pivot to the technical analysis context - use moving average positioning, support/resistance levels, or key technical signals to explain what traders are seeing on the charts (e.g., "Traders are focused on the technical picture, which shows the stock is currently testing key support levels while facing mixed signals from moving averages" or "The move comes as the stock flashes a \'mixed\' signal—breaking down in the short term while testing a crucial long-term floor").'} Focus on using market context and technical indicators to add context to the move rather than declaring there's no news. STOP AFTER 2 SENTENCES.`}

- THE "ALSO READ" SECTION: After the first paragraph, insert the "Also Read" hyperlink section if provided. This comes BEFORE the section marker.

- SECTION MARKER: Immediately after the "Also Read" section, insert ## Section: The Catalyst on its own line.

- SECOND PARAGRAPH (2 sentences, THE MEAT - SPECIFIC DETAILS): ${newsContext && (newsContext.scrapedContent || (newsContext.selectedArticles && newsContext.selectedArticles.length > 0)) ? `CRITICAL - THIS IS WHERE THE SPECIFIC DETAILS GO: This paragraph appears AFTER "## Section: The Catalyst" and contains the high-value, specific information. MANDATORY: Provide detailed, specific information from the news source article. This is where you include:
  * Analyst names, firm names, price targets (e.g., "Needham analyst Ryan Koontz reiterated a Buy rating and raised the price target from $63 to $90")
  * Specific numbers, figures, percentages, dates, or metrics from the article (e.g., "Revenue hit $50M" or "iPhone 17 lead times have increased to around five days, up from three days a year ago")
  * Primary metrics, numbers, figures, or percentages
  * Key comparative data or timeframes
  
  Do NOT use vague phrases like "reports suggest" or "according to analysts" - use the specific data points, numbers, and details from the article. Extract concrete facts. This paragraph should be exactly 2 sentences with specific information. This ensures the section header sits directly above the key data that SEO agents will use to generate headlines.` : ''}

- THIRD PARAGRAPH (2 sentences, SUBSTANTIVE NEWS DETAILS - PART 2): ${newsContext && (newsContext.scrapedContent || (newsContext.selectedArticles && newsContext.selectedArticles.length > 0)) ? `MANDATORY: Continue extracting detailed, specific information from the news source article. Include additional specifics such as:
  * Regional variations or geographic specifics (e.g., "In the U.S., lead times for the iPhone 17 have reached eight days")
  * Product-specific details, model variations, or technical specifications (e.g., "base-model lead times exceeding one week")
  * Additional metrics, comparative data, or year-over-year comparisons (e.g., "This increase in lead times contrasts with the flat lead times for the iPhone 16 during the same period last year")
  
  Focus on specifics - numbers, regional variations, model-specific details, or other concrete facts that complement the second paragraph. This paragraph should also be exactly 2 sentences. Together, paragraphs 2 and 3 should provide comprehensive coverage of the article's key details.` : ''}

- FOURTH PARAGRAPH (2 sentences, BROADER MARKET AND SECTOR CONTEXT): ${newsContext && (newsContext.scrapedContent || (newsContext.selectedArticles && newsContext.selectedArticles.length > 0)) && marketContext ? `MANDATORY: Include a paragraph about broader market movement and sector performance as a neutral comparison. ${marketStatus === 'premarket' ? 'CRITICAL: During premarket, the market context data provided is from the PREVIOUS TRADING DAY (markets are not yet open). Use PAST TENSE to describe the previous trading day\'s performance (e.g., "the broader market experienced", "the Technology sector gained", "the S&P 500 closed up on the previous trading day"). Reference it as "on the previous trading day" or "yesterday" to make it clear this is historical data.' : marketStatus === 'open' ? 'Use PRESENT TENSE to describe current market activity (e.g., "the broader market is experiencing", "the Technology sector is gaining", "the S&P 500 is up").' : marketStatus === 'afterhours' ? 'Use PAST TENSE to describe the trading day\'s performance (e.g., "the broader market experienced", "the Technology sector gained", "the S&P 500 closed up"). Reference the trading day that just ended.' : 'Use PAST TENSE to describe the trading day\'s performance (e.g., "the broader market experienced", "the Technology sector gained", "the S&P 500 closed up"). Reference the most recent trading day.'} 
  
  CRITICAL: This is a FACTUAL COMPARISON only - do NOT imply any logical relationship or contradiction between the news content and market performance. Do NOT use words like "Despite", "However", "Meanwhile", "In contrast", or start with "On the trading day" (which creates an awkward transition). The news is company-specific and has no relationship to broader market movement.
  
  Start with a smooth transition that flows naturally from the previous paragraph. Simply state:
  * The broader market ${marketStatus === 'premarket' ? 'performance on the previous trading day' : marketStatus === 'open' ? 'performance' : 'performance'} (e.g., ${marketStatus === 'premarket' ? '"The broader market saw gains on the previous trading day, with the Technology sector rising 1.47%"' : marketStatus === 'open' ? '"The broader market saw gains, with the Technology sector up 1.47% today"' : '"The broader market saw gains, with the Technology sector rising 1.47% on the trading day"'})
  * How the stock ${marketStatus === 'premarket' ? 'performed' : marketStatus === 'open' ? 'is performing' : 'performed'} relative to that (e.g., ${marketStatus === 'premarket' ? '"AAPL\'s decline came as the broader sector moved higher on the previous trading day, indicating company-specific factors may have been at play"' : marketStatus === 'open' ? '"AAPL\'s decline came as the broader sector moved higher, indicating company-specific factors may be at play"' : '"AAPL\'s decline came as the broader sector moved higher, indicating company-specific factors may have been at play"'})
  
  Use the actual percentage changes from the market context data provided. This paragraph should be exactly 2 sentences. CRITICAL: ${marketStatus === 'premarket' ? 'During premarket, use PAST TENSE since the market data is from the previous trading day. Reference it as "on the previous trading day" or "yesterday".' : marketStatus === 'open' ? 'Use PRESENT TENSE since markets are currently open.' : 'Use PAST TENSE since markets are closed.'} Use smooth transitions like "The broader market saw..." or "Meanwhile, broader market indicators..." rather than awkward phrases like "On the trading day".` : ''}

- TECHNICAL ANALYSIS PARAGRAPH 1 (MOVING AVERAGES, 12-MONTH PERFORMANCE, 52-WEEK RANGE): Write a single paragraph that combines: (1) Stock position relative to 20-day and 100-day SMAs with exact percentages (e.g., "Apple stock is currently trading 2.3% below its 20-day simple moving average (SMA), but is X% above its 100-day SMA, demonstrating longer-term strength"), (2) 12-month performance (e.g., "Shares have increased/decreased X% over the past 12 months"), and (3) 52-week range position (e.g., "and are currently positioned closer to their 52-week highs than lows" or "closer to their 52-week lows than highs" - DO NOT include a percentage, just use qualitative positioning). Keep this to 2-3 sentences maximum. STOP AFTER THIS PARAGRAPH.

- TECHNICAL ANALYSIS PARAGRAPH 2 (RSI AND MACD): Write a single paragraph that combines: (1) RSI level and interpretation (e.g., "The RSI is at 44.45, which is considered neutral territory"), and (2) MACD status (e.g., "Meanwhile, MACD is below its signal line, indicating bearish pressure on the stock"). Keep this to 2 sentences maximum. STOP AFTER THIS PARAGRAPH.

- TECHNICAL ANALYSIS PARAGRAPH 3 (RSI/MACD SUMMARY): Write a single sentence that summarizes the RSI and MACD signals using this logic:
  * RSI < 30 + bullish MACD = "bullish momentum" (oversold with bullish MACD)
  * RSI 30-50 + bullish MACD = "momentum leaning bullish" (NOT "mixed" - this is bullish)
  * RSI >= 50 + bullish MACD = "mixed momentum" (neutral/bullish mix)
  * RSI > 70 + bearish MACD = "bearish momentum" (overbought with bearish MACD)
  * RSI 50-70 + bearish MACD = "momentum leaning bearish" (NOT "mixed" - this is bearish)
  * RSI < 50 + bearish MACD = "mixed momentum" (neutral/bearish mix)
  
  Examples:
  - "The combination of oversold RSI (below 30) and bullish MACD suggests bullish momentum"
  - "RSI in the 30-50 range with bullish MACD indicates momentum leaning bullish"
  - "The combination of neutral RSI (around 50) and bullish MACD suggests mixed momentum"
  - "RSI in the 50-70 range with bearish MACD indicates momentum leaning bearish, but nearing overbought territory"
  
  Keep this to 1 sentence maximum. STOP AFTER THIS PARAGRAPH.

- KEY LEVELS (MANDATORY): After paragraph 3, you MUST extract and display the key support and resistance levels in a clear, scannable format. Format as bullet points using HTML <ul> and <li> tags:
<ul>
<li><strong>Key Resistance</strong>: $XXX.XX</li>
<li><strong>Key Support</strong>: $XXX.XX</li>
</ul>
These should be clearly labeled, rounded to the nearest $0.50, and formatted as bullet points. This format helps with SEO and Featured Snippets.

CRITICAL: After these technical analysis paragraphs, move directly to any additional content (analyst ratings/earnings section if applicable) and then end with the "## Section: Price Action" marker. Do NOT write any paragraph or content in the Price Action section - just place the section marker. The price action line is automatically generated and added after your article. Do NOT add more technical analysis paragraphs beyond these three.

${!newsContext || (!newsContext.scrapedContent && (!newsContext.selectedArticles || newsContext.selectedArticles.length === 0)) ? `- CRITICAL FOR NO-NEWS ARTICLES: Always mention the day of week (Monday, Tuesday, etc.) when describing the price move in the first paragraph. Use phrases like "shares are tumbling Monday" or "shares are surging Tuesday" to anchor the move in time. DO NOT include the percentage change in the first paragraph - it's already provided in the price action section at the bottom.

${marketContext ? `- MANDATORY: You MUST reference broader market context in the first paragraph to explain the stock's move. Use the market context data provided above (indices, sectors, market breadth) to explain whether the stock is moving with or against broader market trends. Examples:
  * If stock is down and market/sector is down: "The stock is caught in a broader sell-off, with the Nasdaq down 1.2% and Technology sector declining 1.5%"
  * If stock is down but market/sector is up: "Despite a strong market day with the S&P 500 up 0.5%, the stock is down, suggesting company-specific concerns"
  * If stock is up and market/sector is up: "The stock is moving with broader market trends, as the S&P 500 gains 0.8% and Technology sector advances 1.2%"
  * Reference specific sector performance when the stock's sector is available in the market context data
  * Use actual percentage changes from the market context data provided` : ''}

- DO NOT explicitly state "there's no company-specific news" or "with no specific company news driving the move" - instead, immediately pivot to market context and technical analysis context. Use phrases like "The move comes as..." or "Traders are seeing..." to transition from price direction to market/technical context.

- Use specific percentages for moving averages to create a clear technical picture. Include exact percentages like "9.3% below its 20-day SMA" or "4.6% above its 100-day SMA" to show precise positioning relative to key levels.

- Create a narrative that explains "What's Going On" - use technical indicators to tell the story of why the stock is moving. For example, if a stock is down but RSI is neutral and MACD is above signal line, explain that momentum indicators show "hidden strength" despite the sell-off.

- Use descriptive phrases that paint a picture: "flashing a 'mixed' signal", "testing a crucial long-term floor", "facing mixed signals from moving averages", "acting as the key line in the sand for bulls". These help readers understand the technical story.

- When discussing moving averages, explain what they mean in context - if a stock is below short-term MAs but above long-term MAs, explain that "the longer-term uptrend remains technically intact" or similar narrative framing.` : ''}

- DON'T overwhelm with numbers - use key numbers strategically to support your analysis, not as the main focus

- Provide CONTEXT and EXPLANATION - explain what the numbers mean and why they matter, rather than just listing percentages

- NATURALLY weave data points into sentences with context (e.g., "The stock is up 14.92% this week, reflecting strong short-term momentum" not just "Weekly performance: 14.92%")

- Focus on LONGER-TERM trends and patterns, not daily fluctuations

- After RSI, MACD, support/resistance, and golden/death cross discussion, discuss the 12-month performance in a dedicated paragraph and provide context about what it reveals about the longer-term trend - but keep each paragraph to 2 sentences max

- DO NOT mention 12-month performance in the first paragraph - save it for later in the analysis

- DO NOT mention weekly, monthly, 3-month, or 6-month performance - only use 12-month return

- DO NOT repeat the 12-month performance multiple times - mention it once in a dedicated paragraph

- DO NOT repeat support and resistance levels after mentioning them in the second paragraph - they should only appear once

- Discuss moving average relationships naturally - explain what they mean for the stock's trend and what traders should watch for, not just list percentages

- CRITICAL: When price is ABOVE a moving average, that's BULLISH (positive). When price is BELOW a moving average, that's BEARISH (negative). If a stock is trading above its 20-day, 50-day, and 100-day SMAs, that indicates strength, not weakness. Only describe it as "struggling" if the stock is below key moving averages.

- Be precise with moving average interpretation: ALWAYS phrase it as "the stock is trading X% above/below the moving average" or "trading X% above/below its 50-day SMA". NEVER say "the 50-day SMA is X% below" or "the moving averages are X% below" - this is confusing and incorrect. The percentage always refers to the STOCK's position relative to the MA, not the MA's position.

- WRONG: "the 100-day and 200-day SMAs, which are 9.8% and 4.1% below" - this is confusing

- CORRECT: "the stock is trading 9.8% below its 100-day SMA and 4.1% below its 200-day SMA" - this is clear

- Explain RSI levels in plain terms with context - what does overbought/oversold actually mean for this stock? What should traders watch for?

- Identify key support and resistance levels and explain why they matter for traders - what happens if these levels are tested?

- Discuss the stock's position within its 52-week range with context - is it near highs, lows, or middle? What does this positioning suggest about the stock's current state?

- Provide context throughout - explain the "why" behind the numbers, not just the "what"

- CRITICAL - NEVER INFER OR MAKE UP DATES: Only mention turning points (including golden cross, death cross, RSI events, MACD events, etc.) if there is an EXPLICIT DATE listed in the KEY TURNING POINTS section above. NEVER infer, guess, estimate, or make up dates for any event. NEVER say "the golden cross occurred in [month]" unless that exact date is explicitly listed in KEY TURNING POINTS. If a date is provided in KEY TURNING POINTS, naturally mention it with the exact date information provided (e.g., "RSI crossed into overbought territory in early January" or "The golden cross in late February signaled the start of the uptrend" - but ONLY if those dates are in KEY TURNING POINTS). If no date exists in KEY TURNING POINTS for an event, do not mention that event at all.

- CRITICAL - GOLDEN/DEATH CROSS RULES: Only mention golden cross or death cross if there is an EXPLICIT DATE in the KEY TURNING POINTS section. NEVER infer, guess, or make up dates. If a golden cross or death cross date IS listed in KEY TURNING POINTS and occurred RECENTLY (within last 3-4 months), mention them in paragraph 2 or 3 with the MONTH NAME (e.g., "In June" or "The golden cross in June"). DO NOT use vague terms like "recently" or "recent" - always use the actual month name from the date. DO NOT call a crossover from 6+ months ago "recent" - only mention if it's actually recent relative to the current date. If no date exists in KEY TURNING POINTS, do not mention golden/death cross at all - even if the MOVING AVERAGE CROSSOVERS section shows the current state.

- Only mention turning points that are relevant to the current analysis - don't list them all

- DO NOT mention volume or volume analysis at all

- REMEMBER: Every single paragraph must be 2 sentences or less - this is non-negotiable

- DO NOT use summary phrases like "In summary", "In conclusion", "Overall", "The technical outlook", "Monitoring will be crucial", "In summary", "To summarize", "All in all", "Ultimately", "In the end", "To conclude" - just end with a direct, specific insight

- End with a specific, direct insight about the stock's technical setup - do NOT wrap it in summary language

- Keep total length to 6-8 short paragraphs (2 sentences each) to provide comprehensive context

- Use plain text only - no special formatting or markup EXCEPT for:
  1. Hyperlinks in the first paragraph, which MUST be in HTML format: <a href="URL">text</a>
  2. Section markers, which MUST be in markdown H2 format: ## Section: [Label] (e.g., "## Section: The Catalyst", "## Section: Technical Analysis")

- NEVER use ambiguous phrasing like "below its 50-day moving average, which is X% lower"

- ALWAYS use clear phrasing: "trading X% below its 50-day moving average" or "the stock is X% below its 50-day moving average"

- The percentage always refers to how far the STOCK is from the moving average, not the other way around

- Write like you're having a conversation, not writing a formal report

- CRITICAL - COMPANY NAME BOLDING RULE: Only the FIRST reference to the company name WITH the ticker should be bolded (e.g., **Apple Inc.** (NASDAQ:AAPL)). All subsequent references to the company throughout the article must be in regular text WITHOUT bold formatting. Examples of what should NOT be bolded: "Apple's", "Apple is", "the company", "Apple Web Services", "Currently, Apple", "as Apple navigates", etc. Only the very first mention in the format **Company Name** (EXCHANGE:TICKER) should be bolded.

${newsContext && (newsContext.scrapedContent || (newsContext.selectedArticles && newsContext.selectedArticles.length > 0)) && primaryUrl ? `
FINAL CRITICAL REMINDER - HYPERLINK REQUIREMENT (THIS IS NOT OPTIONAL): Your first paragraph MUST include an HTML hyperlink tag in your output. ${isBenzinga ? `Use this EXACT format: <a href="${primaryUrl}">[three consecutive words]</a>. The URL is: ${primaryUrl}. Embed it naturally within your first paragraph - do NOT use phrases like "as detailed in" or "according to reports". Example of what your output should look like: "**Apple Inc.** (NASDAQ:AAPL) shares closed up on Thursday as the company is <a href="${primaryUrl}">reportedly deepening its</a> India strategy".` : `Use this EXACT format: <a href="${primaryUrl}">${outletName || 'Source'}</a> reports. The URL is: ${primaryUrl}. Example: "<a href="${primaryUrl}">CNBC</a> reports".`} IF YOU DO NOT INCLUDE THE <a href> TAG IN YOUR FIRST PARAGRAPH OUTPUT, YOUR RESPONSE IS INCOMPLETE AND INCORRECT.` : ''}

FINAL CRITICAL REMINDER - SECTION MARKERS (THIS IS NOT OPTIONAL): Your article output MUST include section markers in markdown H2 format. You MUST include:
- "## Section: The Catalyst" AFTER the "Also Read" section (which appears after the first paragraph)
- "## Section: Technical Analysis" after the news paragraphs  
- "## Section: Analyst Ratings" if analyst overview is included
- "## Section: Price Action" immediately before the automatically-generated price action line (do NOT write any content in this section - just place the marker)
IF YOU DO NOT INCLUDE THESE SECTION MARKERS IN YOUR OUTPUT, YOUR RESPONSE IS INCOMPLETE AND INCORRECT.
`;



    // Set provider if specified

    if (provider && (provider === 'openai' || provider === 'gemini')) {

      try {

        aiProvider.setProvider(provider);

      } catch (error: unknown) {

        const errorMessage = error instanceof Error ? error.message : String(error);

        console.warn(`Provider ${provider} not available, using default:`, errorMessage);

      }

    }



    // Use provider-specific model and token limits

    // Get the actual current provider (may have changed if fallback occurred)

    const currentProvider = aiProvider.getCurrentProvider();

    const model = currentProvider === 'gemini' 

      ? 'gemini-2.5-flash' 

      : 'gpt-4o-mini';

    const maxTokens = currentProvider === 'gemini' ? 8192 : 2500;



    // Only pass provider override if it's actually available

    // This prevents forcing an unavailable provider

    const providerOverride = (provider && provider === currentProvider) ? provider : undefined;



    const response = await aiProvider.generateCompletion(

      [{ role: 'user', content: prompt }],

      {

        model,

      temperature: 0.3,

        maxTokens,

      },

      providerOverride

    );



    let generatedContent = response.content.trim();
    
    // Post-processing: inject hyperlink if missing AND ensure it's only in the first paragraph
    if (primaryUrl && newsContext) {
      // Check if hyperlink exists anywhere in the content
      const hasHyperlink = generatedContent.includes(`<a href="${primaryUrl}">`) || generatedContent.includes(`<a href='${primaryUrl}'>`);
      
      // Split into paragraphs to check where hyperlink is
      const hasHTMLTags = generatedContent.includes('</p>');
      let paragraphs: string[] = [];
      
      if (hasHTMLTags) {
        paragraphs = generatedContent.split('</p>').filter(p => p.trim().length > 0);
      } else {
        paragraphs = generatedContent.split(/\n\s*\n/).filter(p => p.trim().length > 0);
      }
      
      // Check if hyperlink is in first paragraph
      const firstParaHasHyperlink = paragraphs.length > 0 && (paragraphs[0].includes(`<a href="${primaryUrl}">`) || paragraphs[0].includes(`<a href='${primaryUrl}'>`));
      
      // If hyperlink exists but NOT in first paragraph, remove it from other paragraphs and add to first
      if (hasHyperlink && !firstParaHasHyperlink && paragraphs.length > 0) {
        console.warn('[HYPERLINK WARNING] Hyperlink found but NOT in first paragraph. Moving to first paragraph...');
        
        // Remove hyperlink from all paragraphs except first
        for (let i = 1; i < paragraphs.length; i++) {
          paragraphs[i] = paragraphs[i].replace(new RegExp(`<a href=["']${primaryUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']>([^<]+)</a>`, 'gi'), '$1');
        }
        
        // Now inject into first paragraph
        let leadParagraph = paragraphs[0].trim();
        const textOnly = leadParagraph.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        const words = textOnly.split(/\s+/).filter(w => w.length > 0);
        
        if (words.length >= 3) {
          const startIdx = Math.min(Math.max(3, Math.floor(words.length / 4)), words.length - 3);
          let found = false;
          
          for (let i = startIdx; i < words.length - 2 && !found; i++) {
            const phrase = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
            if (phrase.match(/[<>()\[\]{}*]/)) continue;
            
            const escapedPhrase = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const match = leadParagraph.match(new RegExp(`(${escapedPhrase.replace(/\*/g, '\\*')})`, 'i'));
            if (match) {
              const originalPhrase = match[1];
              leadParagraph = leadParagraph.replace(originalPhrase, `<a href="${primaryUrl}">${originalPhrase}</a>`);
              found = true;
              console.log(`[HYPERLINK FIX] Moved hyperlink to first paragraph with phrase: "${originalPhrase}"`);
            }
          }
          
          if (!found && words.length >= 5) {
            for (let i = 2; i < Math.min(5, words.length - 2) && !found; i++) {
              const phrase = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
              if (!phrase.match(/[<>()\[\]{}*]/)) {
                const escapedPhrase = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const match = leadParagraph.match(new RegExp(`(${escapedPhrase.replace(/\*/g, '\\*')})`, 'i'));
                if (match) {
                  const originalPhrase = match[1];
                  leadParagraph = leadParagraph.replace(originalPhrase, `<a href="${primaryUrl}">${originalPhrase}</a>`);
                  found = true;
                  console.log(`[HYPERLINK FIX] Moved hyperlink to first paragraph with fallback phrase: "${originalPhrase}"`);
                }
              }
            }
          }
        }
        
        paragraphs[0] = leadParagraph;
        generatedContent = hasHTMLTags 
          ? paragraphs.map(p => (p.trim().endsWith('</p>') ? p : p + '</p>')).join('')
          : paragraphs.join('\n\n');
      } else if (!hasHyperlink) {
        // No hyperlink at all - inject into first paragraph
        console.warn('[HYPERLINK WARNING] Generated content does not include hyperlink for URL:', primaryUrl);
        console.log('[HYPERLINK FIX] Injecting hyperlink into first paragraph...');
        
        if (paragraphs.length > 0) {
          let leadParagraph = paragraphs[0].trim();
          
          // Remove HTML tags for word processing but keep original for replacement
          const textOnly = leadParagraph.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
          const words = textOnly.split(/\s+/).filter(w => w.length > 0);
          
          if (words.length >= 3) {
            // Skip first few words (usually company name/ticker), try to find a good phrase
            const startIdx = Math.min(Math.max(3, Math.floor(words.length / 4)), words.length - 3);
            let found = false;
            
            for (let i = startIdx; i < words.length - 2 && !found; i++) {
              const phrase = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
              
              // Skip if phrase contains problematic characters
              if (phrase.match(/[<>()\[\]{}*]/)) continue;
              
              // Create regex to find the phrase as whole words (case insensitive)
              const escapedPhrase = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const phraseRegex = new RegExp(`(\\b|\\*)${escapedPhrase.replace(/\*/g, '\\*')}(\\b|\\*)`, 'i');
              
              // Try to find and replace in original paragraph (preserving HTML)
              const match = leadParagraph.match(new RegExp(`(${escapedPhrase.replace(/\*/g, '\\*')})`, 'i'));
              if (match) {
                const originalPhrase = match[1];
                leadParagraph = leadParagraph.replace(originalPhrase, `<a href="${primaryUrl}">${originalPhrase}</a>`);
                found = true;
                console.log(`[HYPERLINK FIX] Successfully injected hyperlink with phrase: "${originalPhrase}"`);
              }
            }
            
            // Fallback: try linking earlier words if nothing found
            if (!found && words.length >= 5) {
              for (let i = 2; i < Math.min(5, words.length - 2) && !found; i++) {
                const phrase = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
                if (!phrase.match(/[<>()\[\]{}*]/)) {
                  const escapedPhrase = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                  const match = leadParagraph.match(new RegExp(`(${escapedPhrase.replace(/\*/g, '\\*')})`, 'i'));
                  if (match) {
                    const originalPhrase = match[1];
                    leadParagraph = leadParagraph.replace(originalPhrase, `<a href="${primaryUrl}">${originalPhrase}</a>`);
                    found = true;
                    console.log(`[HYPERLINK FIX] Successfully injected hyperlink with fallback phrase: "${originalPhrase}"`);
                  }
                }
              }
            }
          }
          
          paragraphs[0] = leadParagraph;
          generatedContent = hasHTMLTags 
            ? paragraphs.map(p => (p.trim().endsWith('</p>') ? p : p + '</p>')).join('')
            : paragraphs.join('\n\n');
        }
      } else {
        console.log('[HYPERLINK SUCCESS] Hyperlink found in first paragraph for URL:', primaryUrl);
      }
    }
    
    // Post-processing: Remove bold formatting from company name after first instance
    if (data.companyName) {
      // Split into paragraphs to process separately
      const hasHTMLTags = generatedContent.includes('</p>');
      let paragraphs: string[] = [];
      
      if (hasHTMLTags) {
        paragraphs = generatedContent.split('</p>').filter(p => p.trim().length > 0);
      } else {
        paragraphs = generatedContent.split(/\n\s*\n/).filter(p => p.trim().length > 0);
      }
      
      if (paragraphs.length > 1) {
        // Keep first paragraph as-is (it should have the bolded company name with ticker)
        // Process all subsequent paragraphs to remove bold from company name
        for (let i = 1; i < paragraphs.length; i++) {
          let para = paragraphs[i];
          
          // Find all instances of **CompanyName** or **Company Name** and remove bold
          // Match various company name formats with optional suffixes
          const companyNameVariations = [
            data.companyName,
            data.companyName.replace(/\s+(Inc\.?|Corp\.?|Ltd\.?|LLC|Co\.?)$/i, ''),
            data.companyName.replace(/\s+(Inc\.?|Corp\.?|Ltd\.?|LLC|Co\.?)$/i, '').replace(/\./g, '\\.'),
          ];
          
          for (const name of companyNameVariations) {
            // Escape special regex characters
            const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // Match **CompanyName** but not if followed by ticker pattern
            const boldPattern = new RegExp(`\\*\\*(${escapedName})(?:\\s+(?:Inc\\.?|Corp\\.?|Ltd\\.?|LLC|Co\\.?))?\\*\\*(?!\\s*\\([A-Z]+:[A-Z]+\\))`, 'gi');
            
            para = para.replace(boldPattern, (match, companyName) => {
              // Remove bold formatting
              const unBolded = companyName;
              console.log(`[BOLD FIX] Removed bold formatting from "${match}" -> "${unBolded}"`);
              return unBolded;
            });
          }
          
          paragraphs[i] = para;
        }
        
        generatedContent = hasHTMLTags 
          ? paragraphs.map(p => (p.trim().endsWith('</p>') ? p : p + '</p>')).join('')
          : paragraphs.join('\n\n');
      }
    }
    
    return generatedContent;

  } catch (error) {

    console.error('Error generating technical analysis:', error);

    return '';

  }

}



export async function POST(request: Request) {

  try {

    const { tickers, provider, newsUrl, scrapedContent, selectedArticles, primaryArticle } = await request.json();

    

    if (!tickers || !tickers.trim()) {

      return NextResponse.json({ error: 'Please provide ticker(s)' }, { status: 400 });

    }

    

    const tickerList = tickers.split(',').map((t: string) => t.trim().toUpperCase());

    

    // Validate provider if provided

    const aiProvider: AIProvider | undefined = provider && (provider === 'openai' || provider === 'gemini')

      ? provider

      : undefined;

    // Fetch market context once for all tickers (shared market data)
    const marketContext = await fetchMarketContext();
    
    const analyses = await Promise.all(

      tickerList.map(async (ticker: string) => {

        const technicalData = await fetchTechnicalData(ticker);

        

        if (!technicalData) {

          return {

            ticker,

            error: 'Failed to fetch technical data'

          };

        }

        

        const newsContext = (scrapedContent || (selectedArticles && selectedArticles.length > 0)) ? {
          scrapedContent: scrapedContent || undefined,
          selectedArticles: selectedArticles || undefined,
          newsUrl: newsUrl || (selectedArticles && selectedArticles.length > 0 ? selectedArticles[0].url : undefined),
          primaryArticle: primaryArticle || undefined
        } : undefined;
        
        const analysis = await generateTechnicalAnalysis(technicalData, aiProvider, newsContext, marketContext);
        
        // Generate price action and append to analysis
        // Fetch ETF information first
        let etfInfo = '';
        try {
          const etfs = await fetchETFs(ticker);
          if (etfs && etfs.length > 0) {
            etfInfo = formatETFInfo(etfs, ticker);
          }
        } catch (etfError) {
          console.error(`Error fetching ETF data for ${ticker}:`, etfError);
        }
        
        // Generate price action
        const priceAction = await generatePriceAction(ticker);
        
        // Remove any AI-generated "## Section: Price Action" marker from the end of analysis
        // since we're adding it ourselves with the actual price action line
        let cleanAnalysis = analysis.trim();
        const priceActionMarkerPattern = /##\s*Section:\s*Price Action\s*$/i;
        cleanAnalysis = cleanAnalysis.replace(priceActionMarkerPattern, '').trim();
        
        // Build the final content: start with clean analysis (ETF and Price Action will be added later)
        let analysisWithPriceAction = cleanAnalysis;

        // Fetch related articles and add "Also Read" and "Read Next" sections
        const excludeUrl = newsContext?.newsUrl || (newsContext?.selectedArticles && newsContext.selectedArticles[0]?.url) || undefined;
        const relatedArticles = await fetchRelatedArticles(ticker, excludeUrl);
        
        // Ensure "Also Read" and "Read Next" sections are included if related articles are available
        if (relatedArticles && relatedArticles.length > 0) {
          // Check if "Also Read" section exists
          const alsoReadPattern = /(?:<p>)?Also Read:.*?(?:<\/p>)?/i;
          const alsoReadMatch = analysisWithPriceAction.match(alsoReadPattern);
          const alsoReadExists = !!alsoReadMatch;
          
          // Check if it has an HTML link tag - if not, we need to replace it
          const alsoReadSectionText = alsoReadMatch ? alsoReadMatch[0] : '';
          const hasHTMLLink = alsoReadExists && alsoReadSectionText.includes('<a href=');
          
          if (!alsoReadExists || !hasHTMLLink) {
            // If it exists but doesn't have HTML link, remove it first
            if (alsoReadExists && !hasHTMLLink) {
              console.log('Removing incorrectly formatted "Also Read" section (no HTML link)');
              if (alsoReadMatch && alsoReadMatch.index !== undefined) {
                const beforeAlsoRead = analysisWithPriceAction.substring(0, alsoReadMatch.index);
                const afterAlsoRead = analysisWithPriceAction.substring(alsoReadMatch.index + alsoReadMatch[0].length);
                analysisWithPriceAction = (beforeAlsoRead + afterAlsoRead).replace(/\n\n\n+/g, '\n\n');
              }
            }
            console.log('Adding "Also Read" section');
            // Split content by double newlines (paragraph breaks) or </p> tags
            // Handle both HTML and plain text formats
            const hasHTMLTags = analysisWithPriceAction.includes('</p>');
            let paragraphs: string[];
            
            if (hasHTMLTags) {
              // HTML format: split by </p> tags
              paragraphs = analysisWithPriceAction.split('</p>').filter(p => p.trim().length > 0);
            } else {
              // Plain text format: split by double newlines
              paragraphs = analysisWithPriceAction.split(/\n\s*\n/).filter(p => p.trim().length > 0);
            }
            
            // Remove any existing "Also Read" text from the AI output first
            paragraphs = paragraphs.filter(p => {
              const trimmed = p.trim();
              // Remove standalone "Also Read" lines (without links or not properly formatted)
              if (trimmed === 'Also Read' || trimmed === 'Also Read:' || 
                  (trimmed.includes('Also Read') && !trimmed.includes('<a href'))) {
                console.log(`[CLEANUP] Removing standalone "Also Read" text: "${trimmed}"`);
                return false;
              }
              return true;
            });
            
            // Insert "Also Read" after the first paragraph (index 1)
            if (paragraphs.length >= 1) {
              // Always use HTML link format even if content is plain text (for clickable links)
              const alsoReadSection = `Also Read: <a href="${relatedArticles[0].url}">${relatedArticles[0].headline}</a>`;
              
              // Insert at index 1 (after first paragraph)
              paragraphs.splice(1, 0, alsoReadSection);
              
              // Rejoin content
              if (hasHTMLTags) {
                analysisWithPriceAction = paragraphs.map(p => {
                  // If it already ends with </p>, return as-is
                  if (p.trim().endsWith('</p>')) return p;
                  // If it's the alsoReadSection, wrap in <p> tags
                  if (p.includes('Also Read:')) return `<p>${p}</p>`;
                  // Otherwise, add </p> back
                  return p + '</p>';
                }).join('');
              } else {
                analysisWithPriceAction = paragraphs.join('\n\n');
              }
              
              console.log('✅ "Also Read" section placed after first paragraph');
              
              // Clean up: Remove any standalone headline-like lines that appear after "Also Read"
              // These are often AI-generated summaries that shouldn't be there
              const alsoReadIndex = analysisWithPriceAction.indexOf('Also Read:');
              if (alsoReadIndex !== -1) {
                const afterAlsoRead = analysisWithPriceAction.substring(alsoReadIndex);
                // Look for standalone lines (not in paragraphs) that look like headlines
                const lines = afterAlsoRead.split('\n');
                let cleanedLines: string[] = [];
                let foundSectionMarker = false;
                
                for (let i = 0; i < lines.length; i++) {
                  const line = lines[i].trim();
                  
                  // Skip empty lines
                  if (!line) {
                    cleanedLines.push(lines[i]);
                    continue;
                  }
                  
                  // Keep "Also Read" section (only the properly formatted one with link)
                  if (line.includes('Also Read')) {
                    // Check if this is a properly formatted "Also Read" (has link)
                    const hasLink = line.includes('<a href');
                    // Check if we already have a properly formatted "Also Read" section
                    const hasExistingAlsoRead = cleanedLines.some(l => l.includes('Also Read') && l.includes('<a href'));
                    
                    if (hasLink && !hasExistingAlsoRead) {
                      // This is the first properly formatted "Also Read" with link - keep it
                      cleanedLines.push(lines[i]);
                    } else {
                      // This is a duplicate or standalone "Also Read" without link - remove it
                      console.log(`[CLEANUP] Removing duplicate or standalone "Also Read" line: "${line}"`);
                    }
                    continue;
                  }
                  
                  // Keep section markers
                  if (line.startsWith('## Section:')) {
                    foundSectionMarker = true;
                    cleanedLines.push(lines[i]);
                    continue;
                  }
                  
                  // Remove standalone hyperlinks or headline-like text between "Also Read" and section marker
                  // This catches things like "Latest Market Insights" with links or other standalone headlines
                  if (!foundSectionMarker) {
                    // Check if line is a standalone hyperlink (has <a href> but not wrapped in <p> tags)
                    const hasHTMLLink = line.includes('<a href');
                    const isInParagraph = line.startsWith('<p>') || line.match(/<p[^>]*>.*<a href/);
                    
                    if (hasHTMLLink && !isInParagraph) {
                      console.log(`[CLEANUP] Removing standalone HTML hyperlink between "Also Read" and section marker: "${line}"`);
                      continue;
                    }
                    
                    // Check if line is a standalone markdown link (format: [text](url))
                    const isMarkdownLink = line.match(/^\[.+\]\(https?:\/\/.+\)\s*$/);
                    if (isMarkdownLink) {
                      console.log(`[CLEANUP] Removing standalone markdown link between "Also Read" and section marker: "${line}"`);
                      continue;
                    }
                  }
                  
                  // Keep HTML paragraphs
                  if (line.startsWith('<p>') || line.includes('</p>')) {
                    cleanedLines.push(lines[i]);
                    continue;
                  }
                  
                  // Remove standalone lines that look like headlines or fragments
                  // These are often AI-generated summaries or fragments that appear after "Also Read"
                  const trimmedLine = line.trim();
                  const isStandaloneHeadline = 
                    !foundSectionMarker && // Only before section marker
                    trimmedLine.length > 0 && // Not empty
                    trimmedLine.length < 150 && // Short line
                    !trimmedLine.startsWith('**') && // Not bolded company name
                    !trimmedLine.startsWith('##') && // Not a section marker
                    !trimmedLine.startsWith('<') && // Not HTML
                    (
                      // Fragment that starts with lowercase and ends with punctuation (e.g., "crashed 71% since the election.")
                      (trimmedLine.match(/^[a-z].*[.!?]\s*$/) && trimmedLine.length < 100) ||
                      // Short fragment that doesn't look like a proper paragraph (no capital start or no punctuation)
                      (trimmedLine.length < 50 && !trimmedLine.match(/^[A-Z][^.!?]*[.!?]\s*$/)) ||
                      // Looks like a headline with quotes
                      (trimmedLine.includes("'") && trimmedLine.match(/^[A-Z][a-z]+/))
                    );
                  
                  if (isStandaloneHeadline) {
                    console.log(`[CLEANUP] Removing standalone headline-like line or fragment after "Also Read": "${trimmedLine}"`);
                    continue; // Skip this line
                  }
                  
                  cleanedLines.push(lines[i]);
                }
                
                const beforeAlsoRead = analysisWithPriceAction.substring(0, alsoReadIndex);
                analysisWithPriceAction = beforeAlsoRead + cleanedLines.join('\n');
              }
              
              // Ensure "## Section: The Catalyst" comes AFTER "Also Read"
              // Check if section marker exists and is before "Also Read"
              const sectionMarkerPattern = /## Section: The Catalyst/i;
              const sectionMarkerMatch = analysisWithPriceAction.match(sectionMarkerPattern);
              if (sectionMarkerMatch) {
                const markerIndex = analysisWithPriceAction.indexOf(sectionMarkerMatch[0]);
                const alsoReadIndex = analysisWithPriceAction.indexOf('Also Read:');
                
                // If section marker is before "Also Read", move it after
                if (markerIndex !== -1 && alsoReadIndex !== -1 && markerIndex < alsoReadIndex) {
                  console.log('Moving "## Section: The Catalyst" to after "Also Read"');
                  // Remove the section marker from its current location
                  const beforeMarker = analysisWithPriceAction.substring(0, markerIndex);
                  const afterMarker = analysisWithPriceAction.substring(markerIndex + sectionMarkerMatch[0].length);
                  const withoutMarker = (beforeMarker + afterMarker).replace(/\n\n\n+/g, '\n\n');
                  
                  // Find "Also Read" and insert section marker after it
                  const alsoReadEndIndex = analysisWithPriceAction.indexOf('</a>', alsoReadIndex);
                  if (alsoReadEndIndex !== -1) {
                    const beforeAlsoRead = withoutMarker.substring(0, alsoReadEndIndex + 4);
                    const afterAlsoRead = withoutMarker.substring(alsoReadEndIndex + 4);
                    // Insert section marker after "Also Read" with proper spacing
                    analysisWithPriceAction = `${beforeAlsoRead}\n\n## Section: The Catalyst\n\n${afterAlsoRead.trim()}`;
                    console.log('✅ Moved "## Section: The Catalyst" to after "Also Read"');
                  }
                }
              }
            } else {
              console.log('⚠️ Not enough paragraphs to insert "Also Read" (need at least 1)');
            }
          } else {
            console.log('"Also Read" section already exists');
            
            // Even if "Also Read" already exists, ensure section marker is after it
            const sectionMarkerPattern = /## Section: The Catalyst/i;
            const sectionMarkerMatch = analysisWithPriceAction.match(sectionMarkerPattern);
            if (sectionMarkerMatch) {
              const markerIndex = analysisWithPriceAction.indexOf(sectionMarkerMatch[0]);
              const alsoReadIndex = analysisWithPriceAction.indexOf('Also Read:');
              
              // If section marker is before "Also Read", move it after
              if (markerIndex !== -1 && alsoReadIndex !== -1 && markerIndex < alsoReadIndex) {
                console.log('Moving "## Section: The Catalyst" to after "Also Read"');
                const beforeMarker = analysisWithPriceAction.substring(0, markerIndex);
                const afterMarker = analysisWithPriceAction.substring(markerIndex + sectionMarkerMatch[0].length);
                const withoutMarker = (beforeMarker + afterMarker).replace(/\n\n\n+/g, '\n\n');
                
                const alsoReadEndIndex = analysisWithPriceAction.indexOf('</a>', alsoReadIndex);
                if (alsoReadEndIndex !== -1) {
                  const beforeAlsoRead = withoutMarker.substring(0, alsoReadEndIndex + 4);
                  const afterAlsoRead = withoutMarker.substring(alsoReadEndIndex + 4);
                  analysisWithPriceAction = `${beforeAlsoRead}\n\n## Section: The Catalyst\n\n${afterAlsoRead.trim()}`;
                  console.log('✅ Moved "## Section: The Catalyst" to after "Also Read"');
                }
              }
            }
          }
          
          // Check if "## Section: Company Context" should exist and is missing
          const companyContextSectionMarker = /##\s*Section:\s*Company\s*Context/i;
          const hasCompanyContextMarker = !!analysisWithPriceAction.match(companyContextSectionMarker);
          
          // Check if description exists in technicalData (should match what was in the prompt)
          const shouldHaveCompanyContext = technicalData.description && technicalData.description !== 'N/A' && technicalData.description.trim().length > 0;
          
          if (shouldHaveCompanyContext && !hasCompanyContextMarker && technicalData.description) {
            console.log(`[COMPANY CONTEXT] Description exists but section marker is missing. Description length: ${technicalData.description.length}`);
            console.log(`[COMPANY CONTEXT] Attempting to inject "## Section: Company Context" section`);
            
            // Determine where to insert: after "Technical Analysis" section
            const technicalAnalysisMarker = /##\s*Section:\s*Technical\s*Analysis/i;
            const technicalAnalysisMatch = analysisWithPriceAction.match(technicalAnalysisMarker);
            
            let insertPosition = -1;
            
            if (technicalAnalysisMatch && technicalAnalysisMatch.index !== undefined) {
              // Find the end of the "Technical Analysis" section (look for next section marker)
              const afterTechnicalMarker = analysisWithPriceAction.substring(technicalAnalysisMatch.index + technicalAnalysisMatch[0].length);
              const nextSectionMatch = afterTechnicalMarker.match(/(##\s*Section:|Price Action:)/);
              
              if (nextSectionMatch && nextSectionMatch.index !== undefined) {
                // Insert after Technical Analysis, before the next section
                insertPosition = technicalAnalysisMatch.index + technicalAnalysisMatch[0].length + nextSectionMatch.index;
              } else {
                // No next section found, insert at the end of Technical Analysis content
                // Look for the end of the technical analysis content (before price action or end of text)
                const priceActionMarker = /##\s*Section:\s*Price Action/i;
                const priceActionMatch = analysisWithPriceAction.match(priceActionMarker);
                
                if (priceActionMatch && priceActionMatch.index !== undefined) {
                  insertPosition = priceActionMatch.index;
                } else {
                  // Insert near the end of the content
                  insertPosition = analysisWithPriceAction.length;
                }
              }
            } else {
              // Technical Analysis section marker not found - try to find where technical content ends
              // Look for common patterns that indicate end of technical analysis:
              // 1. "Key Resistance" / "Key Support" (usually at end of technical analysis)
              // 2. "## Section: Earnings" (comes after technical analysis)
              // 3. "## Section: Benzinga Edge" (comes after technical analysis)
              
              const keyResistanceSupportPattern = /Key (Resistance|Support):\s*\$[\d.]+/i;
              const keyResistanceMatch = analysisWithPriceAction.match(keyResistanceSupportPattern);
              
              if (keyResistanceMatch && keyResistanceMatch.index !== undefined) {
                // Find the end of the Key Resistance/Support lines
                const afterKeyResistance = analysisWithPriceAction.substring(keyResistanceMatch.index);
                const nextLineMatch = afterKeyResistance.match(/\n\n/);
                const earningsSectionMatch = afterKeyResistance.match(/##\s*Section:\s*Earnings/i);
                const edgeSectionMatch = afterKeyResistance.match(/##\s*Section:\s*Benzinga\s*Edge/i);
                
                if (earningsSectionMatch && earningsSectionMatch.index !== undefined) {
                  insertPosition = keyResistanceMatch.index + earningsSectionMatch.index;
                } else if (edgeSectionMatch && edgeSectionMatch.index !== undefined) {
                  insertPosition = keyResistanceMatch.index + edgeSectionMatch.index;
                } else if (nextLineMatch && nextLineMatch.index !== undefined) {
                  // Insert after the Key Resistance/Support block
                  insertPosition = keyResistanceMatch.index + nextLineMatch.index + 2;
                } else {
                  // Fallback: insert after Key Resistance/Support
                  insertPosition = keyResistanceMatch.index + keyResistanceMatch[0].length;
                }
              } else {
                // Try to find "## Section: Earnings" directly
                const earningsSectionMarker = /##\s*Section:\s*Earnings/i;
                const earningsMatch = analysisWithPriceAction.match(earningsSectionMarker);
                
                if (earningsMatch && earningsMatch.index !== undefined) {
                  insertPosition = earningsMatch.index;
                } else {
                  // Last resort: look for "## Section: Benzinga Edge"
                  const edgeSectionMarker = /##\s*Section:\s*Benzinga\s*Edge/i;
                  const edgeMatch = analysisWithPriceAction.match(edgeSectionMarker);
                  
                  if (edgeMatch && edgeMatch.index !== undefined) {
                    insertPosition = edgeMatch.index;
                  } else {
                    // Final fallback: insert before "## Section: Price Action"
                    const priceActionMarker = /##\s*Section:\s*Price Action/i;
                    const priceActionMatch = analysisWithPriceAction.match(priceActionMarker);
                    
                    if (priceActionMatch && priceActionMatch.index !== undefined) {
                      insertPosition = priceActionMatch.index;
                    }
                  }
                }
              }
            }
            
            if (insertPosition !== -1 && technicalData.description) {
              const beforeInsert = analysisWithPriceAction.substring(0, insertPosition).trim();
              const afterInsert = analysisWithPriceAction.substring(insertPosition);
              
              // Split long descriptions into multiple paragraphs
              // Split by sentences (period followed by space and capital letter, or end of string)
              const sentences = technicalData.description.match(/[^.!?]+[.!?]+(?:\s+|$)/g) || [technicalData.description];
              
              let formattedDescription = '';
              if (sentences.length <= 3) {
                // Short description: keep as single paragraph
                formattedDescription = technicalData.description;
              } else {
                // Long description: split into 2-3 sentences per paragraph
                const sentencesPerParagraph = Math.ceil(sentences.length / 2); // Aim for 2 paragraphs
                const paragraphs: string[] = [];
                
                for (let i = 0; i < sentences.length; i += sentencesPerParagraph) {
                  const paragraphSentences = sentences.slice(i, i + sentencesPerParagraph);
                  paragraphs.push(paragraphSentences.join(' ').trim());
                }
                
                formattedDescription = paragraphs.join('\n\n');
              }
              
              // Use the formatted description (plain text, no HTML tags)
              const companyContextContent = `## Section: Company Context\n\n${formattedDescription}\n\n`;
              
              analysisWithPriceAction = `${beforeInsert}\n\n${companyContextContent}${afterInsert}`;
              console.log(`[COMPANY CONTEXT] ✅ Injected "## Section: Company Context" section with full description (${technicalData.description.length} chars, split into ${formattedDescription.split('\n\n').length} paragraph(s))`);
            } else {
              console.log(`[COMPANY CONTEXT] ⚠️ Could not determine insertion position for Company Context section`);
            }
          } else if (shouldHaveCompanyContext && hasCompanyContextMarker) {
            console.log(`[COMPANY CONTEXT] ✅ Section marker found in output`);
          } else if (!shouldHaveCompanyContext) {
            console.log(`[COMPANY CONTEXT] Description not available, skipping check`);
          }
          
          // Fetch consensus ratings and earnings to check if section marker should exist
          const [consensusRatingsCheck, nextEarningsCheck] = await Promise.all([
            fetchConsensusRatings(ticker),
            fetchNextEarningsDate(ticker)
          ]);
          
          // Check if "## Section: Earnings & Analyst Outlook" marker exists
          const earningsAnalystSectionMarker = /##\s*Section:\s*Earnings\s*&\s*Analyst\s*Outlook/i;
          const hasEarningsAnalystMarker = !!analysisWithPriceAction.match(earningsAnalystSectionMarker);
          
          // Find the "## Section: Technical Analysis" marker position
          const technicalAnalysisMarker = /##\s*Section:\s*Technical\s*Analysis/i;
          const technicalAnalysisMatch = analysisWithPriceAction.match(technicalAnalysisMarker);
          
          // Find the "## Section: Price Action" marker position
          const priceActionSectionMarker = /##\s*Section:\s*Price Action/i;
          const priceActionMarkerMatch = analysisWithPriceAction.match(priceActionSectionMarker);
          const hasPriceActionMarker = !!priceActionMarkerMatch;
          
          // If earnings/analyst data exists but marker is missing, inject it
          if ((consensusRatingsCheck || nextEarningsCheck) && !hasEarningsAnalystMarker) {
            console.log('Adding "## Section: Earnings & Analyst Outlook" marker');
            let insertPosition = -1;
            
            // Try to insert after "## Section: Technical Analysis"
            if (technicalAnalysisMatch && technicalAnalysisMatch.index !== undefined) {
              // Find the end of the technical analysis section (look for next section marker or price action)
              const afterTechnicalMarker = analysisWithPriceAction.substring(technicalAnalysisMatch.index);
              const nextSectionMatch = afterTechnicalMarker.match(/(##\s*Section:|Price Action:)/);
              
              if (nextSectionMatch && nextSectionMatch.index !== undefined) {
                insertPosition = technicalAnalysisMatch.index + technicalAnalysisMatch[0].length + nextSectionMatch.index;
              } else {
                // No next section found, insert before price action
                if (priceActionMarkerMatch && priceActionMarkerMatch.index !== undefined) {
                  insertPosition = priceActionMarkerMatch.index;
                } else {
                  // Find price action text instead
                  const priceActionTextMatch = analysisWithPriceAction.match(/<strong>.*?Price Action:<\/strong>/i);
                  if (priceActionTextMatch && priceActionTextMatch.index !== undefined) {
                    insertPosition = priceActionTextMatch.index;
                  }
                }
              }
            } else if (priceActionMarkerMatch && priceActionMarkerMatch.index !== undefined) {
              // Insert before "## Section: Price Action"
              insertPosition = priceActionMarkerMatch.index;
            } else {
              // Find price action text
              const priceActionTextMatch = analysisWithPriceAction.match(/<strong>.*?Price Action:<\/strong>/i);
              if (priceActionTextMatch && priceActionTextMatch.index !== undefined) {
                insertPosition = priceActionTextMatch.index;
              }
            }
            
            if (insertPosition !== -1) {
              const beforeInsert = analysisWithPriceAction.substring(0, insertPosition).trim();
              const afterInsert = analysisWithPriceAction.substring(insertPosition);
              analysisWithPriceAction = `${beforeInsert}\n\n## Section: Earnings & Analyst Outlook\n\n${afterInsert}`;
              console.log('✅ Added "## Section: Earnings & Analyst Outlook" marker');
            }
          }
          
          // Note: ETF section and Price Action section are now added earlier in the code
          // We no longer need to insert the section marker here since it's handled above
          
          // Post-process Earnings & Analyst Outlook section to format with bold labels
          // Re-fetch P/E ratio and recent analyst actions for post-processing
          let peRatioForPost: number | null = null;
          let useForwardPEForPost = false;
          let recentAnalystActionsForPost: any[] = [];
          let consensusRatingsForPost: any = null;
          
          try {
            const BENZINGA_API_KEY = process.env.BENZINGA_API_KEY;
            if (BENZINGA_API_KEY) {
              // Fetch P/E ratio
              const benzingaRes = await fetch(`https://api.benzinga.com/api/v2/quoteDelayed?token=${BENZINGA_API_KEY}&symbols=${ticker}`);
              if (benzingaRes.ok) {
                const benzingaData = await benzingaRes.json();
                if (benzingaData && benzingaData[ticker]) {
                  const quote = benzingaData[ticker];
                  peRatioForPost = quote.pe || quote.priceEarnings || quote.pe_ratio || null;
                }
              }
              
              // Fetch recent analyst actions
              recentAnalystActionsForPost = await fetchRecentAnalystActions(ticker, 3);
              
              // Fetch consensus ratings for validation (to check for limited coverage)
              consensusRatingsForPost = await fetchConsensusRatings(ticker);
              
              // Apply validation to filter out stale analyst actions
              if (recentAnalystActionsForPost.length > 0 && technicalData) {
                const sixMonthsAgo = new Date();
                sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
                const twelveMonthsAgo = new Date();
                twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
                
                // Check if coverage is limited (≤2 analysts)
                const hasLimitedCoverage = consensusRatingsForPost 
                  ? (consensusRatingsForPost.total_analyst_count || 0) <= 2
                  : false;
                
                // Use 6 months for normal coverage, 12 months for limited coverage
                const cutoffDateRaw = hasLimitedCoverage ? twelveMonthsAgo : sixMonthsAgo;
                const cutoffMonths = hasLimitedCoverage ? 12 : 6;
                
                // Normalize cutoff date to midnight for accurate comparison
                const cutoffDate = new Date(cutoffDateRaw);
                cutoffDate.setHours(0, 0, 0, 0);
                
                const initialCount = recentAnalystActionsForPost.length;
                recentAnalystActionsForPost = recentAnalystActionsForPost.filter((action: any) => {
                  if (!action.date) {
                    console.log(`[EARNINGS FORMAT] [ANALYST VALIDATION] ${ticker}: Filtering out action with no date:`, action);
                    return false;
                  }
                  
                  try {
                    // Parse date string (format: YYYY-MM-DD)
                    const dateParts = action.date.split('-');
                    let actionDate: Date;
                    if (dateParts.length === 3) {
                      actionDate = new Date(parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2]));
                    } else {
                      actionDate = new Date(action.date);
                    }
                    
                    // Normalize action date to midnight for accurate comparison
                    actionDate.setHours(0, 0, 0, 0);
                    
                    const isRecent = actionDate >= cutoffDate;
                    if (!isRecent) {
                      console.log(`[EARNINGS FORMAT] [ANALYST VALIDATION] ${ticker}: Filtering out stale action: ${action.firm} from ${action.date} (cutoff: ${cutoffDate.toISOString().split('T')[0]})`);
                    }
                    return isRecent;
                  } catch (e) {
                    // If date parsing fails, exclude the action
                    console.log(`[EARNINGS FORMAT] [ANALYST VALIDATION] ${ticker}: Filtering out action with invalid date format: ${action.date}`, e);
                    return false;
                  }
                });
                
                if (recentAnalystActionsForPost.length < initialCount) {
                  const removedCount = initialCount - recentAnalystActionsForPost.length;
                  console.log(`[EARNINGS FORMAT] [ANALYST VALIDATION] ${ticker}: Filtered out ${removedCount} stale analyst action(s) older than ${cutoffMonths} months${hasLimitedCoverage ? ' (using 12-month cutoff for limited coverage)' : ''}`);
                }
              }
              
              // Fetch earnings data for post-processing (we'll use this for revenue formatting too)
              const nextEarningsCheck = await fetchNextEarningsDate(ticker);
              if (nextEarningsCheck && typeof nextEarningsCheck === 'object') {
                const trailingEPS = nextEarningsCheck.eps_prior ? parseFloat(nextEarningsCheck.eps_prior.toString()) : null;
                const forwardEPS = nextEarningsCheck.eps_estimate ? parseFloat(nextEarningsCheck.eps_estimate.toString()) : null;
                if (trailingEPS !== null && forwardEPS !== null) {
                  useForwardPEForPost = trailingEPS < 0 && forwardEPS > 0;
                }
              }
            }
          } catch (error) {
            console.error('Error fetching P/E or analyst actions for post-processing:', error);
          }
          
          const earningsSectionMarker = /##\s*Section:\s*Earnings\s*&\s*Analyst\s*Outlook/i;
          const earningsSectionMatch = analysisWithPriceAction.match(earningsSectionMarker);
          console.log('[EARNINGS FORMAT] Checking for Earnings section marker:', !!earningsSectionMatch);
          if (earningsSectionMatch && earningsSectionMatch.index !== undefined) {
            const afterEarningsMarker = analysisWithPriceAction.substring(earningsSectionMatch.index + earningsSectionMatch[0].length);
            const nextSectionMatch = afterEarningsMarker.match(/(##\s*Section:|##\s*Top\s*ETF|Price Action:)/i);
            const earningsSectionEnd = nextSectionMatch ? nextSectionMatch.index! : afterEarningsMarker.length;
            const earningsContent = afterEarningsMarker.substring(0, earningsSectionEnd).trim();
            
            console.log('[EARNINGS FORMAT] Earnings content length:', earningsContent.length);
            console.log('[EARNINGS FORMAT] Has <ul> tags?', earningsContent.includes('<ul>'));
            console.log('[EARNINGS FORMAT] Has "Analyst Consensus & Recent Actions"?', earningsContent.includes('Analyst Consensus & Recent Actions'));
            
            // Check if content is already in the NEW format (has <ul> tags AND "Analyst Consensus & Recent Actions" subsection)
            // We want to reformat if it's in the old format (even if it has bold labels or structured lines)
            const hasNewFormatStructure = earningsContent.includes('<ul>') && earningsContent.includes('Analyst Consensus & Recent Actions');
            const hasOldFormatStructure = earningsContent.match(/^(EPS Estimate|Revenue Estimate|Analyst Consensus):/im);
            
            // Always reformat unless it's already in the new format
            if (!hasNewFormatStructure) {
              // Extract earnings data from the content - handle multiple date patterns
              // Try multiple patterns for date extraction
              // First try to match full date format: "on February 26, 2026"
              let earningsDateMatch = earningsContent.match(/(?:scheduled for|on|report on|earnings report on) ([A-Za-z]+ \d{1,2}, \d{4})/i);
              if (!earningsDateMatch) {
                // Fallback to partial date: "on February 26"
                earningsDateMatch = earningsContent.match(/(?:scheduled for|on|report on|earnings report on) ([^,]+?)(?:,|\.|$)/i);
              }
              
              // Try narrative format first, then structured format
              let epsEstimateMatch = earningsContent.match(/earnings per share of \$([\d.-]+)/i);
              let epsPriorMatch = earningsContent.match(/(?:up from|down from|compared to|from the same quarter last year|from a loss of) \$([\d.-]+)/i);
              // Match revenue with "billion"/"million" as words or "B"/"M" as letters
              let revenueEstimateMatch = earningsContent.match(/revenue of (\$[\d.]+(?:\s+)?(?:[BM]|(?:[BM]illion)))/i);
              let revenuePriorMatch = earningsContent.match(/revenue.*?(?:up from|down from|compared to|from the same quarter last year|from the prior-year period) (\$[\d.]+(?:\s+)?(?:[BM]|(?:[BM]illion)))/i);
              let consensusRatingMatch = earningsContent.match(/(?:consensus|has a) ([A-Za-z]+) rating/i);
              let priceTargetMatch = earningsContent.match(/price target of \$([\d.]+)/i);
              
              // If narrative format didn't match, try structured format (e.g., "EPS Estimate: $0.73" or "<strong>EPS Estimate</strong>: $0.73")
              if (!epsEstimateMatch) {
                epsEstimateMatch = earningsContent.match(/(?:<strong>)?EPS Estimate(?:<\/strong>)?:\s*\$([\d.-]+)/i);
                epsPriorMatch = earningsContent.match(/(?:<strong>)?EPS Estimate(?:<\/strong>)?:.*?\((?:Up|Down) from \$([\d.-]+) YoY\)/i);
              }
              if (!revenueEstimateMatch) {
                revenueEstimateMatch = earningsContent.match(/(?:<strong>)?Revenue Estimate(?:<\/strong>)?:\s*(\$[\d.]+(?:\s+)?(?:[BM]|(?:[BM]illion)))/i);
                revenuePriorMatch = earningsContent.match(/(?:<strong>)?Revenue Estimate(?:<\/strong>)?:.*?\((?:Up|Down) from (\$[\d.]+(?:\s+)?(?:[BM]|(?:[BM]illion))) YoY\)/i);
              }
              // Try to extract consensus and price target from structured format if narrative format didn't match
              let extractedRating: string | null = null;
              let extractedPriceTarget: string | null = null;
              if (!consensusRatingMatch || !priceTargetMatch) {
                const consensusLineMatch = earningsContent.match(/Analyst Consensus:\s*([A-Za-z]+) Rating.*?\(\$([\d.]+) Avg Price Target\)/i);
                if (consensusLineMatch) {
                  extractedRating = consensusLineMatch[1];
                  extractedPriceTarget = consensusLineMatch[2];
                }
              }
              
              // Check if content already has formatted lines (e.g., "EPS Estimate: $0.73" or "<strong>EPS Estimate</strong>: $0.73")
              // But we'll still extract them and reformat according to the new structure
              // Match both plain text and HTML tags
              const epsLineMatch = earningsContent.match(/(?:<strong>)?EPS Estimate(?:<\/strong>)?:\s*(.+?)(?:\n|$)/im);
              const revenueLineMatch = earningsContent.match(/(?:<strong>)?Revenue Estimate(?:<\/strong>)?:\s*(.+?)(?:\n|$)/im);
              const consensusLineMatch = earningsContent.match(/(?:<strong>)?Analyst Consensus(?:<\/strong>)?:\s*(.+?)(?:\n|$)/im);
              
              // Extract values from formatted lines if they exist
              if (epsLineMatch && !epsEstimateMatch) {
                const epsValue = epsLineMatch[1].trim();
                // Try to extract EPS estimate value
                const epsMatch = epsValue.match(/\$([\d.-]+)/);
                if (epsMatch) {
                  epsEstimateMatch = epsMatch;
                  // Try to extract prior EPS
                  const priorMatch = epsValue.match(/(?:up from|down from|Up from|Down from)\s+\$([\d.-]+)/i);
                  if (priorMatch) {
                    epsPriorMatch = priorMatch;
                  }
                }
              }
              if (revenueLineMatch && !revenueEstimateMatch) {
                const revValue = revenueLineMatch[1].trim();
                // Try to extract revenue estimate value (handle "Billion"/"Million" as words or "B"/"M" as letters)
                const revMatch = revValue.match(/(\$[\d.]+(?:\s+)?(?:[BM]|(?:[BM]illion)))/i);
                if (revMatch) {
                  revenueEstimateMatch = revMatch;
                  // Try to extract prior revenue
                  const priorMatch = revValue.match(/(?:up from|down from|Up from|Down from)\s+(\$[\d.]+(?:\s+)?(?:[BM]|(?:[BM]illion)))/i);
                  if (priorMatch) {
                    revenuePriorMatch = priorMatch;
                  }
                }
              }
              if (consensusLineMatch && (!extractedRating || !extractedPriceTarget)) {
                const consensusValue = consensusLineMatch[1].trim();
                // Extract rating and price target
                const ratingMatch = consensusValue.match(/([A-Za-z]+)\s+Rating/i);
                const targetMatch = consensusValue.match(/\$([\d.]+)/);
                if (ratingMatch && !extractedRating) {
                  extractedRating = ratingMatch[1];
                }
                if (targetMatch && !extractedPriceTarget) {
                  extractedPriceTarget = targetMatch[1];
                }
              }
              
              console.log('[EARNINGS FORMAT] Extracting data:', {
                hasDate: !!earningsDateMatch,
                dateMatch: earningsDateMatch ? earningsDateMatch[1] : null,
                hasEPS: !!epsEstimateMatch,
                hasRevenue: !!revenueEstimateMatch,
                hasConsensus: !!consensusRatingMatch,
                hasPriceTarget: !!priceTargetMatch,
                contentSample: earningsContent.substring(0, 500)
              });
              
              // Build formatted section with new structure (separate Hard Numbers from Opinions)
              let intro = '';
              let priceTargetNote = '';
              
              // Extract intro sentence with hyperlink
              const tickerUpper = ticker.toUpperCase();
              if (earningsDateMatch && earningsDateMatch[1]) {
                intro = `Investors are looking ahead to the <a href="https://www.benzinga.com/quote/${tickerUpper}/earnings">next earnings report</a> on ${earningsDateMatch[1].trim()}.`;
              } else {
                // Try to extract intro from content
                const introMatch = earningsContent.match(/^(.+?\.)(?:\n\n|\nEPS Estimate:|$)/m);
                if (introMatch) {
                  // Replace "next earnings report" with hyperlinked version if it exists
                  intro = introMatch[1].trim().replace(/next earnings report/gi, `<a href="https://www.benzinga.com/quote/${tickerUpper}/earnings">next earnings report</a>`);
                } else {
                  intro = `Investors are looking ahead to the <a href="https://www.benzinga.com/quote/${tickerUpper}/earnings">next earnings report</a>.`;
                }
              }
              
              // Build "Hard Numbers" lines (EPS, Revenue, P/E)
              const hardNumbers: string[] = [];
              
              // Use actual earnings data if available (more reliable than extraction)
              if (nextEarningsCheck && typeof nextEarningsCheck === 'object' && nextEarningsCheck.eps_estimate !== null && nextEarningsCheck.eps_estimate !== undefined) {
                const epsEst = nextEarningsCheck.eps_estimate as number | string | null | undefined;
                const epsPrior = (nextEarningsCheck.eps_prior || null) as number | string | null | undefined;
                const epsEstNum = typeof epsEst === 'string' ? parseFloat(epsEst) : (epsEst as number);
                const epsPriorNum = epsPrior ? (typeof epsPrior === 'string' ? parseFloat(epsPrior) : (epsPrior as number)) : null;
                const direction = epsPriorNum !== null ? (epsEstNum > epsPriorNum ? 'Up' : epsEstNum < epsPriorNum ? 'Down' : '') : '';
                const formattedEPS = formatEPS(epsEst);
                const formattedPrior = epsPriorNum !== null ? formatEPS(epsPrior) : '';
                hardNumbers.push(`<strong>EPS Estimate</strong>: ${formattedEPS}${epsPriorNum !== null && direction ? ` (${direction} from ${formattedPrior} YoY)` : ''}`);
              } else if (epsEstimateMatch) {
                // Fall back to extraction if actual data not available
                const epsEst = epsEstimateMatch[1];
                const epsPrior = epsPriorMatch ? epsPriorMatch[1] : null;
                const direction = epsPrior ? (parseFloat(epsEst) > parseFloat(epsPrior) ? 'Up' : parseFloat(epsEst) < parseFloat(epsPrior) ? 'Down' : '') : '';
                const formattedEPS = formatEPS(parseFloat(epsEst));
                const formattedPrior = epsPrior ? formatEPS(parseFloat(epsPrior)) : '';
                hardNumbers.push(`<strong>EPS Estimate</strong>: ${formattedEPS}${epsPrior && direction ? ` (${direction} from ${formattedPrior} YoY)` : ''}`);
              }
              
              // Use actual earnings data for revenue if available, otherwise fall back to extraction
              if (nextEarningsCheck && typeof nextEarningsCheck === 'object' && nextEarningsCheck.revenue_estimate !== null && nextEarningsCheck.revenue_estimate !== undefined) {
                // Use actual formatted revenue values from API (this fixes the "$0.08 million" issue)
                const revEstFormatted = formatRevenue(nextEarningsCheck.revenue_estimate as string | number | null);
                const revPriorFormatted = nextEarningsCheck.revenue_prior ? formatRevenue(nextEarningsCheck.revenue_prior as string | number | null) : null;
                const revEstNum = typeof nextEarningsCheck.revenue_estimate === 'string' ? parseFloat(nextEarningsCheck.revenue_estimate) : nextEarningsCheck.revenue_estimate;
                const revPriorNum = nextEarningsCheck.revenue_prior ? (typeof nextEarningsCheck.revenue_prior === 'string' ? parseFloat(nextEarningsCheck.revenue_prior) : nextEarningsCheck.revenue_prior) : null;
                const direction = revPriorNum !== null ? (revEstNum > revPriorNum ? 'Up' : revEstNum < revPriorNum ? 'Down' : '') : '';
                hardNumbers.push(`<strong>Revenue Estimate</strong>: ${revEstFormatted}${revPriorFormatted && direction ? ` (${direction} from ${revPriorFormatted} YoY)` : ''}`);
              } else if (revenueEstimateMatch) {
                // Helper to parse revenue string (e.g., "$24.89 b" or "$24.89 billion") to number in millions
                const parseRevenueString = (revStr: string): number | null => {
                  try {
                    const cleanStr = revStr.replace(/[$,]/g, '').trim();
                    const numMatch = cleanStr.match(/^([\d.]+)/);
                    if (!numMatch) return null;
                    
                    const num = parseFloat(numMatch[1]);
                    if (isNaN(num)) return null;
                    
                    // Check for billion indicator (b, B, billion, Billion, BILLION)
                    if (/b(?:illion)?/i.test(cleanStr)) {
                      return num * 1000; // Convert billions to millions
                    }
                    // Check for million indicator (m, M, million, Million, MILLION)
                    if (/m(?:illion)?/i.test(cleanStr)) {
                      return num; // Already in millions
                    }
                    // Default: assume billions if number >= 1, millions otherwise
                    return num >= 1 ? num * 1000 : num;
                  } catch {
                    return null;
                  }
                };
                
                const revEstParsed = parseRevenueString(revenueEstimateMatch[1]);
                const revPriorParsed = revenuePriorMatch ? parseRevenueString(revenuePriorMatch[1]) : null;
                
                const revEstFormatted = revEstParsed ? formatRevenue(revEstParsed) : revenueEstimateMatch[1];
                const revPriorFormatted = revPriorParsed ? formatRevenue(revPriorParsed) : (revenuePriorMatch ? revenuePriorMatch[1] : null);
                
                const direction = revEstParsed && revPriorParsed ? (revEstParsed > revPriorParsed ? 'Up' : revEstParsed < revPriorParsed ? 'Down' : '') : '';
                hardNumbers.push(`<strong>Revenue Estimate</strong>: ${revEstFormatted}${revPriorFormatted && direction ? ` (${direction} from ${revPriorFormatted} YoY)` : ''}`);
              }
              
              // Add P/E ratio if available (use post-processing values)
              if (peRatioForPost) {
                const peLabel = useForwardPEForPost ? 'Forward P/E' : 'P/E';
                const peAssessment = peRatioForPost > 25 ? 'premium valuation' : peRatioForPost < 15 ? 'value opportunity' : 'fair valuation';
                hardNumbers.push(`<strong>Valuation</strong>: ${peLabel} of ${peRatioForPost.toFixed(1)}x (Indicates ${peAssessment})`);
              }
              
              // Extract consensus data for "Analyst Consensus & Recent Actions" subsection
              // But only use it if we have validated data from API
              let ratingValue: string | null = null;
              let targetValue: string | null = null;
              
              // Only use consensus data if we have validated data from API (not just extracted from stale content)
              if (consensusRatingsForPost) {
                const validation = validateAnalystData(
                  consensusRatingsForPost,
                  recentAnalystActionsForPost || [],
                  technicalData.currentPrice
                );
                
                // Only use rating/target if validation passes
                if (validation.isValid) {
                  ratingValue = consensusRatingsForPost.consensus_rating 
                    ? consensusRatingsForPost.consensus_rating.charAt(0) + consensusRatingsForPost.consensus_rating.slice(1).toLowerCase()
                    : null;
                  
                  if (validation.shouldShowPriceTarget && consensusRatingsForPost.consensus_price_target) {
                    targetValue = consensusRatingsForPost.consensus_price_target.toString();
                  }
                }
              }
              
              // Extract recent analyst actions - ONLY use validated data from API, never extract from stale content
              let analystActionsHTML = '';
              if (recentAnalystActionsForPost && recentAnalystActionsForPost.length > 0) {
                // Format as HTML bullet points with bold firm names and dates
                const analystBullets = recentAnalystActionsForPost.map((action: any) => {
                  let dateStr = '';
                  if (action.date) {
                    try {
                      // Use date string directly from API - no Date object conversion (avoids timezone issues)
                      const dateString = String(action.date);
                      // Extract year from date string (YYYY-MM-DD format) to determine if year should be included
                      const dateMatch = dateString.match(/^(\d{4})-/);
                      const currentYear = new Date().getFullYear();
                      const actionYear = dateMatch ? parseInt(dateMatch[1], 10) : currentYear;
                      const formattedDate = formatDateAPStyle(dateString, actionYear < currentYear);
                      if (formattedDate) {
                        dateStr = ` (${formattedDate})`;
                      }
                    } catch (e) {
                      // If date parsing fails, skip date
                    }
                  }
                  return `  <li><strong>${action.firm}</strong>: ${action.action}${dateStr}</li>`;
                }).join('\n');
                analystActionsHTML = `<ul>\n${analystBullets}\n</ul>`;
              }
              // DO NOT extract from content - only use validated API data
              
              // Generate Valuation Insight with analysis
              if (peRatioForPost && ratingValue && targetValue && technicalData.currentPrice) {
                const target = parseFloat(targetValue);
                const currentPrice = technicalData.currentPrice;
                const priceDiff = ((target - currentPrice) / currentPrice) * 100;
                
                // Calculate earnings growth if we have EPS estimates
                let earningsGrowthText = '';
                if (epsEstimateMatch && epsPriorMatch) {
                  const epsEst = parseFloat(epsEstimateMatch[1]);
                  const epsPrior = parseFloat(epsPriorMatch[1]);
                  if (epsPrior !== 0 && !isNaN(epsEst) && !isNaN(epsPrior)) {
                    const growthPercent = ((epsEst - epsPrior) / Math.abs(epsPrior)) * 100;
                    if (growthPercent > 0) {
                      earningsGrowthText = `${Math.round(growthPercent)}% expected earnings growth`;
                    } else if (growthPercent < 0) {
                      earningsGrowthText = `${Math.abs(Math.round(growthPercent))}% expected earnings decline`;
                    }
                  }
                }
                
                // Build valuation insight based on P/E, consensus, and price target
                const peAssessment = peRatioForPost > 25 ? 'premium P/E multiple' : peRatioForPost < 15 ? 'value P/E multiple' : 'fair P/E multiple';
                const ratingStrength = ratingValue.toLowerCase().includes('buy') || ratingValue.toLowerCase().includes('strong buy') ? 'strong consensus' : 'consensus';
                
                // Build the insight text
                let insightText = `While the stock trades at a ${peAssessment}, the ${ratingStrength}`;
                if (earningsGrowthText) {
                  insightText += ` and ${earningsGrowthText}`;
                } else {
                  insightText += ' and rising estimates';
                }
                insightText += ` suggest analysts view ${earningsGrowthText ? 'this growth' : 'the growth prospects'} as justification for ${priceDiff > 0 ? `the ${Math.round(priceDiff)}% upside to analyst targets` : 'the current valuation'}.`;
                
                priceTargetNote = `\n\n<strong>Valuation Insight:</strong> <em>${insightText}</em>`;
              } else if (peRatioForPost && ratingValue) {
                // Simplified version if we don't have price target
                const peAssessment = peRatioForPost > 25 ? 'premium P/E multiple' : peRatioForPost < 15 ? 'value P/E multiple' : 'fair P/E multiple';
                const ratingStrength = ratingValue.toLowerCase().includes('buy') || ratingValue.toLowerCase().includes('strong buy') ? 'strong consensus' : 'consensus';
                priceTargetNote = `\n\n<strong>Valuation Insight:</strong> <em>The stock trades at a ${peAssessment}, with ${ratingStrength} supporting the current valuation.</em>`;
              }
              
              // Format the section if we have data
              if (hardNumbers.length > 0 || ratingValue || targetValue || analystActionsHTML) {
                // Build the formatted section
                let formattedSection = `${intro}\n\n`;
                
                // Add "Hard Numbers" bullet points
                if (hardNumbers.length > 0) {
                  formattedSection += `<ul>\n${hardNumbers.map(l => `  <li>${l}</li>`).join('\n')}\n</ul>`;
                }
                
                // Add "Analyst Consensus & Recent Actions" subsection ONLY if we have valid, recent data
                // Skip entirely if no valid consensus rating/target AND no recent actions
                const hasValidRatingOrTarget = ratingValue || targetValue;
                const hasRecentActions = recentAnalystActionsForPost && recentAnalystActionsForPost.length > 0;
                
                if (hasValidRatingOrTarget || hasRecentActions) {
                  formattedSection += `\n\n<strong>Analyst Consensus & Recent Actions:</strong>\n`;
                  
                  if (ratingValue && targetValue) {
                    const rating = ratingValue.charAt(0) + ratingValue.slice(1).toLowerCase();
                    const target = parseFloat(targetValue);
                    const tickerUpper = ticker.toUpperCase();
                    formattedSection += `The stock carries a <strong>${rating}</strong> Rating with an <a href="https://www.benzinga.com/quote/${tickerUpper}/analyst-ratings">average price target</a> of <strong>$${target.toFixed(2)}</strong>.`;
                  } else if (ratingValue) {
                    const rating = ratingValue.charAt(0) + ratingValue.slice(1).toLowerCase();
                    formattedSection += `The stock carries a <strong>${rating}</strong> Rating.`;
                  } else if (targetValue) {
                    const target = parseFloat(targetValue);
                    formattedSection += `The stock has an average price target of <strong>$${target.toFixed(2)}</strong>.`;
                  }
                  
                  if (hasRecentActions && analystActionsHTML) {
                    formattedSection += ` Recent analyst moves include:\n${analystActionsHTML}`;
                  }
                } else {
                  console.log(`[EARNINGS FORMAT] [ANALYST VALIDATION] ${ticker}: Skipping "Analyst Consensus & Recent Actions" subsection - no valid recent data`);
                }
                
                formattedSection += priceTargetNote;
                
                // Replace the entire earnings content with the formatted version
                const beforeEarnings = analysisWithPriceAction.substring(0, earningsSectionMatch.index + earningsSectionMatch[0].length);
                const afterEarnings = analysisWithPriceAction.substring(earningsSectionMatch.index + earningsSectionMatch[0].length + earningsSectionEnd);
                analysisWithPriceAction = `${beforeEarnings}\n\n${formattedSection}\n\n${afterEarnings}`;
                console.log('✅ Formatted Earnings & Analyst Outlook section with P/E and recent analyst actions');
              } else {
                console.log('⚠️ Could not extract earnings data from content - regex patterns may need updating');
                console.log('Earnings content sample:', earningsContent.substring(0, 500));
              }
            } else {
              console.log('✅ Earnings section already in new format (has <ul> and "Analyst Consensus & Recent Actions" subsection)');
            }
          } else {
            console.log('⚠️ Earnings section marker not found in analysis');
          }
          
          // Post-process Technical Analysis section to extract and format Key Levels
          const technicalSectionMarker = /##\s*Section:\s*Technical\s*Analysis/i;
          const technicalSectionMatch = analysisWithPriceAction.match(technicalSectionMarker);
          if (technicalSectionMatch && technicalSectionMatch.index !== undefined) {
            const afterTechnicalMarker = analysisWithPriceAction.substring(technicalSectionMatch.index + technicalSectionMatch[0].length);
            const nextSectionMatch = afterTechnicalMarker.match(/(##\s*Section:|##\s*Top\s*ETF|Price Action:)/i);
            const technicalSectionEnd = nextSectionMatch ? nextSectionMatch.index! : afterTechnicalMarker.length;
            const technicalContent = afterTechnicalMarker.substring(0, technicalSectionEnd);
            
            // Extract support and resistance levels
            const supportMatch = technicalContent.match(/(?:Key\s+)?support\s+(?:is\s+at|at)\s+\$([\d.]+)/i);
            const resistanceMatch = technicalContent.match(/(?:Key\s+)?resistance\s+(?:is\s+at|at)\s+\$([\d.]+)/i);
            
            if (supportMatch || resistanceMatch) {
              // Check if Key Levels are already formatted as bullet points
              const hasBulletFormat = technicalContent.includes('<ul>') && technicalContent.includes('Key Resistance') && technicalContent.includes('Key Support');
              
              // Also check if they exist in plain text format (need to replace)
              const hasPlainTextFormat = technicalContent.includes('Key Resistance:') || technicalContent.includes('Key Support:');
              
              if (!hasBulletFormat) {
                // Round to nearest $0.50
                const roundToHalf = (val: number) => Math.round(val * 2) / 2;
                const support = supportMatch ? roundToHalf(parseFloat(supportMatch[1])).toFixed(2) : null;
                const resistance = resistanceMatch ? roundToHalf(parseFloat(resistanceMatch[1])).toFixed(2) : null;
                
                if (support || resistance) {
                  // If plain text format exists, remove it first
                  let cleanedTechnicalContent = technicalContent;
                  if (hasPlainTextFormat) {
                    // Remove existing plain text Key Resistance/Support lines
                    cleanedTechnicalContent = cleanedTechnicalContent.replace(/Key\s+Resistance:\s*\$\d+\.\d+\s*\n?/gi, '');
                    cleanedTechnicalContent = cleanedTechnicalContent.replace(/Key\s+Support:\s*\$\d+\.\d+\s*\n?/gi, '');
                  }
                  
                  // Find the end of the last paragraph in technical section
                  const lastParagraphEnd = cleanedTechnicalContent.lastIndexOf('</p>');
                  const beforeLastParagraph = cleanedTechnicalContent.substring(0, lastParagraphEnd !== -1 ? lastParagraphEnd + 4 : cleanedTechnicalContent.length);
                  const afterLastParagraph = cleanedTechnicalContent.substring(lastParagraphEnd !== -1 ? lastParagraphEnd + 4 : cleanedTechnicalContent.length);
                  
                  // Build Key Levels section as bullet points
                  const keyLevelBullets: string[] = [];
                  if (resistance) {
                    keyLevelBullets.push(`<strong>Key Resistance</strong>: $${resistance}`);
                  }
                  if (support) {
                    keyLevelBullets.push(`<strong>Key Support</strong>: $${support}`);
                  }
                  const keyLevels = keyLevelBullets.length > 0 
                    ? `\n\n<ul>\n${keyLevelBullets.map(b => `  <li>${b}</li>`).join('\n')}\n</ul>`
                    : '';
                  
                  // Update the technical section
                  const beforeTechnical = analysisWithPriceAction.substring(0, technicalSectionMatch.index + technicalSectionMatch[0].length);
                  const updatedTechnicalContent = `${beforeLastParagraph}${keyLevels}${afterLastParagraph}`;
                  const afterTechnical = analysisWithPriceAction.substring(technicalSectionMatch.index + technicalSectionMatch[0].length + technicalSectionEnd);
                  analysisWithPriceAction = `${beforeTechnical}\n\n${updatedTechnicalContent}${afterTechnical}`;
                  console.log('✅ Extracted and formatted Key Levels from Technical Analysis');
                }
              }
            }
          }
        } else {
          console.log('No related articles available');
        }
        
        // Add ETF section and Price Action section AFTER all section ordering is complete
        // Find where to insert ETF section (before "## Section: Price Action" or before price action line)
        const priceActionSectionMarker = /##\s*Section:\s*Price Action/i;
        const priceActionMarkerMatch = analysisWithPriceAction.match(priceActionSectionMarker);
        const priceActionTextMatch = analysisWithPriceAction.match(/(?:<strong>.*?)?Price Action:(?:<\/strong>)?/i);
        
        if (etfInfo) {
          // Insert ETF section before Price Action section marker or price action line
          if (priceActionMarkerMatch && priceActionMarkerMatch.index !== undefined) {
            // Insert before "## Section: Price Action"
            const beforePriceAction = analysisWithPriceAction.substring(0, priceActionMarkerMatch.index).trim();
            const afterPriceAction = analysisWithPriceAction.substring(priceActionMarkerMatch.index);
            analysisWithPriceAction = `${beforePriceAction}${etfInfo}\n\n${afterPriceAction}`;
            console.log('✅ Added ETF section before Price Action section marker');
          } else if (priceActionTextMatch && priceActionTextMatch.index !== undefined) {
            // Insert before price action line (if no section marker)
            const beforePriceAction = analysisWithPriceAction.substring(0, priceActionTextMatch.index).trim();
            const afterPriceAction = analysisWithPriceAction.substring(priceActionTextMatch.index);
            analysisWithPriceAction = `${beforePriceAction}${etfInfo}\n\n${afterPriceAction}`;
            console.log('✅ Added ETF section before price action line');
          } else {
            // No price action found, append ETF section at the end
            analysisWithPriceAction = `${analysisWithPriceAction.trim()}${etfInfo}`;
            console.log('✅ Added ETF section at the end (no price action found)');
          }
        }
        
        // Add Price Action section marker and price action line if not already present
        if (priceAction) {
          const hasPriceActionMarker = !!priceActionMarkerMatch;
          const hasPriceActionText = !!priceActionTextMatch;
          
          if (!hasPriceActionMarker && !hasPriceActionText) {
            // No price action found, add section marker and price action line at the end
            analysisWithPriceAction += `\n\n## Section: Price Action\n\n${priceAction}`;
            console.log('✅ Added Price Action section marker and price action line at the end');
          } else if (!hasPriceActionMarker && hasPriceActionText) {
            // Price action text exists but no section marker - add marker before it
            if (priceActionTextMatch && priceActionTextMatch.index !== undefined) {
              const beforePriceAction = analysisWithPriceAction.substring(0, priceActionTextMatch.index).trim();
              const afterPriceAction = analysisWithPriceAction.substring(priceActionTextMatch.index);
              analysisWithPriceAction = `${beforePriceAction}\n\n## Section: Price Action\n\n${afterPriceAction}`;
              console.log('✅ Added Price Action section marker before existing price action text');
            }
          }
          // If both marker and text exist, do nothing (already present)
        }
        
        // Now insert "Read Next" at the VERY END, after ETF and Price Action sections
        // Only add "Read Next" if we have a different article (at least 2 articles) to avoid duplicate links
        if (relatedArticles && relatedArticles.length > 1) {
          // Remove any existing "Read Next" section first (it might have been added earlier by AI or other logic)
          const readNextPattern = /<p>Read Next:.*?<\/p>/gi;
          analysisWithPriceAction = analysisWithPriceAction.replace(readNextPattern, '').trim();
          // Also handle plain text format (no <p> tags)
          const readNextPlainPattern = /Read Next:.*?(?=\n\n|$)/gi;
          analysisWithPriceAction = analysisWithPriceAction.replace(readNextPlainPattern, '').trim();
          
          // Use the second article (index 1) for "Read Next" to ensure it's different from "Also Read" (index 0)
          const readNextArticle = relatedArticles[1];
          // Always use HTML link format (for clickable links)
          const readNextSection = `<p>Read Next: <a href="${readNextArticle.url}">${readNextArticle.headline}</a></p>`;
          
          // Append to the very end of the content
          analysisWithPriceAction = `${analysisWithPriceAction.trim()}\n\n${readNextSection}`;
          console.log('✅ Added "Read Next" section at the very end (after ETF and Price Action)');
        } else if (relatedArticles && relatedArticles.length === 1) {
          console.log('⚠️ Only one related article available, skipping "Read Next" to avoid duplicate link');
        }

        return {

          ticker,

          companyName: technicalData.companyName,

          analysis: analysisWithPriceAction,

          data: {

            currentPrice: technicalData.currentPrice,

            changePercent: technicalData.changePercent,

            twelveMonthReturn: technicalData.twelveMonthReturn,

            rsi: technicalData.rsi,

            rsiSignal: technicalData.rsiSignal,

            supportLevel: technicalData.supportLevel,

            resistanceLevel: technicalData.resistanceLevel,

            sma20: technicalData.sma20,

            sma50: technicalData.sma50,

            sma100: technicalData.sma100,

            sma200: technicalData.sma200

          }

        };

      })

    );

    

    return NextResponse.json({ analyses });

  } catch (error) {

    console.error('Error generating technical analysis:', error);

    return NextResponse.json(

      { error: 'Failed to generate technical analysis.' },

      { status: 500 }

    );

  }

}
