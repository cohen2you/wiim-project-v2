import { NextResponse } from 'next/server';

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

// Calculate period return from historical bars
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
    const companyName = normalizeCompanyName(overviewData?.name || symbol);
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
      companyNameWithExchange,
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

export async function POST(request: Request) {
  try {
    const { ticker } = await request.json();
    
    if (!ticker || !ticker.trim()) {
      return NextResponse.json({ error: 'Ticker is required' }, { status: 400 });
    }
    
    const tickerUpper = ticker.trim().toUpperCase();
    const technicalData = await fetchTechnicalData(tickerUpper);
    
    if (!technicalData) {
      return NextResponse.json({ 
        error: `Failed to fetch technical data for ${tickerUpper}` 
      }, { status: 500 });
    }
    
    return NextResponse.json({ 
      ticker: tickerUpper,
      data: technicalData
    });
  } catch (error: any) {
    console.error('Error in get-technical-data endpoint:', error);
    return NextResponse.json({ 
      error: error.message || 'Failed to fetch technical data' 
    }, { status: 500 });
  }
}

