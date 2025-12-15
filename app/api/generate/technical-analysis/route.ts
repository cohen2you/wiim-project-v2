import { NextResponse } from 'next/server';

import { aiProvider, AIProvider } from '@/lib/aiProvider';



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
    const changePercent = typeof quote.changePercent === 'number' ? quote.changePercent : 0;
    const lastPrice = formatPriceValue(quote.lastTradePrice);
    
    if (!symbol || !quote.lastTradePrice) {
      return '';
    }
    
    const marketStatus = getMarketStatusTimeBased();
    const upDown = changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : 'unchanged';
    const absChange = Math.abs(changePercent).toFixed(2);
    
    const date = quote.closeDate ? new Date(quote.closeDate) : new Date();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayOfWeek = dayNames[date.getDay()];
    
    let marketStatusPhrase = '';
    if (marketStatus === 'premarket') {
      marketStatusPhrase = ' during premarket trading';
    } else if (marketStatus === 'afterhours') {
      marketStatusPhrase = ' during after-hours trading';
    } else if (marketStatus === 'closed') {
      marketStatusPhrase = ' while the market was closed';
    }
    
    // Calculate separate changes for regular session and after-hours
    let regularSessionChange = 0;
    let afterHoursChange = 0;
    let hasAfterHoursData = false;
    
    if (marketStatus === 'afterhours' && quote.close && quote.lastTradePrice && quote.previousClosePrice) {
      regularSessionChange = ((quote.close - quote.previousClosePrice) / quote.previousClosePrice) * 100;
      afterHoursChange = ((quote.lastTradePrice - quote.close) / quote.close) * 100;
      hasAfterHoursData = true;
    }
    
    let priceActionText = '';
    
    if (marketStatus === 'open') {
      priceActionText = `<strong>${symbol} Price Action:</strong> ${companyName} shares were ${upDown} ${absChange}% at $${lastPrice} at the time of publication on ${dayOfWeek}`;
    } else if (marketStatus === 'afterhours' && hasAfterHoursData) {
      const regularUpDown = regularSessionChange > 0 ? 'up' : regularSessionChange < 0 ? 'down' : 'unchanged';
      const afterHoursUpDown = afterHoursChange > 0 ? 'up' : afterHoursChange < 0 ? 'down' : 'unchanged';
      const absRegularChange = Math.abs(regularSessionChange).toFixed(2);
      const absAfterHoursChange = Math.abs(afterHoursChange).toFixed(2);
      priceActionText = `<strong>${symbol} Price Action:</strong> ${companyName} shares were ${regularUpDown} ${absRegularChange}% during regular trading and ${afterHoursUpDown} ${absAfterHoursChange}% in after-hours trading on ${dayOfWeek}, last trading at $${lastPrice}`;
    } else {
      priceActionText = `<strong>${symbol} Price Action:</strong> ${companyName} shares were ${upDown} ${absChange}% at $${lastPrice}${marketStatusPhrase} on ${dayOfWeek}`;
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

  currentPrice: number;

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

    const changePercent = tickerData?.todaysChangePerc || 0;

    const volume = tickerData?.day?.v || 0;

    

    const overviewData = overview.results;

    const companyName = overviewData?.name || symbol;

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

// Fetch market context for broader market analysis
async function fetchMarketContext(): Promise<MarketContext | null> {
  try {
    const INDICES = ['SPY', 'QQQ', 'DIA', 'IWM'];
    const SECTORS = ['XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLP', 'XLY', 'XLU', 'XLRE', 'XLC', 'XLB'];
    
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

    return {
      indices,
      sectors: sectors.sort((a, b) => b.change - a.change), // Sort by performance
      marketBreadth: { advancers, decliners, ratio },
      topGainers: gainers,
      topLosers: losers
    };
  } catch (error) {
    console.error('Error fetching market context:', error);
    return null;
  }
}

// Generate comprehensive technical analysis using AI provider

async function generateTechnicalAnalysis(data: TechnicalAnalysisData, provider?: AIProvider, newsContext?: { scrapedContent?: string; selectedArticles?: any[] }, marketContext?: MarketContext | null): Promise<string> {

  try {

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    const today = new Date();

    const dayOfWeek = dayNames[today.getDay()];

    

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

    

    const prompt = `You are a professional technical analyst writing a comprehensive stock analysis focused on longer-term trends and technical indicators. Today is ${dayOfWeek}, ${today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.



STOCK: ${data.symbol} (${data.companyName})

Current Price: $${formatPrice(data.currentPrice)}

Daily Change: ${data.changePercent.toFixed(2)}%

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

${newsContext && (newsContext.scrapedContent || (newsContext.selectedArticles && newsContext.selectedArticles.length > 0)) ? (() => {
  const primaryUrl = newsContext.newsUrl || (newsContext.selectedArticles && newsContext.selectedArticles[0]?.url) || '';
  const isBenzinga = primaryUrl.includes('benzinga.com');
  const urlDomain = primaryUrl ? new URL(primaryUrl).hostname.replace('www.', '') : '';
  const outletName = urlDomain ? urlDomain.split('.')[0].charAt(0).toUpperCase() + urlDomain.split('.')[0].slice(1) : '';
  
  return `
PRIMARY NEWS ARTICLE (LEAD WITH THIS):

${newsContext.scrapedContent ? `
Scraped Article URL: ${newsContext.newsUrl || 'N/A'}
Scraped Article Content:
${newsContext.scrapedContent.substring(0, 3000)}${newsContext.scrapedContent.length > 3000 ? '...' : ''}
` : ''}

${newsContext.selectedArticles && newsContext.selectedArticles.length > 0 && !newsContext.scrapedContent ? `
Primary Article (use the first selected article):
Headline: ${newsContext.selectedArticles[0].headline}
Content: ${newsContext.selectedArticles[0].body?.substring(0, 3000) || ''}${newsContext.selectedArticles[0].body && newsContext.selectedArticles[0].body.length > 3000 ? '...' : ''}
URL: ${newsContext.selectedArticles[0].url || 'N/A'}
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

1. LEAD THE STORY WITH PRICE ACTION: The first paragraph MUST start with the stock's current price move (direction and day of week, e.g., "shares are tumbling Monday" or "shares are surging Tuesday"). DO NOT include the percentage in the first paragraph - it's already in the price action section. Then reference the news article to explain what's going on - either the news is contributing to the move, OR the stock is moving despite positive/negative news (suggesting larger market elements may be at play). The angle should answer "What's Going On" by connecting the price action to the news context.

2. HYPERLINK FORMATTING (MUST BE IN FIRST PARAGRAPH):
   ${isBenzinga ? `- This is a Benzinga article. Use a THREE-WORD hyperlink in the first paragraph with format: <a href="${primaryUrl}">[three word phrase]</a>
   - Example: <a href="${primaryUrl}">recent market developments</a> or <a href="${primaryUrl}">latest trading activity</a>` : `- This is NOT a Benzinga article (${outletName || 'external source'}). Use a ONE-WORD hyperlink with outlet credit in the first paragraph.
   - Format: <a href="${primaryUrl}">${outletName || 'Source'}</a> reports
   - Example: <a href="${primaryUrl}">CNBC</a> reports or <a href="${primaryUrl}">Reuters</a> reports
   - Extract the outlet name from the URL domain and capitalize it properly (e.g., "cnbc.com" → "CNBC", "reuters.com" → "Reuters", "bloomberg.com" → "Bloomberg")`}

3. The hyperlink MUST appear in the FIRST paragraph of the story, integrated naturally into the text.

4. After leading with the news, naturally transition to the technical analysis data provided above.

5. Maximum 2 sentences per news integration in other paragraphs.`;
})() : ''}

TASK: ${newsContext && (newsContext.scrapedContent || (newsContext.selectedArticles && newsContext.selectedArticles.length > 0)) ? `Write a conversational WGO article that helps readers understand "What's Going On" with the stock. LEAD with the current price move (direction and day of week, e.g., "shares are tumbling Monday" or "shares are surging Tuesday"). DO NOT include the percentage in the first paragraph. Then reference the news article provided above AND broader market context to explain what's going on - either the news is contributing to the move, OR the stock is moving despite positive/negative news (suggesting larger market elements may be at play). ${marketContext ? 'Use the broader market context (indices, sectors, market breadth) to provide additional context - is the stock moving with or against broader market trends? Reference specific sector performance when relevant (e.g., "Technology stocks are broadly lower today, contributing to the decline" or "Despite a strong market day, the stock is down, suggesting company-specific concerns").' : ''} Include the appropriate hyperlink in the first paragraph (three-word for Benzinga, one-word with outlet credit for others). After connecting price action to news and market context, provide technical analysis focusing on longer-term trends (12-month).` : `Write a conversational WGO article that helps readers understand "What's Going On" with the stock. LEAD with the current price move and note that there's no company-specific news driving the move. ${marketContext ? 'Then use broader market context (indices, sectors, market breadth) to explain the move - is the stock moving with or against broader market trends? Reference specific sector performance when relevant. For example, if the stock is down but the broader market/sector is up, note that the stock is underperforming despite positive market conditions. If the stock is down and the broader market/sector is also down, note that the stock is caught in a broader sell-off (e.g., "Technology stocks are broadly lower today, contributing to the decline").' : ''} Then use technical indicators (moving averages, RSI, MACD, support/resistance) to create a narrative that explains what's happening and why traders are seeing this price action. Focus on using technical data to tell the story - what do the charts reveal about the stock's current situation?`} Weave data points naturally into your analysis rather than listing them. Write like you're explaining the stock's technical picture to a colleague - clear, direct, and engaging. When relevant, mention key turning points and when they occurred to provide context for the current technical setup. Think like a trader: prioritize actionable insights and key technical signals over routine price updates.



CRITICAL RULES - PARAGRAPH LENGTH IS MANDATORY:

- EVERY PARAGRAPH MUST BE EXACTLY 2 SENTENCES OR LESS - NO EXCEPTIONS. If you find yourself writing a third sentence, start a new paragraph instead.

- Write in a CONVERSATIONAL, DIRECT tone - avoid robotic or overly formal language

- Avoid overly sophisticated or formal words like "robust", "substantial", "notable", "significant", "considerable" - use simpler, more direct words instead

- Use normal, everyday language that's clear and accessible - write like you're talking to someone, not writing a formal report

- FIRST PARAGRAPH (2 sentences max): ${newsContext && (newsContext.scrapedContent || (newsContext.selectedArticles && newsContext.selectedArticles.length > 0)) ? `Start with the company name in bold (**Company Name**), followed by the ticker in parentheses (not bold) - e.g., **Microsoft Corp** (MSFT) or **Apple Inc.** (AAPL). Use proper company name formatting with periods (Inc., Corp., etc.). Lead with the primary news article and include the appropriate hyperlink.` : `Start with the company name in bold (**Company Name**), followed by the ticker in parentheses (not bold) - e.g., **Apple Inc.** (AAPL) or **Applied Digital Corp.** (NASDAQ: APLD). Use proper company name formatting with periods (Inc., Corp., etc.). LEAD with the current price move direction using the Daily Change data provided - note ONLY the direction and day of week (e.g., "shares are tumbling Monday" if down, "shares are surging Tuesday" if up). DO NOT include the percentage in the first paragraph - it's already in the price action section. ${marketContext ? 'Then IMMEDIATELY reference broader market context to explain the move - is the stock moving with or against broader market trends? Reference specific sector performance when relevant (e.g., "The move comes as Technology stocks are broadly lower today, contributing to the decline" or "Despite a strong market day with the S&P 500 up 0.5%, the stock is down, suggesting company-specific concerns" or "The stock is caught in a broader sell-off, with the Nasdaq down 1.2% and Technology sector declining 1.5%").' : 'Then immediately pivot to the technical analysis context - use moving average positioning, support/resistance levels, or key technical signals to explain what traders are seeing on the charts (e.g., "Traders are focused on the technical picture, which shows the stock is currently testing key support levels while facing mixed signals from moving averages" or "The move comes as the stock flashes a \'mixed\' signal—breaking down in the short term while testing a crucial long-term floor").'} Focus on using market context and technical indicators to add context to the move rather than declaring there's no news. STOP AFTER 2 SENTENCES.`}

- SECOND PARAGRAPH (2 sentences max, MOVING AVERAGES WITH PERCENTAGES): ${newsContext && (newsContext.scrapedContent || (newsContext.selectedArticles && newsContext.selectedArticles.length > 0)) ? `Include RSI level and signal (overbought/oversold/neutral) and explain what it means for the stock. Provide insight into what this RSI level suggests about momentum and potential price action. STOP AFTER 2 SENTENCES.` : `${marketContext ? 'If market context was not fully covered in the first paragraph, briefly reference it here (1 sentence max). Then ' : ''}Use specific moving average percentages to explain the technical situation. Include the exact percentages (e.g., "9.3% below its 20-day Simple Moving Average (SMA) and 18.5% below its 50-day SMA") and explain what this positioning means for the stock's trend. Show both short-term and longer-term moving average relationships to create a complete picture (e.g., "confirming the bearish pressure" or "indicating strength"). STOP AFTER 2 SENTENCES.`}

- THIRD PARAGRAPH (2 sentences max, MACD AND RSI FOCUS): ${newsContext && (newsContext.scrapedContent || (newsContext.selectedArticles && newsContext.selectedArticles.length > 0)) ? `Mention MACD status (whether MACD is above or below signal line) in simple terms - e.g., "MACD is below its signal line, indicating bearish pressure" or "MACD is above its signal line, indicating bullish momentum". DO NOT use the word "histogram" - just state whether MACD is above or below the signal line and what it indicates about momentum or trend strength. Provide insight into what this means for traders. STOP AFTER 2 SENTENCES.` : `Combine MACD and RSI analysis to show momentum indicators. Mention MACD status (whether MACD is above or below signal line) and what it suggests (e.g., "potential for a relief rally" or "indicating bearish pressure"). Include the RSI level with context (e.g., "RSI of 48.07 sits firmly in neutral territory—indicating the stock has not yet reached 'oversold' levels despite the double-digit decline"). Explain what these indicators together reveal about the stock's momentum. STOP AFTER 2 SENTENCES.`}

- FOURTH PARAGRAPH (2 sentences max, SUPPORT/RESISTANCE FOCUS): Mention key support and resistance levels (rounded to nearest $0.50, not penny-precise) and explain what traders should anticipate if these levels are hit or breached - will it signal a trend change, continuation, or potential reversal? These are critical for traders. DO NOT repeat support and resistance levels in later paragraphs - mention them once here and move on. STOP AFTER 2 SENTENCES.

- FIFTH PARAGRAPH (2 sentences max, GOLDEN/DEATH CROSS ONLY IF DATE EXISTS): CRITICAL: Only mention a golden cross or death cross if there is an EXPLICIT DATE listed in the KEY TURNING POINTS section above. If there is NO golden cross date or death cross date in KEY TURNING POINTS, DO NOT mention golden cross or death cross at all - even if the MOVING AVERAGE CROSSOVERS section shows "50-day SMA above 200-day SMA" or similar. NEVER infer, guess, or make up dates for golden/death crosses. NEVER say "the golden cross occurred in [month]" unless that exact date is listed in KEY TURNING POINTS. If a golden cross or death cross date IS listed in KEY TURNING POINTS, mention it here with the EXACT MONTH NAME provided. Use proper capitalization for the month (e.g., "June" or "September", NOT "JUNE" or "SEPTEMBER" in all caps). The month name is EXPLICITLY STATED in brackets with CRITICAL INSTRUCTIONS - use that exact month name with proper case. DO NOT use the current month (December) unless it's explicitly stated in the turning points. DO NOT use vague terms like "recently" or "recent". If no golden/death cross dates are mentioned in KEY TURNING POINTS, discuss moving average relationships and what they indicate about trend strength instead. STOP AFTER 2 SENTENCES.

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

- Use plain text only - no special formatting or markup

- NEVER use ambiguous phrasing like "below its 50-day moving average, which is X% lower"

- ALWAYS use clear phrasing: "trading X% below its 50-day moving average" or "the stock is X% below its 50-day moving average"

- The percentage always refers to how far the STOCK is from the moving average, not the other way around

- Write like you're having a conversation, not writing a formal report`;



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

    const maxTokens = currentProvider === 'gemini' ? 8192 : 800;



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



    return response.content.trim();

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
        const analysisWithPriceAction = priceAction 
          ? `${analysis}\n\n${priceAction}`
          : analysis;

        

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
