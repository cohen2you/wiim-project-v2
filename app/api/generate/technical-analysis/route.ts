import { NextResponse } from 'next/server';

import { aiProvider, AIProvider } from '@/lib/aiProvider';

const BZ_NEWS_URL = 'https://api.benzinga.com/api/v2/news';



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

// Generate price action using Benzinga API (Price Action Only mode)
async function generatePriceAction(ticker: string): Promise<string> {
  try {
    const url = `https://api.benzinga.com/api/v2/quoteDelayed?token=${process.env.BENZINGA_API_KEY}&symbols=${ticker}`;
    const res = await fetch(url);
    
    if (!res.ok) {
      console.error(`Failed to fetch price action for ${ticker}:`, res.statusText);
      return '';
    }
    
    const data = await res.json();
    if (!data || typeof data !== 'object') {
      return '';
    }
    
    const quote = data[ticker.toUpperCase()];
    if (!quote || typeof quote !== 'object') {
      return '';
    }
    
    const symbol = quote.symbol ?? ticker.toUpperCase();
    const companyName = normalizeCompanyName(quote.name ?? symbol);
    const lastPrice = formatPriceValue(quote.lastTradePrice);
    
    if (!symbol || !quote.lastTradePrice) {
      return '';
    }
    
    const marketStatus = getMarketStatusTimeBased();
    
    // Get current day name in Eastern Time (not the close date, which might be previous day)
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'long',
    });
    const dayOfWeek = formatter.format(now);
    
    let marketStatusPhrase = '';
    if (marketStatus === 'premarket') {
      marketStatusPhrase = ' during premarket trading';
    } else if (marketStatus === 'afterhours') {
      marketStatusPhrase = ' during after-hours trading';
    } else if (marketStatus === 'closed') {
      marketStatusPhrase = ' while the market was closed';
    }
    
    // ALWAYS calculate regular session change from close vs previousClosePrice (matches main article calculation)
    // This ensures consistency - the price action line uses the same calculation as the article lede
    let regularSessionChange = 0;
    let afterHoursChange = 0;
    let hasAfterHoursData = false;
    let regularSessionClose = 0;
    
    // Calculate regular session change (close vs previousClosePrice)
    const quoteClose = typeof quote.close === 'number' ? quote.close : (quote.close ? parseFloat(quote.close) : null);
    const quotePreviousClose = typeof quote.previousClosePrice === 'number' ? quote.previousClosePrice : 
                               (typeof quote.previousClose === 'number' ? quote.previousClose : 
                               (quote.previousClosePrice ? parseFloat(quote.previousClosePrice) : 
                               (quote.previousClose ? parseFloat(quote.previousClose) : null)));
    
    // When markets are closed (holiday), use lastTradePrice as the close if it's more recent/relevant
    let effectiveClose = quoteClose;
    if (marketStatus === 'closed' && quote.lastTradePrice) {
      const lastTrade = typeof quote.lastTradePrice === 'number' ? quote.lastTradePrice : parseFloat(quote.lastTradePrice);
      if (!isNaN(lastTrade) && lastTrade > 0) {
        // Use lastTradePrice as the close when markets are closed (it should be the most recent trading day's close)
        effectiveClose = lastTrade;
        console.log(`[PRICE ACTION] Markets closed - using lastTradePrice as close: ${effectiveClose}`);
      }
    }
    
    if (effectiveClose && quotePreviousClose && quotePreviousClose > 0 && !isNaN(effectiveClose) && !isNaN(quotePreviousClose)) {
      regularSessionClose = effectiveClose;
      regularSessionChange = ((effectiveClose - quotePreviousClose) / quotePreviousClose) * 100;
      console.log(`[PRICE ACTION] Regular session change: ${regularSessionChange.toFixed(2)}% (close: ${effectiveClose}, previousClose: ${quotePreviousClose})`);
    } else if (quote.change && quotePreviousClose && quotePreviousClose > 0) {
      // Fallback: calculate from change amount
      const quoteChange = typeof quote.change === 'number' ? quote.change : parseFloat(quote.change);
      if (!isNaN(quoteChange)) {
        regularSessionClose = quotePreviousClose + quoteChange;
        regularSessionChange = (quoteChange / quotePreviousClose) * 100;
        console.log(`[PRICE ACTION] Regular session change from change amount: ${regularSessionChange.toFixed(2)}%`);
      }
    }
    
    // Calculate after-hours change if we have after-hours data
    if (marketStatus === 'afterhours' && regularSessionClose > 0 && quote.lastTradePrice) {
      const lastTrade = typeof quote.lastTradePrice === 'number' ? quote.lastTradePrice : parseFloat(quote.lastTradePrice);
      if (!isNaN(lastTrade) && lastTrade !== regularSessionClose) {
        afterHoursChange = ((lastTrade - regularSessionClose) / regularSessionClose) * 100;
      hasAfterHoursData = true;
        console.log(`[PRICE ACTION] After-hours change: ${afterHoursChange.toFixed(2)}% (lastTrade: ${lastTrade}, close: ${regularSessionClose})`);
      }
    }
    
    // For premarket, calculate premarket change (current price vs previous close)
    let premarketChange = 0;
    if (marketStatus === 'premarket' && quotePreviousClose && quotePreviousClose > 0 && quote.lastTradePrice) {
      const premarketPrice = typeof quote.lastTradePrice === 'number' ? quote.lastTradePrice : parseFloat(quote.lastTradePrice);
      if (!isNaN(premarketPrice)) {
        premarketChange = ((premarketPrice - quotePreviousClose) / quotePreviousClose) * 100;
        console.log(`[PRICE ACTION] Premarket change: ${premarketChange.toFixed(2)}% (premarketPrice: ${premarketPrice}, previousClose: ${quotePreviousClose})`);
      }
    }
    
    let priceActionText = '';
    
    // When markets are closed (holiday/weekend), use previous trading day's regular session data
    if (marketStatus === 'closed' && regularSessionChange !== 0) {
      // Markets are closed: show previous trading day's regular session close
      const regularUpDown = regularSessionChange > 0 ? 'up' : regularSessionChange < 0 ? 'down' : 'unchanged';
      const absRegularChange = Math.abs(regularSessionChange).toFixed(2);
      // Use the regular session close price, not the current lastTradePrice
      const closePrice = formatPriceValue(regularSessionClose || quoteClose || quote.lastTradePrice);
      priceActionText = `<strong>${symbol} Price Action:</strong> ${companyName} shares were ${regularUpDown} ${absRegularChange}% at $${closePrice}${marketStatusPhrase} on ${dayOfWeek}`;
    } else if (marketStatus === 'premarket' && premarketChange !== 0) {
      // Premarket: use premarket change
      const premarketUpDown = premarketChange > 0 ? 'up' : premarketChange < 0 ? 'down' : 'unchanged';
      const absPremarketChange = Math.abs(premarketChange).toFixed(2);
      priceActionText = `<strong>${symbol} Price Action:</strong> ${companyName} shares were ${premarketUpDown} ${absPremarketChange}% at $${lastPrice}${marketStatusPhrase} on ${dayOfWeek}`;
    } else if (marketStatus === 'afterhours' && hasAfterHoursData && regularSessionChange !== 0) {
      // After-hours: show both regular session and after-hours changes
      const regularUpDown = regularSessionChange > 0 ? 'up' : regularSessionChange < 0 ? 'down' : 'unchanged';
      const afterHoursUpDown = afterHoursChange > 0 ? 'up' : afterHoursChange < 0 ? 'down' : 'unchanged';
      const absRegularChange = Math.abs(regularSessionChange).toFixed(2);
      const absAfterHoursChange = Math.abs(afterHoursChange).toFixed(2);
      priceActionText = `<strong>${symbol} Price Action:</strong> ${companyName} shares were ${regularUpDown} ${absRegularChange}% during regular trading and ${afterHoursUpDown} ${absAfterHoursChange}% in after-hours trading on ${dayOfWeek}, last trading at $${lastPrice}`;
    } else if (regularSessionChange !== 0) {
      // Regular trading (open): use regular session change
      const regularUpDown = regularSessionChange > 0 ? 'up' : regularSessionChange < 0 ? 'down' : 'unchanged';
      const absRegularChange = Math.abs(regularSessionChange).toFixed(2);
      if (marketStatus === 'open') {
        priceActionText = `<strong>${symbol} Price Action:</strong> ${companyName} shares were ${regularUpDown} ${absRegularChange}% at $${lastPrice} at the time of publication on ${dayOfWeek}`;
      } else {
        priceActionText = `<strong>${symbol} Price Action:</strong> ${companyName} shares were ${regularUpDown} ${absRegularChange}% at $${lastPrice}${marketStatusPhrase} on ${dayOfWeek}`;
      }
    } else {
      // Fallback: use changePercent if regular session calculation failed
      const changePercent = typeof quote.changePercent === 'number' ? quote.changePercent : 0;
      const upDown = changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : 'unchanged';
      const absChange = Math.abs(changePercent).toFixed(2);
      console.log(`[PRICE ACTION] Fallback to changePercent: ${changePercent.toFixed(2)}%`);
      if (marketStatus === 'open') {
        priceActionText = `<strong>${symbol} Price Action:</strong> ${companyName} shares were ${upDown} ${absChange}% at $${lastPrice} at the time of publication on ${dayOfWeek}`;
    } else {
      priceActionText = `<strong>${symbol} Price Action:</strong> ${companyName} shares were ${upDown} ${absChange}% at $${lastPrice}${marketStatusPhrase} on ${dayOfWeek}`;
      }
    }
    
    // Add 52-week range context if available
    if (quote.fiftyTwoWeekLow && quote.fiftyTwoWeekHigh && quote.lastTradePrice) {
      const currentPrice = quote.lastTradePrice;
      const yearLow = quote.fiftyTwoWeekLow;
      const yearHigh = quote.fiftyTwoWeekHigh;
      
      let rangeText = '';
      
      if (currentPrice > yearHigh) {
        rangeText = `. The stock is trading at a new 52-week high`;
      } else if (currentPrice < yearLow) {
        rangeText = `. The stock is trading at a new 52-week low`;
      } else {
        const rangePosition = (currentPrice - yearLow) / (yearHigh - yearLow);
        
        if (rangePosition >= 0.95) {
          rangeText = `. The stock is trading near its 52-week high of $${formatPriceValue(yearHigh)}`;
        } else if (rangePosition <= 0.03) {
          rangeText = `. The stock is trading near its 52-week low of $${formatPriceValue(yearLow)}`;
        } else if (rangePosition >= 0.90) {
          rangeText = `. The stock is approaching its 52-week high of $${formatPriceValue(yearHigh)}`;
        } else if (rangePosition <= 0.05) {
          rangeText = `. The stock is near its 52-week low of $${formatPriceValue(yearLow)}`;
        }
      }
      
      if (rangeText) {
        priceActionText += rangeText;
      }
    }
    
    priceActionText += ', according to Benzinga Pro data.';
    
    return priceActionText;
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

    

    const [snapshot, overview, ratios, benzingaData] = await Promise.all([

      snapshotRes.json(),

      overviewRes.json(),

      ratiosRes.ok ? ratiosRes.json() : null,

      benzingaRes.ok ? benzingaRes.json() : null

    ]);

    

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

    

    const overviewData = overview.results;

    const companyName = overviewData?.name || symbol;
    const exchangeCode = overviewData?.primary_exchange || overviewData?.market || null;
    const companyNameWithExchange = formatCompanyNameWithExchange(companyName, symbol, exchangeCode);

    const marketCap = overviewData?.market_cap || 0;

    

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
    
    // Use calendar/consensus-ratings endpoint as specified
    const consensusUrl = `https://api.benzinga.com/api/v2/calendar/consensus-ratings?${params.toString()}`;
    
    const consensusRes = await fetch(consensusUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
    });
      
    if (consensusRes.ok) {
      const consensusData = await consensusRes.json();
      
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
          return consensus;
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error fetching consensus ratings:', error);
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
          return {
            date: earningsDate,
            eps_estimate: nextEarnings.eps_estimate || nextEarnings.epsEstimate || null,
            eps_prior: nextEarnings.eps_prior || nextEarnings.epsPrior || null,
            revenue_estimate: nextEarnings.revenue_estimate || nextEarnings.revenueEstimate || null,
            revenue_prior: nextEarnings.revenue_prior || nextEarnings.revenuePrior || null,
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

    const dayOfWeek = dayNames[today.getDay()];

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

    // Fetch consensus ratings and earnings date for analyst overview and P/E sections
    const [consensusRatings, nextEarnings] = await Promise.all([
      fetchConsensusRatings(data.symbol),
      fetchNextEarningsDate(data.symbol)
    ]);
    
    // Handle earnings data - could be string (old format) or object (new format)
    const nextEarningsDate = typeof nextEarnings === 'string' ? nextEarnings : nextEarnings?.date || null;

    // Fetch P/E ratio from Benzinga quote API
    let peRatio: number | null = null;
    try {
      const BENZINGA_API_KEY = process.env.BENZINGA_API_KEY;
      if (BENZINGA_API_KEY) {
        const benzingaRes = await fetch(`https://api.benzinga.com/api/v2/quoteDelayed?token=${BENZINGA_API_KEY}&symbols=${data.symbol}`);
        if (benzingaRes.ok) {
          const benzingaData = await benzingaRes.json();
          if (benzingaData && benzingaData[data.symbol]) {
            const quote = benzingaData[data.symbol];
            peRatio = quote.pe || quote.priceEarnings || quote.pe_ratio || null;
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

    

    const prompt = `You are a professional technical analyst writing a comprehensive stock analysis focused on longer-term trends and technical indicators. Today is ${dayOfWeek}.

CURRENT MARKET STATUS: ${marketStatus === 'open' ? 'Markets are currently OPEN' : marketStatus === 'premarket' ? 'Markets are in PREMARKET trading' : marketStatus === 'afterhours' ? 'Markets are CLOSED (after-hours session ended)' : 'Markets are CLOSED'}

CRITICAL: Adjust your language based on market status:
- If markets are OPEN or in PREMARKET: Use present tense (e.g., "the market is experiencing", "the sector is gaining", "stocks are trading")
- If markets are CLOSED or AFTER-HOURS: Use past tense (e.g., "the market experienced", "the sector gained", "stocks closed", "on the trading day")



STOCK: ${data.companyNameWithExchange || `${data.companyName} (${data.symbol})`}

Current Price: $${formatPrice(data.currentPrice)}${marketStatus === 'afterhours' && data.regularSessionClosePrice ? `
Regular Session Close Price: $${formatPrice(data.regularSessionClosePrice)}
CRITICAL: During after-hours, the "Current Price" above is the AFTER-HOURS price. When writing about the closing price in the lede, use ONLY the "Regular Session Close Price" shown above, or better yet, DO NOT include a specific closing price amount in the lede - only mention the direction (up/down) and day. The specific closing price is already provided in the price action line at the bottom of the article.` : ''}

${marketStatus === 'premarket' ? `Premarket Change: ${data.changePercent.toFixed(2)}%

CRITICAL: The "Premarket Change" value above is the PREMARKET change percentage (current premarket price vs previous day's close). Use this value to determine if shares are UP or DOWN during premarket trading. ${data.changePercent >= 0 ? 'Shares are UP during premarket trading.' : 'Shares are DOWN during premarket trading.'} Use this direction when writing the lead paragraph and comparison line.` : `Daily Change (REGULAR SESSION ONLY): ${data.changePercent.toFixed(2)}%

CRITICAL: The "Daily Change (REGULAR SESSION ONLY)" value above is the REGULAR TRADING SESSION change percentage only (does NOT include after-hours movement). Use this value to determine if shares were UP or DOWN during regular trading. ${data.changePercent >= 0 ? 'Shares were UP during regular trading.' : 'Shares were DOWN during regular trading.'} Use this direction when writing the lead paragraph and comparison line.`}

${sectorPerformance && sp500Change !== null ? `
COMPARISON LINE (USE THIS EXACT FORMAT AT THE START OF THE ARTICLE, IMMEDIATELY AFTER THE HEADLINE):
${data.companyNameWithExchange || data.companyName} stock is ${data.changePercent >= 0 ? 'up' : 'down'} approximately ${Math.abs(data.changePercent).toFixed(1)}% on ${dayOfWeek} versus a ${sectorPerformance.sectorChange.toFixed(1)}% ${sectorPerformance.sectorChange >= 0 ? 'gain' : 'loss'} in the ${sectorPerformance.sectorName} sector and a ${Math.abs(sp500Change).toFixed(1)}% ${sp500Change >= 0 ? 'gain' : 'loss'} in the S&P 500.

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

- Current Position: ${data.fiftyTwoWeekHigh && data.fiftyTwoWeekLow && data.currentPrice ? 

  `${(((data.currentPrice - data.fiftyTwoWeekLow) / (data.fiftyTwoWeekHigh - data.fiftyTwoWeekLow)) * 100).toFixed(1)}% of range` : 'N/A'}



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

${consensusRatings || nextEarnings ? `
EARNINGS AND ANALYST OUTLOOK SECTION (forward-looking):
After the technical analysis section, you MUST include a separate section with the header "## Section: Earnings & Analyst Outlook". This section should be forward-looking and set expectations.

${nextEarnings ? `
UPCOMING EARNINGS DATA:
- Next Earnings Date: ${typeof nextEarnings === 'object' && nextEarnings.date ? new Date(nextEarnings.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : nextEarningsDate ? new Date(nextEarningsDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'Not available'}
${typeof nextEarnings === 'object' && nextEarnings.eps_estimate ? `- EPS Estimate: $${parseFloat(nextEarnings.eps_estimate.toString()).toFixed(2)}` : ''}
${typeof nextEarnings === 'object' && nextEarnings.eps_prior ? `- Previous EPS: $${parseFloat(nextEarnings.eps_prior.toString()).toFixed(2)}` : ''}
${typeof nextEarnings === 'object' && nextEarnings.revenue_estimate ? `- Revenue Estimate: $${(parseFloat(nextEarnings.revenue_estimate.toString()) / 1000000).toFixed(2)}M` : ''}
${typeof nextEarnings === 'object' && nextEarnings.revenue_prior ? `- Previous Revenue: $${(parseFloat(nextEarnings.revenue_prior.toString()) / 1000000).toFixed(2)}M` : ''}

CRITICAL: This content MUST appear under "## Section: Earnings & Analyst Outlook" header. Write a forward-looking paragraph (2 sentences) that anticipates the upcoming earnings report. Mention the earnings date and any estimates if available. Format: "Investors are looking ahead to the company's next earnings report, scheduled for ${typeof nextEarnings === 'object' && nextEarnings.date ? new Date(nextEarnings.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : nextEarningsDate ? new Date(nextEarningsDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'a date to be announced'}. ${typeof nextEarnings === 'object' && nextEarnings.eps_estimate ? `Analysts are expecting earnings per share of $${parseFloat(nextEarnings.eps_estimate.toString()).toFixed(2)}${typeof nextEarnings === 'object' && nextEarnings.eps_prior ? `, compared to $${parseFloat(nextEarnings.eps_prior.toString()).toFixed(2)} in the previous quarter` : ''}.` : 'The report will provide key insights into the company\'s financial performance and outlook.'}"
` : ''}

${consensusRatings ? `
ANALYST OUTLOOK DATA:
- Consensus Rating: ${consensusRatings.consensus_rating ? consensusRatings.consensus_rating.charAt(0) + consensusRatings.consensus_rating.slice(1).toLowerCase() : 'N/A'}
- Consensus Price Target: ${consensusRatings.consensus_price_target ? '$' + parseFloat(consensusRatings.consensus_price_target.toString()).toFixed(2) : 'N/A'}
${consensusRatings.high_price_target ? `- High Price Target: $${parseFloat(consensusRatings.high_price_target.toString()).toFixed(2)}` : ''}
${consensusRatings.low_price_target ? `- Low Price Target: $${parseFloat(consensusRatings.low_price_target.toString()).toFixed(2)}` : ''}
${consensusRatings.total_analyst_count ? `- Total Analysts: ${consensusRatings.total_analyst_count}` : ''}
${consensusRatings.buy_percentage ? `- Buy Rating: ${parseFloat(consensusRatings.buy_percentage.toString()).toFixed(1)}%` : ''}
${consensusRatings.hold_percentage ? `- Hold Rating: ${parseFloat(consensusRatings.hold_percentage.toString()).toFixed(1)}%` : ''}
${consensusRatings.sell_percentage ? `- Sell Rating: ${parseFloat(consensusRatings.sell_percentage.toString()).toFixed(1)}%` : ''}

CRITICAL: This content MUST appear under "## Section: Earnings & Analyst Outlook" header. Write a forward-looking paragraph (2 sentences) about analyst outlook. Include the consensus rating and price target. Format: "${data.companyName || data.symbol} has a consensus ${consensusRatings.consensus_rating ? consensusRatings.consensus_rating.charAt(0) + consensusRatings.consensus_rating.slice(1).toLowerCase() : 'N/A'} rating among analysts${consensusRatings.consensus_price_target ? ` with an average price target of $${parseFloat(consensusRatings.consensus_price_target.toString()).toFixed(2)}` : ''}. ${consensusRatings.buy_percentage ? `The analyst community shows ${parseFloat(consensusRatings.buy_percentage.toString()).toFixed(0)}% buy ratings, ` : ''}${consensusRatings.total_analyst_count ? `with ${consensusRatings.total_analyst_count} analysts covering the stock.` : 'Analysts are monitoring the stock\'s performance ahead of the upcoming earnings report.'}"
` : ''}

${peRatio !== null ? `
P/E RATIO CONTEXT:
- Current P/E Ratio: ${peRatio.toFixed(1)}

CRITICAL: If P/E ratio is available, include it in the "## Section: Earnings & Analyst Outlook" section. Format: "At current levels, the P/E ratio of ${peRatio.toFixed(1)} suggests the stock is ${peRatio > 25 ? 'overvalued' : peRatio < 15 ? 'undervalued' : 'fairly valued'} relative to peers."
` : ''}

MANDATORY: You MUST include "## Section: Earnings & Analyst Outlook" as a separate section header AFTER "## Section: Technical Analysis" and BEFORE "## Section: Price Action". This section should contain all earnings and analyst outlook information.
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

1. LEAD THE STORY WITH PRICE ACTION: The first paragraph MUST start with the stock's current price move (direction and day of week, e.g., "shares closed up on Thursday" or "shares closed down on Monday"). ${marketStatus === 'premarket' ? `CRITICAL: Use the "Premarket Change" value provided above (${data.changePercent.toFixed(2)}%) to determine direction. If it's positive (>= 0), say "are up during premarket trading on [day]"; if it's negative (< 0), say "are down during premarket trading on [day]". You MUST include the phrase "during premarket trading" in the first sentence. The direction MUST match the sign of ${data.changePercent.toFixed(2)}% - ${data.changePercent >= 0 ? 'POSITIVE means UP' : 'NEGATIVE means DOWN'}. Example: "Apple Inc. (NASDAQ:AAPL) shares are ${data.changePercent >= 0 ? 'up' : 'down'} during premarket trading on Friday".` : `CRITICAL: Use the "Daily Change (REGULAR SESSION ONLY)" value provided above (${data.changePercent.toFixed(2)}%) to determine direction. If it's positive (>= 0), say "closed up" or "were up"; if it's negative (< 0), say "closed down" or "were down". The direction MUST match the sign of ${data.changePercent.toFixed(2)}% - ${data.changePercent >= 0 ? 'POSITIVE means UP' : 'NEGATIVE means DOWN'}. DO NOT make up your own direction - use ONLY the value provided.`} ${marketStatus === 'afterhours' ? 'CRITICAL: During after-hours, DO NOT include a specific closing price amount (e.g., do NOT write "closing at $22.18"). The "Current Price" shown above is the after-hours price, not the regular session closing price. Only mention the direction (up/down) and day - do NOT include any dollar amount or percentage. Example: "ZIM Integrated Shipping Services Ltd. (NYSE:ZIM) shares surged on Monday during regular trading" NOT "closing at $22.18" or "closing up 3.33%".' : ''} When mentioning the day, use ONLY the day name (e.g., "on Thursday", "on Monday") - DO NOT include the date (e.g., do NOT use "on Thursday, December 18, 2025" or any date format). ${marketStatus === 'open' || marketStatus === 'premarket' ? 'Use present tense (e.g., "shares are tumbling", "shares are surging", "shares are up", "shares are down") since markets are currently open or in premarket.' : 'Use past tense (e.g., "shares closed up", "shares closed down", "shares were up", "shares were down") since markets are closed.'} DO NOT include the percentage in the first paragraph - it's already in the price action section. Then reference the news article to explain what's going on - either the news is contributing to the move, OR the stock is moving despite positive/negative news (suggesting larger market elements may be at play). The angle should answer "What's Going On" by connecting the price action to the news context.

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
   - "## Section: The Catalyst" - after the "Also Read" section (which appears after the first paragraph), before the detailed news paragraphs (Paragraph 2 with specific details)
   - "## Section: Technical Analysis" - after news paragraphs, before technical data
   - "## Section: Analyst Ratings" - only if Analyst Overview is included
   - "## Section: Price Action" - before the final price/closing paragraph
   Use these EXACT labels - do not skip them.` : ''}

7. COMPANY TICKER FORMATTING: When mentioning OTHER companies (not the primary stock being analyzed), you MUST include their ticker symbol with exchange in parentheses immediately after the company name. Format: "Company Name (EXCHANGE:TICKER)". Examples:
   - "Snowflake Inc. (NYSE:SNOW)" not just "Snowflake Inc."
   - "Microsoft Corp. (NASDAQ:MSFT)" not just "Microsoft Corp."
   - "Apple Inc. (NASDAQ:AAPL)" not just "Apple Inc."
   - Only the PRIMARY stock (${data.symbol}) should use the format: "**Company Name** (EXCHANGE:TICKER)" with bold formatting
   - All OTHER companies should use: "Company Name (EXCHANGE:TICKER)" without bold
   - If you're unsure of a company's ticker, try to infer it from the article content or use the most common ticker for that company
   - Common examples: Alphabet/Google (NASDAQ:GOOGL), Microsoft (NASDAQ:MSFT), Apple (NASDAQ:AAPL), Amazon (NASDAQ:AMZN), Meta (NASDAQ:META), Tesla (NASDAQ:TSLA), Nvidia (NASDAQ:NVDA), Snowflake (NYSE:SNOW), Oracle (NYSE:ORCL), IBM (NYSE:IBM), Salesforce (NYSE:CRM)

TASK: ${newsContext && (newsContext.scrapedContent || (newsContext.selectedArticles && newsContext.selectedArticles.length > 0)) ? `Write a conversational WGO article that helps readers understand "What's Going On" with the stock. LEAD with the current price move (direction and day of week, e.g., "shares are tumbling on Monday" or "shares are surging on Tuesday"). Use ONLY the day name (e.g., "on Thursday", "on Monday") - DO NOT include the date (e.g., do NOT use "on Thursday, December 18, 2025" or any date format). DO NOT include the percentage in the first paragraph. Then reference the news article provided above AND broader market context to explain what's going on - either the news is contributing to the move, OR the stock is moving despite positive/negative news (suggesting larger market elements may be at play). ${marketContext ? 'Use the broader market context (indices, sectors, market breadth) to provide additional context - is the stock moving with or against broader market trends? Reference specific sector performance when relevant (e.g., "Technology stocks are broadly lower today, contributing to the decline" or "Despite a strong market day, the stock is down, suggesting company-specific concerns").' : ''} Include the appropriate hyperlink in the first paragraph (three-word for Benzinga, one-word with outlet credit for others). When mentioning other companies in the article, always include their ticker symbol with exchange (e.g., "Snowflake Inc. (NYSE:SNOW)").

MANDATORY: You MUST include section markers in your output. Insert "## Section: The Catalyst" AFTER the "Also Read" section (which comes after the FIRST paragraph), "## Section: Technical Analysis" after news paragraphs, "## Section: Earnings & Analyst Outlook" if earnings or analyst data is available (MANDATORY if consensus ratings or earnings date data is provided), and "## Section: Price Action" before the final price paragraph. These are REQUIRED - do not skip them.

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
   - Insert "## Section: Price Action" BEFORE the final paragraph summarizing the current price/closing data.

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
- State that the stock is moving and mention the *general* reason (e.g., "following a bullish analyst report" or "after the company reported earnings" or "as the company navigates market conditions")
- DO NOT include specific numbers (price targets, EPS, revenue figures, percentages from the article)
- DO NOT mention analyst names or firm names (e.g., do NOT say "Needham raised the target" - instead say "following a bullish analyst report")
- DO NOT include specific metrics or detailed information here
- Include the Market Context (indices/sector performance) here if applicable
- When mentioning the day, use ONLY the day name (e.g., "on Thursday", "on Monday") - DO NOT include the date (e.g., do NOT use "on Thursday, December 18, 2025" or any date format)
- ${primaryUrl ? 'Include the hyperlink as specified above' : ''}

Example of CORRECT first paragraph: "**Rocket Lab Corporation** (NASDAQ:RKLB) shares are up on Tuesday as the company is carving out status as a serious rival to SpaceX. The stock is defying a broader market downturn, with the Nasdaq sliding 0.11%."

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

- TECHNICAL ANALYSIS PARAGRAPH 1 (MOVING AVERAGES, 12-MONTH PERFORMANCE, 52-WEEK RANGE): Write a single paragraph that combines: (1) Stock position relative to 20-day and 100-day SMAs with exact percentages (e.g., "Apple stock is currently trading 2.3% below its 20-day simple moving average (SMA), but is X% above its 100-day SMA, demonstrating longer-term strength"), (2) 12-month performance (e.g., "Shares have increased/decreased X% over the past 12 months"), and (3) 52-week range position (e.g., "and are currently closer to 52-week highs than 52-week lows" or vice versa). Keep this to 2-3 sentences maximum. STOP AFTER THIS PARAGRAPH.

- TECHNICAL ANALYSIS PARAGRAPH 2 (RSI AND MACD): Write a single paragraph that combines: (1) RSI level and interpretation (e.g., "The RSI is at 44.45, which is considered neutral territory"), and (2) MACD status (e.g., "Meanwhile, MACD is below its signal line, indicating bearish pressure on the stock"). Keep this to 2 sentences maximum. STOP AFTER THIS PARAGRAPH.

- TECHNICAL ANALYSIS PARAGRAPH 3 (SUPPORT/RESISTANCE AND TRADING ADVICE): Write a single paragraph that includes: (1) Key support and resistance levels rounded to nearest $0.50 (e.g., "Key support is at $265.50, while resistance is at $277.00"), and (2) Trading advice/insight (e.g., "Traders should keep an eye on the support and resistance levels, as well as the momentum indicators, to gauge the stock's next moves. The current technical setup suggests that while AAPL has shown resilience, caution is warranted as it navigates these key levels"). Keep this to 2-3 sentences maximum. STOP AFTER THIS PARAGRAPH.

CRITICAL: After these technical analysis paragraphs, move directly to any additional content (analyst ratings if applicable) or the price action line. Do NOT add more technical analysis paragraphs beyond these three.

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
- "## Section: Price Action" before the final price paragraph
IF YOU DO NOT INCLUDE THESE SECTION MARKERS IN YOUR OUTPUT, YOUR RESPONSE IS INCOMPLETE AND INCORRECT.`;



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
    
    // Post-processing: inject hyperlink if missing
    if (primaryUrl && newsContext) {
      const hasHyperlink = generatedContent.includes(`<a href="${primaryUrl}">`) || generatedContent.includes(`<a href='${primaryUrl}'>`);
      if (!hasHyperlink) {
        console.warn('[HYPERLINK WARNING] Generated content does not include hyperlink for URL:', primaryUrl);
        console.log('[HYPERLINK FIX] Injecting hyperlink into first paragraph...');
        
        // Split into paragraphs to find the first paragraph
        const hasHTMLTags = generatedContent.includes('</p>');
        let paragraphs: string[] = [];
        
        if (hasHTMLTags) {
          paragraphs = generatedContent.split('</p>').filter(p => p.trim().length > 0);
        } else {
          paragraphs = generatedContent.split(/\n\s*\n/).filter(p => p.trim().length > 0);
        }
        
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
        console.log('[HYPERLINK SUCCESS] Hyperlink found in generated content for URL:', primaryUrl);
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
        const priceAction = await generatePriceAction(ticker);
        let analysisWithPriceAction = priceAction 
          ? `${analysis}\n\n${priceAction}`
          : analysis;

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
          if ((consensusRatings || nextEarnings) && !hasEarningsAnalystMarker) {
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
          
          // First, ensure "## Section: Price Action" marker exists before price action line
          
          // Find the price action line position
          const priceActionRegex = /<strong>.*?Price Action:<\/strong>/i;
          const priceActionMatch = analysisWithPriceAction.match(priceActionRegex);
          let priceActionIndex = -1;
          if (priceActionMatch && priceActionMatch.index !== undefined) {
            priceActionIndex = priceActionMatch.index;
          } else {
            priceActionIndex = analysisWithPriceAction.indexOf('Price Action:');
          }
          
          // Insert section marker if it doesn't exist
          if (!hasPriceActionMarker && priceActionIndex !== -1) {
            console.log('Adding "## Section: Price Action" marker');
            // Find the start of the <strong> tag or the beginning of the line
            const beforePriceAction = analysisWithPriceAction.substring(0, priceActionIndex);
            const strongTagStart = beforePriceAction.lastIndexOf('<strong>');
            if (strongTagStart !== -1) {
              const beforeStrong = analysisWithPriceAction.substring(0, strongTagStart).trim();
              const strongAndAfter = analysisWithPriceAction.substring(strongTagStart);
              analysisWithPriceAction = `${beforeStrong}\n\n## Section: Price Action\n\n${strongAndAfter}`;
              // Update priceActionIndex after insertion
              priceActionIndex = analysisWithPriceAction.indexOf('Price Action:');
            } else {
              // Insert before "Price Action:"
              const beforeText = analysisWithPriceAction.substring(0, priceActionIndex).trim();
              const priceActionAndAfter = analysisWithPriceAction.substring(priceActionIndex);
              analysisWithPriceAction = `${beforeText}\n\n## Section: Price Action\n\n${priceActionAndAfter}`;
              // Update priceActionIndex after insertion
              priceActionIndex = analysisWithPriceAction.indexOf('Price Action:');
            }
            console.log('✅ Added "## Section: Price Action" marker');
          } else if (hasPriceActionMarker) {
            console.log('"## Section: Price Action" marker already exists');
          }
          
          // Now insert "Read Next" at the very end, after the price action line
          if (!analysisWithPriceAction.includes('Read Next:')) {
            console.log('Adding "Read Next" section at the end');
            // Always use HTML link format (for clickable links)
            const readNextSection = `<p>Read Next: <a href="${relatedArticles[1]?.url || relatedArticles[0].url}">${relatedArticles[1]?.headline || relatedArticles[0].headline}</a></p>`;
            
            // Append to the end of the content
            analysisWithPriceAction = `${analysisWithPriceAction.trim()}\n\n${readNextSection}`;
            console.log('✅ Added "Read Next" section at the end');
          } else {
            console.log('"Read Next" section already exists');
          }
        } else {
          console.log('No related articles available');
          
          // Still need to add "## Section: Price Action" marker even without related articles
          const priceActionSectionMarker = /##\s*Section:\s*Price Action/i;
          if (!analysisWithPriceAction.match(priceActionSectionMarker)) {
            console.log('Adding "## Section: Price Action" marker (no related articles)');
            const priceActionIndex = analysisWithPriceAction.indexOf('Price Action:');
            if (priceActionIndex !== -1) {
              // Find the start of the <strong> tag or the beginning of the line
              const beforePriceAction = analysisWithPriceAction.substring(0, priceActionIndex);
              const strongTagStart = beforePriceAction.lastIndexOf('<strong>');
              if (strongTagStart !== -1) {
                const beforeStrong = analysisWithPriceAction.substring(0, strongTagStart).trim();
                const strongAndAfter = analysisWithPriceAction.substring(strongTagStart);
                analysisWithPriceAction = `${beforeStrong}\n\n## Section: Price Action\n\n${strongAndAfter}`;
              } else {
                // Insert before "Price Action:"
                const beforeText = analysisWithPriceAction.substring(0, priceActionIndex).trim();
                const priceActionAndAfter = analysisWithPriceAction.substring(priceActionIndex);
                analysisWithPriceAction = `${beforeText}\n\n## Section: Price Action\n\n${priceActionAndAfter}`;
              }
              console.log('✅ Added "## Section: Price Action" marker before price action line');
            }
          }
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
