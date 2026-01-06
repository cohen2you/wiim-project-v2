import { NextResponse } from 'next/server';
import { aiProvider, type AIProvider } from '../../../../lib/aiProvider';
import { fetchETFs, formatETFInfo } from '@/lib/etf-utils';

export const dynamic = 'force-dynamic';

const BENZINGA_API_KEY = process.env.BENZINGA_API_KEY!;
const BZ_NEWS_URL = 'https://api.benzinga.com/api/v2/news';

// Helper function to truncate text intelligently - keep beginning and end
function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  
  // Keep first 60% and last 40% to preserve key info at start and conclusion
  const firstPart = Math.floor(maxChars * 0.6);
  const lastPart = maxChars - firstPart - 100; // Reserve 100 chars for separator
  
  return text.substring(0, firstPart) + 
         '\n\n[... middle section truncated for length ...]\n\n' + 
         text.substring(text.length - lastPart);
}

// Helper function to extract date and convert to day of week from analyst note text
function extractDateAndDayOfWeek(text: string): string {
  // Common date patterns in analyst notes:
  // - "January 5, 2026" or "January 5, 2025"
  // - "January 5" (year might be implied)
  // - "5 January 2026"
  // - "1/5/2026" or "1/5/25"
  // - "2026-01-05" (ISO format)
  
  const datePatterns = [
    // Full date: "January 5, 2026" or "January 5, 2025"
    /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})/i,
    // Date without year: "January 5" (assume current year)
    /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:,|\.|\s|$)/i,
    // ISO format: "2026-01-05"
    /(\d{4})-(\d{1,2})-(\d{1,2})/,
    // US format: "1/5/2026" or "01/05/2026"
    /(\d{1,2})\/(\d{1,2})\/(\d{4})/,
    // US format without century: "1/5/25"
    /(\d{1,2})\/(\d{1,2})\/(\d{2})/,
  ];
  
  const monthNames: { [key: string]: number } = {
    'january': 0, 'february': 1, 'march': 2, 'april': 3, 'may': 4, 'june': 5,
    'july': 6, 'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11
  };
  
  for (let i = 0; i < datePatterns.length; i++) {
    const pattern = datePatterns[i];
    const match = text.match(pattern);
    if (match) {
      try {
        let month: number, day: number, year: number;
        
        // Check which pattern matched by index
        if (i === 0 || i === 1) {
          // Month name format: "January 5, 2026" (pattern 0) or "January 5" (pattern 1)
          const monthName = match[1].toLowerCase();
          month = monthNames[monthName];
          day = parseInt(match[2], 10);
          // Pattern 0 has year in match[3], pattern 1 doesn't
          year = i === 0 && match[3] ? parseInt(match[3], 10) : new Date().getFullYear();
          // Handle 2-digit years
          if (year < 100) {
            year += 2000;
          }
        } else if (i === 2) {
          // ISO format: 2026-01-05
          year = parseInt(match[1], 10);
          month = parseInt(match[2], 10) - 1;
          day = parseInt(match[3], 10);
        } else {
          // US format: 1/5/2026 (pattern 3) or 1/5/25 (pattern 4)
          month = parseInt(match[1], 10) - 1;
          day = parseInt(match[2], 10);
          year = parseInt(match[3], 10);
          if (year < 100) {
            year += 2000;
          }
        }
        
        const date = new Date(year, month, day);
        if (!isNaN(date.getTime())) {
          const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          const dayName = days[date.getDay()];
          console.log(`Extracted date: ${month + 1}/${day}/${year} -> ${dayName}`);
          return dayName;
        }
      } catch (error) {
        console.log('Error parsing date:', error);
      }
    }
  }
  
  // Fallback: return current day or "today"
  console.log('No date found in analyst note, using current day');
  return 'today';
}

// Helper function to extract ticker from analyst note text
function extractTickerFromText(text: string): string | null {
  // Common patterns for ticker symbols in analyst notes:
  // 1. "(TICKER, Rating, $PT)" format - e.g., "(LULU, Buy, $303 PT)"
  // 2. "TICKER US" or "TICKER" at the start of a line
  // 3. "(NASDAQ:TICKER)" or "(NYSE:TICKER)" patterns
  // 4. "TICKER" in parentheses alone - e.g., "(LULU)"
  // 5. "TICKER" in uppercase, 1-5 characters, often near company name
  
  // Try pattern 1: "(LULU, Buy, $303 PT)" or similar - very common in analyst notes
  const pattern1 = /\(([A-Z]{1,5}),\s*(?:Buy|Sell|Hold|Outperform|Underperform|Neutral|Overweight|Underweight|Equal Weight|Market Perform|Strong Buy|Strong Sell|Positive|Negative|Neutral).*?\)/i;
  const match1 = text.match(pattern1);
  if (match1) {
    const ticker = match1[1].toUpperCase();
    console.log(`Extracted ticker using pattern 1 (parentheses with rating): ${ticker}`);
    return ticker;
  }
  
  // Try pattern 2: "(NASDAQ:LULU)" or "(NYSE:LULU)"
  const pattern2 = /\((?:NASDAQ|NYSE|AMEX|OTC|Nasdaq|NYSE):([A-Z]{1,5})\)/i;
  const match2 = text.match(pattern2);
  if (match2) {
    const ticker = match2[1].toUpperCase();
    console.log(`Extracted ticker using pattern 2 (exchange format): ${ticker}`);
    return ticker;
  }
  
  // Try pattern 3: "(LULU)" - ticker in parentheses alone
  const pattern3 = /\(([A-Z]{1,5})\)/;
  const match3 = text.match(pattern3);
  if (match3) {
    const potentialTicker = match3[1].toUpperCase();
    // Filter out common words that might match
    const invalidTickers = ['THE', 'AND', 'FOR', 'ARE', 'WAS', 'HAS', 'HAD', 'WILL', 'THIS', 'THAT', 'INC', 'CORP', 'LLC', 'LTD'];
    if (!invalidTickers.includes(potentialTicker) && potentialTicker.length >= 2) {
      console.log(`Extracted ticker using pattern 3 (parentheses alone): ${potentialTicker}`);
      return potentialTicker;
    }
  }
  
  // Try pattern 4: "AVGO US" or "LULU US" at start of line
  const pattern4 = /^([A-Z]{1,5})\s+US\b/mi;
  const match4 = text.match(pattern4);
  if (match4) {
    const ticker = match4[1].toUpperCase();
    console.log(`Extracted ticker using pattern 4 (TICKER US): ${ticker}`);
    return ticker;
  }
  
  // Try pattern 5: Look for common ticker patterns near company mentions
  const tickerPattern = /\b([A-Z]{2,5})\s+(?:US|NASDAQ|NYSE|shares|stock|ticker)/i;
  const match5 = text.match(tickerPattern);
  if (match5) {
    const potentialTicker = match5[1].toUpperCase();
    const invalidTickers = ['THE', 'AND', 'FOR', 'ARE', 'WAS', 'HAS', 'HAD', 'WILL', 'THIS', 'THAT', 'INC', 'CORP', 'LLC', 'LTD'];
    if (!invalidTickers.includes(potentialTicker)) {
      console.log(`Extracted ticker using pattern 5 (near company mention): ${potentialTicker}`);
      return potentialTicker;
    }
  }
  
  console.log('No ticker found in text using any pattern');
  return null;
}

// Helper function to fetch related articles from Benzinga
async function fetchRelatedArticles(ticker: string, excludeUrl?: string): Promise<any[]> {
  try {
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - 7);
    const dateFromStr = dateFrom.toISOString().slice(0, 10);
    
    let url: string;
    
    if (ticker && ticker.trim() !== '') {
      // Fetch ticker-specific articles
      url = `${BZ_NEWS_URL}?token=${BENZINGA_API_KEY}&tickers=${encodeURIComponent(ticker)}&items=20&fields=headline,title,created,url,channels&accept=application/json&displayOutput=full&dateFrom=${dateFromStr}`;
    } else {
      // Fetch general market news when no ticker is provided
      url = `${BZ_NEWS_URL}?token=${BENZINGA_API_KEY}&items=20&fields=headline,title,created,url,channels&accept=application/json&displayOutput=full&dateFrom=${dateFromStr}`;
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
    
    console.log(`[RELATED ARTICLES] Fetched ${data.length} articles, filtered to ${filteredArticles.length}, returning ${relatedArticles.length} articles`);
    if (relatedArticles.length > 0) {
      console.log(`[RELATED ARTICLES] First article: ${relatedArticles[0].headline}`);
      if (relatedArticles.length > 1) {
        console.log(`[RELATED ARTICLES] Second article: ${relatedArticles[1].headline}`);
      } else {
        console.log(`[RELATED ARTICLES] WARNING: Only one article available - "Read Next" will be skipped`);
      }
    }
    
    return relatedArticles;
  } catch (error) {
    console.error('Error fetching related articles:', error);
    return [];
  }
}

// Helper function to fetch price data from Benzinga (matching add-price-action format)
async function fetchPriceData(ticker: string) {
  try {
    const apiUrl = `https://api.benzinga.com/api/v2/quoteDelayed?token=${process.env.BENZINGA_API_KEY}&symbols=${encodeURIComponent(ticker)}`;
    console.log(`Fetching price data from Benzinga API for ${ticker}:`, apiUrl.replace(process.env.BENZINGA_API_KEY || '', '[API_KEY]'));
    
    const response = await fetch(apiUrl);
    
    if (!response.ok) {
      console.error(`Failed to fetch price data: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      console.error('Error response:', errorText);
      return null;
    }
    
    const data = await response.json();
    console.log(`Benzinga API response for ${ticker}:`, JSON.stringify(data, null, 2));
    
    if (data && typeof data === 'object') {
      const quote = data[ticker.toUpperCase()];
      if (quote && typeof quote === 'object') {
        const priceData = {
          last: quote.lastTradePrice || 0,
          change: quote.change || 0,
          change_percent: quote.changePercent || quote.change_percent || 0,
          volume: quote.volume || 0,
          high: quote.high || 0,
          low: quote.low || 0,
          open: quote.open || 0,
          close: quote.close || quote.lastTradePrice || 0,
          previousClose: quote.previousClosePrice || quote.previousClose || 0,
          // Company name
          companyName: quote.companyStandardName || quote.name || ticker.toUpperCase(),
          // Extended hours data with multiple field name support (matching add-price-action)
          extendedHoursPrice: quote.ethPrice || quote.extendedHoursPrice || quote.afterHoursPrice || quote.ahPrice || quote.extendedPrice || null,
          extendedHoursChange: quote.ethChange || quote.extendedHoursChange || quote.afterHoursChange || quote.ahChange || quote.extendedChange || null,
          extendedHoursChangePercent: quote.ethChangePercent || quote.extendedHoursChangePercent || quote.afterHoursChangePercent || quote.ahChangePercent || quote.extendedChangePercent || null,
          extendedHoursTime: quote.ethTime || quote.extendedHoursTime || quote.afterHoursTime || quote.ahTime || quote.extendedTime || null,
          extendedHoursVolume: quote.ethVolume || null
        };
        console.log(`Processed price data for ${ticker}:`, {
          last: priceData.last,
          change: priceData.change,
          change_percent: priceData.change_percent,
          close: priceData.close,
          previousClose: priceData.previousClose,
          companyName: priceData.companyName,
          extendedHoursPrice: priceData.extendedHoursPrice,
          extendedHoursChangePercent: priceData.extendedHoursChangePercent
        });
        return priceData;
      } else {
        console.warn(`No quote data found for ${ticker} in API response`);
      }
    } else {
      console.warn(`Unexpected API response format for ${ticker}:`, typeof data);
    }
    
    return null;
  } catch (error) {
    console.error('Error fetching price data:', error);
    return null;
  }
}

// Helper function to determine market session
function getMarketSession(): 'premarket' | 'regular' | 'afterhours' | 'closed' {
  const now = new Date();
  const nyTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour = nyTime.getHours();
  const minute = nyTime.getMinutes();
  const time = hour * 100 + minute;
  const day = nyTime.getDay();
  
  if (day === 0 || day === 6) return 'closed';
  if (time >= 400 && time < 930) return 'premarket';
  if (time >= 930 && time < 1600) return 'regular';
  if (time >= 1600 && time < 2000) return 'afterhours';
  return 'closed';
}

// Helper function to get current day name
function getCurrentDayName() {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const today = new Date();
  const currentDay = today.getDay();
  
  if (currentDay === 0) return 'Friday';
  if (currentDay === 6) return 'Friday';
  return days[currentDay];
}

// Helper function to generate price action line (matching add-price-action format exactly)
function generatePriceActionLine(ticker: string, priceData: any): string {
  // Only bold the ticker prefix (e.g., "MSFT Price Action:"), not the entire line
  const prefix = `${ticker} Price Action:`;
  
  if (!priceData) {
    return `<strong>${prefix}</strong> Price data unavailable, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
  }

  const marketSession = getMarketSession();
  const dayName = getCurrentDayName();
  const companyName = priceData.companyName || ticker.toUpperCase();
  
  console.log(`Generating price action for ${ticker}:`, {
    marketSession,
    dayName,
    companyName,
    rawData: {
      last: priceData.last,
      change: priceData.change,
      change_percent: priceData.change_percent,
      close: priceData.close,
      previousClose: priceData.previousClose,
      extendedHoursPrice: priceData.extendedHoursPrice,
      extendedHoursChangePercent: priceData.extendedHoursChangePercent
    }
  });
  
  // Regular session data
  // Use 'close' for regular trading hours close price (not lastTradePrice which may be extended hours)
  const regularLast = parseFloat(priceData.close || priceData.last || 0).toFixed(2);
  
  // Calculate regular trading hours change percent from close and previousClose
  // The API's changePercent may reflect extended hours, so we calculate regular hours separately
  let regularChangePercent: string;
  if (priceData.previousClose && priceData.previousClose > 0 && priceData.close) {
    // Calculate from regular hours close vs previous close
    // This gives us the regular trading hours performance
    const regularChange = parseFloat(priceData.close) - parseFloat(priceData.previousClose);
    const calculatedChangePercent = (regularChange / parseFloat(priceData.previousClose) * 100).toFixed(2);
    regularChangePercent = calculatedChangePercent;
  } else if (priceData.change && priceData.previousClose && priceData.previousClose > 0) {
    // Fallback: calculate from change amount if close is not available
    const calculatedChangePercent = (parseFloat(priceData.change.toString()) / parseFloat(priceData.previousClose.toString()) * 100).toFixed(2);
    regularChangePercent = calculatedChangePercent;
  } else {
    // Last resort: use API field directly (but this may be extended hours)
    const apiChangePercent = parseFloat(priceData.change_percent || 0);
    regularChangePercent = apiChangePercent.toFixed(2);
  }
  
  const regularDisplayChangePercent = regularChangePercent.startsWith('-') ? regularChangePercent.substring(1) : regularChangePercent;
  
  // Extended hours data
  const hasExtendedHours = priceData.extendedHoursPrice;
  const extPrice = hasExtendedHours ? parseFloat(priceData.extendedHoursPrice || 0).toFixed(2) : null;
  const extChangePercent = priceData.extendedHoursChangePercent ? parseFloat(priceData.extendedHoursChangePercent || 0).toFixed(2) : null;
  const extDisplayChangePercent = extChangePercent && extChangePercent.startsWith('-') ? extChangePercent.substring(1) : extChangePercent;
  
  // Calculate extended hours change if we have the price but not the change percentage
  const regularClose = parseFloat(priceData.close || priceData.last || 0);
  const calculatedExtChangePercent = priceData.extendedHoursPrice && !priceData.extendedHoursChangePercent ? 
    ((parseFloat(priceData.extendedHoursPrice) - regularClose) / regularClose * 100).toFixed(2) : null;
  
  const finalExtChangePercent = extChangePercent || calculatedExtChangePercent;
  const finalHasExtendedHours = priceData.extendedHoursPrice && finalExtChangePercent;
  const finalExtDisplayChangePercent = finalExtChangePercent && finalExtChangePercent.startsWith('-') ? finalExtChangePercent.substring(1) : finalExtChangePercent;
  
  if (marketSession === 'regular') {
    return `<strong>${prefix}</strong> ${companyName} shares were ${regularChangePercent.startsWith('-') ? 'down' : 'up'} ${regularDisplayChangePercent}% at $${regularLast} during regular trading hours on ${dayName}, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
  } else if (marketSession === 'premarket') {
    // For premarket, use the API's change_percent directly (matching WGO behavior)
    // During premarket, if changePercent is 0 or missing, skip the change percentage
    // (Benzinga's delayed feed may not have updated it yet, showing 0.00% is misleading)
    const premarketPrice = priceData.extendedHoursPrice ? parseFloat(priceData.extendedHoursPrice).toFixed(2) : parseFloat(priceData.last).toFixed(2);
    
    // Use API's change_percent if provided and not 0
    const shouldShowChangePercent = priceData.change_percent !== undefined && priceData.change_percent !== 0;
    
    if (shouldShowChangePercent) {
      const premarketChangePercent = parseFloat(priceData.change_percent.toString()).toFixed(2);
      const premarketDisplayChangePercent = premarketChangePercent.startsWith('-') ? premarketChangePercent.substring(1) : premarketChangePercent;
      return `<strong>${prefix}</strong> ${companyName} shares were ${premarketChangePercent.startsWith('-') ? 'down' : 'up'} ${premarketDisplayChangePercent}% at $${premarketPrice} during pre-market trading on ${dayName}, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
    } else {
      // Skip change percentage if it's 0 or undefined (stock unchanged or API hasn't updated)
      return `<strong>${prefix}</strong> ${companyName} shares were trading at $${premarketPrice} during pre-market trading on ${dayName}, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
    }
  } else if (marketSession === 'afterhours') {
    if (finalHasExtendedHours && finalExtChangePercent && finalExtDisplayChangePercent) {
      // Show both regular session and after-hours changes
      const regularDirection = regularChangePercent.startsWith('-') ? 'fell' : 'rose';
      const extDirection = finalExtChangePercent.startsWith('-') ? 'down' : 'up';
      
      return `<strong>${prefix}</strong> ${companyName} shares ${regularDirection} ${regularDisplayChangePercent}% to $${regularLast} during regular trading hours, and were ${extDirection} ${finalExtDisplayChangePercent}% at $${extPrice} during after-hours trading on ${dayName}, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
    } else {
      // Show regular session data with after-hours indication
      const regularDirection = regularChangePercent.startsWith('-') ? 'fell' : 'rose';
      return `<strong>${prefix}</strong> ${companyName} shares ${regularDirection} ${regularDisplayChangePercent}% to $${regularLast} during regular trading hours on ${dayName}. The stock is currently trading in after-hours session, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
    }
  } else {
    // Market is closed, use last regular session data
    return `<strong>${prefix}</strong> ${companyName} shares ${regularChangePercent.startsWith('-') ? 'fell' : 'rose'} ${regularDisplayChangePercent}% to $${regularLast} during regular trading hours on ${dayName}, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
  }
}

export async function POST(req: Request) {
  try {
    const { analystNoteText, ticker, aiProvider: providerOverride, multipleNotes } = await req.json();
    
    // Handle both single note and multiple notes
    let combinedNoteText = analystNoteText || '';
    
    if (multipleNotes && Array.isArray(multipleNotes) && multipleNotes.length > 0) {
      // Combine multiple notes with clear separators
      combinedNoteText = multipleNotes.map((note: any, index: number) => {
        const noteHeader = `\n\n=== ANALYST NOTE ${index + 1}${note.filename ? `: ${note.filename}` : ''}${note.ticker ? ` (${note.ticker})` : ''} ===\n\n`;
        return noteHeader + (note.text || '');
      }).join('\n\n');
      
      console.log(`Combining ${multipleNotes.length} analyst notes into single article`);
    }
    
    if (!combinedNoteText || !combinedNoteText.trim()) {
      return NextResponse.json({ error: 'Analyst note text is required' }, { status: 400 });
    }

    const provider: AIProvider = providerOverride || 'openai';
    
    // Extract ticker from analyst notes - prioritize tickers from notes, then extract from text
    // Do NOT use ticker from main app - price action should be based on note ticker only
    let finalTicker = '';
    
    console.log('Ticker extraction - provided ticker:', ticker);
    console.log('Ticker extraction - multipleNotes count:', multipleNotes?.length || 0);
    
    // First, try to get ticker from multipleNotes if provided
    if (multipleNotes && Array.isArray(multipleNotes) && multipleNotes.length > 0) {
      const noteWithTicker = multipleNotes.find((note: any) => note.ticker);
      if (noteWithTicker) {
        finalTicker = noteWithTicker.ticker.toUpperCase();
        console.log(`✓ Using ticker from analyst note object: ${finalTicker}`);
      } else {
        console.log('No ticker found in multipleNotes objects, will try extraction from text');
      }
    }
    
    // If no ticker from notes, try the provided ticker (which should only come from notes now)
    if (!finalTicker && ticker?.trim()) {
      finalTicker = ticker.trim().toUpperCase();
      console.log(`✓ Using provided ticker parameter: ${finalTicker}`);
    }
    
    // If still no ticker, extract from the text
    if (!finalTicker) {
      console.log('Attempting to extract ticker from combined note text...');
      console.log('Text preview (first 500 chars):', combinedNoteText.substring(0, 500));
      const extractedTicker = extractTickerFromText(combinedNoteText);
      if (extractedTicker) {
        finalTicker = extractedTicker;
        console.log(`✓ Extracted ticker from analyst note text: ${finalTicker}`);
      } else {
        console.log('✗ Failed to extract ticker from text');
      }
    }
    
    if (!finalTicker) {
      console.warn('⚠️ No ticker found in analyst notes. Price action will be generic.');
      console.warn('Text sample for debugging:', combinedNoteText.substring(0, 1000));
    } else {
      console.log(`✓ Final ticker for price action: ${finalTicker}`);
    }
    
    // Extract date/day of week from analyst note text
    const ratingDayOfWeek = extractDateAndDayOfWeek(combinedNoteText);
    
    // Fetch related articles for "Also Read" and "Read Next" sections
    // Note: Analyst articles don't have a sourceUrl to exclude, but we could exclude the analyst note URL if available
    // For now, we don't exclude any URL since analyst notes come from PDFs, not URLs
    const relatedArticles = finalTicker ? await fetchRelatedArticles(finalTicker) : [];
    
    // Fetch price data for price action line and implied upside calculation (if ticker is available)
    let priceActionLine = '';
    let currentPrice: number | null = null;
    let priceTarget: number | null = null;
    let impliedUpside: number | null = null;
    
    if (finalTicker && finalTicker.trim() !== '' && finalTicker.trim().toUpperCase() !== 'PRICE') {
      console.log(`Fetching price data for ticker: ${finalTicker}`);
      const priceData = await fetchPriceData(finalTicker);
      
      // Extract current price for upside calculation
      if (priceData && priceData.last) {
        currentPrice = typeof priceData.last === 'number' ? priceData.last : parseFloat(priceData.last);
      }
      
      // Extract price target from analyst note text
      const priceTargetPatterns = [
        /\$(\d+(?:\.\d+)?)\s+(?:price\s+)?target/i,
        /price\s+target.*?\$(\d+(?:\.\d+)?)/i,
        /target.*?\$(\d+(?:\.\d+)?)/i,
        /\$(\d+(?:\.\d+)?)\s*PT/i,
        /PT.*?\$(\d+(?:\.\d+)?)/i,
        /raised.*?\$(\d+(?:\.\d+)?)/i,
        /to\s+\$(\d+(?:\.\d+)?)/i,
      ];
      
      for (const pattern of priceTargetPatterns) {
        const match = combinedNoteText.match(pattern);
        if (match && match[1]) {
          priceTarget = parseFloat(match[1]);
          console.log(`Extracted price target: $${priceTarget}`);
          break;
        }
      }
      
      // Calculate implied upside if we have both current price and price target
      if (currentPrice && currentPrice > 0 && priceTarget && priceTarget > 0) {
        impliedUpside = ((priceTarget - currentPrice) / currentPrice) * 100;
        console.log(`Calculated implied upside: ${impliedUpside.toFixed(2)}% (Target: $${priceTarget}, Current: $${currentPrice})`);
      }
      
      // Validate price data - ensure we have valid price information
      const hasValidPrice = priceData && 
                           priceData.last && 
                           (typeof priceData.last === 'number' ? priceData.last > 0 : parseFloat(priceData.last) > 0);
      
      if (hasValidPrice) {
        priceActionLine = generatePriceActionLine(finalTicker, priceData);
        console.log(`Generated price action line: ${priceActionLine.substring(0, 100)}...`);
        
        // Double-check the generated price action line doesn't have invalid data
        // Note: 0.00% is valid during premarket/closed if stock is truly unchanged, so don't reject it
        if (priceActionLine.includes('PRICE shares') || 
            priceActionLine.includes('$0.00')) {
          console.warn(`Generated price action line contains invalid data, using fallback: ${priceActionLine}`);
          priceActionLine = `<strong>${finalTicker} Price Action:</strong> Price data unavailable, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
        }
        
        // Fetch and append ETF information
        try {
          const etfs = await fetchETFs(finalTicker);
          if (etfs && etfs.length > 0) {
            const etfInfo = formatETFInfo(etfs);
            if (etfInfo) {
              priceActionLine += etfInfo;
            }
          }
        } catch (etfError) {
          console.error(`Error fetching ETF data for ${finalTicker}:`, etfError);
          // Continue without ETF info if there's an error
        }
      } else {
        console.warn(`Price data unavailable or invalid for ${finalTicker}, using fallback`);
        // Use a fallback that doesn't include specific price data
        priceActionLine = `<strong>${finalTicker} Price Action:</strong> Price data unavailable, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
      }
    } else {
      console.warn(`⚠️⚠️⚠️ No valid ticker available for price action line (ticker: "${finalTicker}")`);
      console.warn(`⚠️⚠️⚠️ This means priceActionLine will use fallback message. Ticker check failed.`);
      // If no ticker found, use a generic price action line
      priceActionLine = 'Price Action: Stock price data unavailable at the time of publication.';
    }
    
    // Log final price action line that will be used
    console.log(`[PRICE ACTION FINAL] Ticker: "${finalTicker}", Price action line length: ${priceActionLine.length}, Preview: ${priceActionLine.substring(0, 150)}`);

    // Estimate token count (rough: 1 token ≈ 4 characters)
    // Reserve space for prompt (~2000 tokens) and response (~2000 tokens)
    // For gpt-4-turbo/gpt-4o: 128k context, so we can use ~120k for input
    // For gemini-1.5: 1M context, so much more room
    const maxInputChars = provider === 'gemini' 
      ? 800000  // Gemini can handle very long documents
      : 400000; // GPT-4-turbo/gpt-4o can handle ~100k tokens (400k chars)

    const truncatedText = truncateText(combinedNoteText.trim(), maxInputChars);
    
    if (truncatedText !== combinedNoteText.trim()) {
      console.log(`Truncated analyst note(s) from ${combinedNoteText.length} to ${truncatedText.length} characters`);
    }

    const isMultipleNotes = multipleNotes && Array.isArray(multipleNotes) && multipleNotes.length > 1;
    const multipleNotesInstruction = isMultipleNotes 
      ? `\n\nIMPORTANT: You are synthesizing information from ${multipleNotes.length} different analyst notes. Combine insights from all notes into a cohesive narrative. If analysts have different perspectives, ratings, or price targets, present both views clearly. Include all relevant analyst names and firms from the notes.`
      : '';

    const prompt = `Write a news article based on the following analyst note text. Follow the "Benzinga Style" guidelines strictly. This is editorial content for traders - create a compelling narrative with intrigue, conflict, and tradeable information.${multipleNotesInstruction}

### STYLE GUIDELINES:

1. **Headline:** Create an SEO-optimized headline that captures search intent. Prioritize financial data (firm, action, ticker, target) over generic storytelling.
   - **SEO-OPTIMIZED FORMAT:** "[Firm] [Action] [Rating] on [Company] ([Ticker]): [Key Catalyst] Drives $[Target] Target"
   - Examples: "H.C. Wainwright Reiterates Buy on OKYO Pharma (OKYO): New CEO & Data Drive $7 Target" or "BofA Reiterates Buy on Broadcom (AVGO): AI Backlog Drives $500 Target"
   - **CRITICAL: Always include the firm name, rating action (Reiterates, Upgrades, Downgrades), company name, ticker in parentheses, and price target in the headline**
   - Use company name without "Inc." in headline (just "OKYO Pharma" not "OKYO Pharma Limited")
   - **CRITICAL: Headline must be PLAIN TEXT ONLY - NO HTML TAGS, NO BOLD TAGS. Ticker format: ([TICKER]) - no exchange prefix needed**
   - Include specific price target: "$7 Target" or "$500 Target"
   - Keep under 120 characters when possible
   - **CRITICAL: If you use quotation marks in the headline, use SINGLE QUOTES (') not double quotes ("). Example: 'Accelerating Momentum' not "Accelerating Momentum".**
   - **CRITICAL: If you use quotation marks in the headline, the quoted text MUST be an exact word-for-word copy from the source analyst note. Do NOT invent quotes or paraphrase. If you cannot find an exact quote in the source, do not use quotation marks in the headline.**

2. **NO DATELINE:** Do NOT include formal wire service datelines. Jump straight into the lede paragraph.

3. **The Lede (Opening Paragraph):** Lead with the most clickable financial data - firm, analyst name, rating, price target, and implied upside. Make it "greedy" and urgent.
   - **Structure:** Use a section header "<strong>The Analyst Call</strong>" (wrapped in <strong> tags) followed by the opening paragraph.
   - **Opening Paragraph Format:** "[Firm] analysts, led by [Analyst Name], [action] a [Rating] rating on [Company Name] ([Exchange:Ticker]) [day of week], maintaining a bullish $[Target] price target. The firm cites [key catalysts] as the catalysts for a potential [X]%+ rally."
   - **CRITICAL - Analyst Name Required:** You MUST include the specific analyst's name (e.g., "Yi Chen") along with the firm name. Format: "[Firm] analysts, led by [Analyst Name]," or "[Firm]'s [Analyst Name]" or "According to [Analyst Name] of [Firm],". The analyst name is MANDATORY in the lead paragraph.
   - **CRITICAL - Day of Week:** You MUST include the day of the week when the rating was issued in the lead paragraph. ${ratingDayOfWeek && ratingDayOfWeek !== 'today' ? `The analyst note indicates the rating was issued on ${ratingDayOfWeek}. Use "${ratingDayOfWeek}" in the lead (e.g., "reiterated a Buy rating on OKYO Pharma (NASDAQ:OKYO) ${ratingDayOfWeek}").` : 'If a date is found in the analyst note source text, extract it and convert to day name (Monday, Tuesday, etc.). If no date is found, use "today".'}
   - **CRITICAL - Implied Upside in Lead:** If price target and current price are available, you MUST include the implied upside percentage in the lead paragraph to make it more "greedy" and urgent. Use phrases like "potential [X]%+ rally" or "potential [X]% upside" where X is the rounded upside percentage. This creates urgency and makes the lead irresistible.
   - **CRITICAL - Hyperlink in Lead (MANDATORY):** You MUST include exactly one hyperlink in the lead paragraph. The hyperlink must point to the Benzinga analyst ratings page for this stock: ${finalTicker ? `https://www.benzinga.com/quote/${finalTicker}/analyst-ratings` : 'https://www.benzinga.com/quote/[TICKER]/analyst-ratings'}. Select ANY THREE CONSECUTIVE WORDS from your lead paragraph and wrap them in the hyperlink. The hyperlink should be embedded naturally within the sentence flow - do NOT use phrases like "according to analyst ratings" or "see analyst ratings" to introduce it. Simply select three consecutive words that are part of the natural sentence structure and hyperlink them. Example: "H.C. Wainwright reiterated a <a href="https://www.benzinga.com/quote/OKYO/analyst-ratings">Buy rating on</a> OKYO Pharma (NASDAQ:OKYO) today" or "The firm cites the <a href="https://www.benzinga.com/quote/OKYO/analyst-ratings">appointment of a</a> new CEO". The hyperlink MUST appear in the lead paragraph - this is mandatory, not optional.
   - **Example Format (with upside and day):** "<strong>The Analyst Call</strong> H.C. Wainwright analysts, led by Yi Chen, reiterated a <a href="https://www.benzinga.com/quote/OKYO/analyst-ratings">Buy rating on</a> OKYO Pharma (NASDAQ:OKYO) ${ratingDayOfWeek && ratingDayOfWeek !== 'today' ? ratingDayOfWeek : 'today'}, maintaining a bullish $7.00 price target. The firm cites the appointment of a new CEO and promising clinical data as the catalysts for a potential 200%+ rally."
   - **Example Format (without upside - fallback):** "<strong>The Analyst Call</strong> H.C. Wainwright analysts, led by Yi Chen, reiterated a <a href="https://www.benzinga.com/quote/OKYO/analyst-ratings">Buy rating on</a> OKYO Pharma (NASDAQ:OKYO) ${ratingDayOfWeek && ratingDayOfWeek !== 'today' ? ratingDayOfWeek : 'today'}, maintaining a $7.00 price target, citing the appointment of a new CEO and promising clinical data as pivotal growth drivers."
   - **Keep the lede to 2-3 sentences maximum - break into multiple short paragraphs if needed**
${impliedUpside !== null && currentPrice && priceTarget ? `\n   - **IMPLIED UPSIDE FOR LEAD:** Current price: ~$${currentPrice.toFixed(2)}, Price target: $${priceTarget.toFixed(2)}, Implied upside: ${impliedUpside > 0 ? '+' : ''}${impliedUpside.toFixed(0)}%. **You MUST include this upside percentage in the LEAD paragraph** using phrases like "potential ${impliedUpside.toFixed(0)}%+ rally" or "potential ${impliedUpside > 50 ? 'aggressive ' : ''}${impliedUpside.toFixed(0)}% upside". Round to the nearest whole number (e.g., ${impliedUpside.toFixed(0)}% not ${impliedUpside.toFixed(2)}%).` : '\n   - **DATE/DAY EXTRACTION:** Extract the date from the analyst note source text and include the day of the week (Monday, Tuesday, Wednesday, etc.) in the lead. Look for date patterns like "January 5, 2026" or "January 5" and convert to day name. If no date is found, use "today".'}
${impliedUpside !== null && currentPrice && priceTarget ? `\n   - **IMPLIED UPSIDE CALCULATION - "The Math" Section (OPTIONAL):** After the opening paragraph, you may optionally create a separate short section: "<strong>The Math:</strong> With the stock currently trading at ~$${currentPrice.toFixed(2)}, this target implies an ${impliedUpside > 50 ? '"Aggressive Upside"' : impliedUpside > 20 ? '"Significant Upside"' : 'upside'} potential of ${impliedUpside > 0 ? '+' : ''}${impliedUpside.toFixed(0)}%." However, since the upside is already in the lead, this section is optional and may be omitted to avoid redundancy.` : ''}

4. **The Body Structure:** Use 2-4 SEO-optimized section headers that are specific and keyword-rich, not vague:
   - **CRITICAL: All section headers MUST be in H2 format using <h2> tags, NOT <strong> tags. Example: <h2>Strategic Shift: Former Shire Exec Named CEO</h2>**
   - **SEO RULE #3 - The Name Drop Rule:** If the analyst note mentions competitor drugs (e.g., Xiidra, Restasis), previous companies (e.g., Shire, Takeda), or other high-value keywords, **BOLD these terms** in the article body. These are high-value keywords that associate the small cap stock with large cap success. Format: "<strong>Xiidra</strong>" or "<strong>Shire</strong>" (not just "Xiidra" or "Shire")
   - **Header Format Examples (SEO-Optimized):**
     * BAD (vague): "The Leadership Catalyst", "The Clinical Breakthrough"  
     * GOOD (specific, keyword-rich): "Strategic Shift: The 'Blockbuster' CEO", "Phase 2 Data: De-Risking the Asset", "Valuation Insight"
   - Headers should be specific and include keywords: "Phase 2 [Drug Name] Results", "Valuation Insight", "[Firm]'s Investment Thesis", "[Competitor Drug] Creator Joins Leadership"
   - **CRITICAL: NEVER place a section header before the first paragraph. Always start with the opening paragraph (the lede), then place section headers after the first paragraph and throughout the rest of the article.**
   - **CRITICAL: Keep paragraphs SHORT - maximum 2 sentences per paragraph. Break up long thoughts into multiple short paragraphs for better readability.**
   - **CRITICAL - Use Bullets for Credentials/Keywords:** When listing credentials, track records, or key achievements (especially CEO backgrounds, drug names, company names), use bullet points instead of burying them in sentences. This makes high-value keywords instantly visible. Format:
     * Use bullet points with labels: "Former Role: [text]", "Track Record: [text]", "The Impact: [text]"
     * Example: "Dempsey's resume includes:\n• Former Role: Head of Global Ophthalmology at <strong>Shire</strong> (now <strong>Takeda</strong>).\n• Track Record: Successfully led the commercial launches of <strong>Xiidra</strong> and <strong>Restasis</strong>—two of the most dominant dry-eye therapies in the world."
   - Under each header, write 3-5 very short paragraphs (1-2 sentences each) with specific details, using bullets for credentials/keywords when appropriate
   - **QUOTE FORMATTING (CRITICAL): In the BODY of the article, use DOUBLE QUOTES (") for all direct quotes. Example: "momentum is accelerating" not 'momentum is accelerating'. Single quotes (') are ONLY for headlines.**
   - **QUOTE ACCURACY (CRITICAL): When you use quotation marks, the text inside MUST be a word-for-word exact copy from the source. Do NOT reorder words, change word forms, or paraphrase. Example: If source says "momentum is accelerating", you MUST write "momentum is accelerating" - NOT "accelerating momentum". Before using ANY quote, search the source text for the exact phrase word-for-word. If you cannot find the exact phrase, do NOT use quotation marks - paraphrase without quotes instead (e.g., "Cassidy noted that momentum is accelerating" without quotes).**
   - **QUOTE PLACEMENT (CRITICAL): NEVER place quotation marks before dollar amounts or numbers. Examples: Write "consensus $2.5 billion" NOT "consensus" $2.5 billion". Write "target of $61" NOT "target of" $61". Quotes are ONLY for exact word-for-word phrases from the source, never for numbers or dollar amounts.**
   - **POSSESSIVES AND CONTRACTIONS (CRITICAL): ALWAYS use apostrophes (') for possessives and contractions, NEVER use double quotes ("). Examples: "company's" NOT "company"s", "it's" NOT "it"s", "don't" NOT "don"t", "won't" NOT "won"t". Double quotes (") are ONLY for direct quotations, never for possessives or contractions.**
   - Include specific numbers, metrics, and catalysts
   - Use phrases like "Arya believes", "Arya pointed to", "Arya noted" to maintain narrative flow
   - **Never create long, dense paragraphs - always break them into shorter, punchier segments**

5. **Bolding Strategy:** 
   - Bold company names on first mention only (see formatting rules below)
   - **Bold executive/official names on first mention only.** When mentioning company executives, CEOs, CFOs, or other officials (e.g., "Robert J. Dempsey"), bold their full name on the FIRST mention. Example: "<strong>Robert J. Dempsey</strong>" on first mention, then just "Dempsey" without bolding in subsequent references.
   - **Do NOT bold analyst names.** Analyst names (e.g., "Yi Chen") should remain unbolded even on first mention.
   - **All section headers/subheads MUST be in <h2> format, NOT <strong> tags**
   - **Bold competitor drugs, products, and related companies** mentioned in the analyst note (Name Drop Rule). If the note mentions competitor drugs like Xiidra, Restasis, or previous companies like Shire, Takeda, these should be bolded as high-value keywords. Examples: "<strong>Xiidra</strong>", "<strong>Restasis</strong>", "<strong>Shire</strong>", "<strong>Takeda</strong>"
   - Do NOT bold narrative phrases, analyst names, firms, ratings, price targets, numbers, dollar amounts, or metrics (except company names, executive/official names, and competitor products/companies)
   - **CRITICAL: NEVER bold dollar amounts like "$2.5 billion" or numbers - these should always be plain text**

6. **Formatting:** - Use HTML <strong> tags to bold text. DO NOT use markdown ** syntax.
   
   - On FIRST mention only: Bold ONLY the company name, then include the full exchange ticker format without bolding. Example: <strong>Broadcom Inc.</strong> (NASDAQ:AVGO) or <strong>Apple Inc.</strong> (NASDAQ:AAPL). Do NOT bold the exchange or ticker. Use no space after the colon (NASDAQ:AVGO not NASDAQ: AVGO).
   
   - After first mention: Do NOT bold the company name in follow-up references. Just use "Broadcom" or "Apple" without bolding.
   
   - **Bold executive/official names on first mention only.** When mentioning CEOs, CFOs, or other company officials, bold their full name on first mention. Example: "<strong>Robert J. Dempsey</strong>" on first mention, then "Dempsey" without bolding afterwards.
   
   - **Do NOT bold analyst names.** Analyst names like "Yi Chen" should remain unbolded even on first mention.
   
   - **Bold competitor drugs and related companies** mentioned in the analyst note when they appear (Name Drop Rule). These are high-value SEO keywords. Examples: "<strong>Xiidra</strong>", "<strong>Shire</strong>", "<strong>Takeda</strong>"
   
   - Do NOT bold any other text - no numbers, metrics, analyst names, firms, or phrases (except company names, executive/official names, and competitor products/companies mentioned above)

7. **Price Action Footer (REQUIRED):** Every article MUST end with a one-sentence "Price Action" line. DO NOT generate this yourself - it will be provided separately. Just end your article content before the Price Action line.

8. **Valuation & Upside Section (REQUIRED when price target available):**
   - If a price target is mentioned, create a dedicated section discussing the valuation and implied upside
   - **Calculate and prominently display the implied upside percentage** using the formula: ((Target Price - Current Price) / Current Price) * 100
   - Use phrases like "Implied Upside", "Upside Potential", or "Aggressive Upside" (if >50%)
   - Include the current price and price target in this section: "With shares trading at $[Current], the $[Target] target implies [X]% upside potential"
   - Explain why the target is justified based on the analyst's thesis

9. **Tone & Voice:** 
   - Editorial, narrative-driven - tell a story, create intrigue
   - Use phrases that create conflict or tension: "bears are ignoring", "undue noise", "smashing expectations"
   - Include analyst quotes to support narrative points
   - Fast-paced but with narrative flow - not just a list of facts
   - Create story elements around key catalysts (e.g., "mystery customer", "Apple Factor")
   - Use active voice and engaging language
   - **Prioritize financial data and SEO keywords** - don't bury the most clickable information under generic narrative

### INPUT TEXT (Analyst Note${isMultipleNotes ? 's' : ''}):

${truncatedText}

### OUTPUT ARTICLE:`;

    const impliedUpsideInstruction = impliedUpside !== null && currentPrice && priceTarget 
      ? ` CRITICAL SEO REQUIREMENT - IMPLIED UPSIDE: Current price is $${currentPrice.toFixed(2)}, price target is $${priceTarget.toFixed(2)}, which implies ${impliedUpside > 0 ? '+' : ''}${impliedUpside.toFixed(2)}% upside. ${impliedUpside > 50 ? 'This represents Aggressive Upside (>50%) - use the phrase "Aggressive Upside" in your article.' : impliedUpside > 20 ? 'This represents Significant Upside (>20%) - use the phrase "Significant Upside" in your article.' : ''} You MUST prominently include this implied upside calculation, preferably in the lede paragraph or a dedicated "Valuation & Upside Potential" section.`
      : '';

    const result = await aiProvider.generateCompletion(
      [
        {
          role: "system",
          content: `You are an editorial financial journalist writing for Benzinga, a fast-paced trading news site. Your articles are read by traders who scan content quickly but appreciate compelling narratives with strong SEO optimization. Create editorial, story-driven content with intrigue, conflict, and tradeable information, BUT prioritize SEO-friendly financial data (price targets, upside, analyst names, firm names) over generic storytelling. Use narrative hooks, create story elements (like 'mystery customer'), and include analyst quotes to support the narrative. CRITICAL: Use <h2> tags for ALL section headers/subheads (NOT <strong> tags), except for "The Analyst Call" and "The Math:" which should use <strong> tags. Example: <h2>Strategic Shift: The 'Blockbuster' CEO</h2> or <strong>The Analyst Call</strong>. NEVER include formal datelines or conclusion sections. NEVER use essay-style phrases like "In conclusion", "In summary", "To conclude", "In closing", "To wrap up", "To sum up", "In final analysis", "Ultimately", or "In the end" - news articles don't have conclusions, they just end. Do NOT generate a Price Action line - it will be added automatically. Use HTML <strong> tags for bold text, NOT markdown ** syntax. ONLY bold company names on first mention. BOLD executive/official names (CEOs, CFOs, etc.) on first mention only (e.g., <strong>Robert J. Dempsey</strong> on first mention, then "Dempsey" without bolding). Do NOT bold analyst names (e.g., "Yi Chen" should remain unbolded). Also BOLD competitor drugs, products, and related companies mentioned in the note (e.g., <strong>Xiidra</strong>, <strong>Shire</strong>, <strong>Takeda</strong>) as these are high-value SEO keywords. Use bullet points (•) for credentials, track records, and key achievements to make high-value keywords instantly visible - don't bury them in dense paragraphs. Format bullets with labels like "Former Role:", "Track Record:", "The Impact:". AVOID CLICHÉS: Do NOT use fluff phrases like "has sent ripples through", "brings a wealth of experience", "brings a wealth", "has sent ripples" - instead use direct language like "signals a commercial pivot for", "is a veteran of", "has experience", "signals". Do NOT bold any other text (no numbers, metrics, analyst names, firms, or phrases) except for company names, executive/official names, and competitor products/companies. Always include the analyst's full name (e.g., "Yi Chen") along with the firm name (e.g., "H.C. Wainwright") in the first paragraph. CRITICAL LEAD PARAGRAPH FORMAT: Include the day of the week when the rating was issued (e.g., "today", "Monday", "Tuesday") and include the implied upside percentage if available (e.g., "potential 200%+ rally") to make the lead more compelling and urgent. MANDATORY HYPERLINK: You MUST include exactly one hyperlink in the lead paragraph pointing to ${finalTicker ? `https://www.benzinga.com/quote/${finalTicker}/analyst-ratings` : 'the Benzinga analyst ratings page'}. Select any three consecutive words from the lead and wrap them in <a href="${finalTicker ? `https://www.benzinga.com/quote/${finalTicker}/analyst-ratings` : 'https://www.benzinga.com/quote/[TICKER]/analyst-ratings'}">three consecutive words</a>. Embed it naturally in the sentence flow - do NOT use intro phrases. On first mention, bold ONLY the company name (e.g., <strong>Broadcom Inc.</strong>), then include the full exchange ticker format (NASDAQ:AVGO) without bolding and with no space after the colon. MOST IMPORTANT: Keep ALL paragraphs SHORT - maximum 2 sentences per paragraph. Break up any long thoughts into multiple short, punchy paragraphs. Never create dense blocks of text. CRITICAL: Use APOSTROPHES (') for possessives (e.g., company's, BofA's, Bristol-Myers Squibb's). NEVER use double quotes (\") for possessives. QUOTE FORMATTING: Use SINGLE QUOTES (') in headlines only. Use DOUBLE QUOTES (\") in the body of the article for all direct quotes. QUOTE ACCURACY IS ABSOLUTELY CRITICAL IN HEADLINES AND BODY: If you use quotation marks anywhere (headline or body), the text inside MUST be a word-for-word exact copy from the source. Do NOT reorder words, change word forms, or paraphrase. Example: If source says 'momentum is accelerating', you MUST write 'momentum is accelerating' in headlines or \"momentum is accelerating\" in body - NOT 'accelerating momentum' or \"accelerating momentum\". Before using ANY quote in the headline or body, search the source text for the exact phrase word-for-word. If you cannot find the exact phrase, do NOT use quotation marks - paraphrase without quotes instead.${impliedUpsideInstruction}`
        },
        {
          role: "user",
          content: prompt
        }
      ],
      {
        // Use models with larger context windows
        model: provider === 'gemini' ? 'gemini-2.5-flash' : 'gpt-4-turbo',
        temperature: 0.5, // Lower temperature for more accurate quotes
        maxTokens: 2000,
      },
      provider
    );

    let article = result.content.trim();

    if (!article) {
      return NextResponse.json({ error: 'Failed to generate article' }, { status: 500 });
    }

    // Post-process: Convert any markdown **bold** syntax to HTML <strong> tags
    // This ensures compatibility even if the AI occasionally uses markdown
    // BUT: Don't bold dollar amounts, numbers, or metrics
    article = article.replace(/\*\*([^*]+?)\*\*/g, (match, content) => {
      // Don't bold if it's a dollar amount, number, or metric
      if (/^\$[\d.,]+\s*(billion|million|thousand|B|M|K)?$/i.test(content.trim()) ||
          /^[\d.,]+\s*(billion|million|thousand|B|M|K|%|percent)$/i.test(content.trim()) ||
          /^\$[\d.,]+$/.test(content.trim())) {
        return content; // Return without bold tags
      }
      return `<strong>${content}</strong>`;
    });
    
    // Fix misplaced quotes before dollar amounts or numbers
    // Pattern: word" $number or word" number (remove the quote before $ or number)
    article = article.replace(/([a-zA-Z])"\s*(\$[\d.,]+|[\d.,]+\s*(?:billion|million|thousand|B|M|K))/gi, "$1 $2");
    
    // Fix quotes that appear right before dollar signs in the middle of sentences
    // Pattern: " $number (quote mark followed by space and dollar sign)
    article = article.replace(/"\s*(\$[\d.,]+)/g, "$1");
    
    // Remove bold tags from dollar amounts and numbers (should never be bolded)
    // Pattern: <strong>$X.X billion</strong> or <strong>$X</strong>
    article = article.replace(/<strong>(\$[\d.,]+\s*(?:billion|million|thousand|B|M|K)?)<\/strong>/gi, "$1");
    article = article.replace(/<strong>([\d.,]+\s*(?:billion|million|thousand|B|M|K|%|percent))<\/strong>/gi, "$1");
    
    // Extract headline (first line before any blank line or paragraph break)
    const headlineMatch = article.match(/^([^\n]+)/);
    let headline = headlineMatch ? headlineMatch[1] : '';
    
    // Remove all HTML tags from headline (headlines should be plain text only)
    headline = headline.replace(/<[^>]*>/g, '');
    
    // Remove ticker format patterns like "(NASDAQ:LULU)" or "(NYSE:AAPL)" from headline
    headline = headline.replace(/\s*\([A-Z]+:[A-Z]+\)/gi, '');
    
    // Remove quotes that wrap the entire headline (common AI mistake)
    // Check if headline starts and ends with matching quotes
    headline = headline.trim();
    if ((headline.startsWith("'") && headline.endsWith("'")) || 
        (headline.startsWith('"') && headline.endsWith('"'))) {
      headline = headline.slice(1, -1).trim();
    }
    
    // Fix possessives that were incorrectly generated with double quotes (e.g., "company"s" -> "company's", "Apple"s" -> "Apple's")
    // Also fix contractions like "isn"t" -> "isn't"
    // Be VERY aggressive - match any letter followed by "s" or "S"
    
    // First pass: match letter + "s with various following characters
    headline = headline.replace(/([a-zA-Z])"([sS])(?!["'])/g, "$1'$2");
    headline = headline.replace(/([a-zA-Z])"([sS])\s/g, "$1'$2 ");
    headline = headline.replace(/([a-zA-Z])"([sS])([.,;:!?\)\]\}])/g, "$1'$2$3");
    
    // Fix contractions
    headline = headline.replace(/([a-zA-Z]{2,})"([td])(?!["'])/g, "$1'$2");
    headline = headline.replace(/([a-zA-Z]{2,})"([td])\s/g, "$1'$2 ");
    headline = headline.replace(/([a-zA-Z]{2,})"([td])([.,;:!?\)\]\}])/g, "$1'$2$3");
    
    // Final pass: catch any remaining letter + "s patterns
    headline = headline.replace(/([a-zA-Z])"([sS])/g, "$1'$2");
    
    // Convert double quotes to single quotes in headline (for quoted phrases within headline)
    headline = headline.replace(/"([^"]+)"/g, "'$1'");
    
    // Decode HTML entities that might remain
    headline = headline.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    
    // Clean up any extra whitespace
    headline = headline.replace(/\s+/g, ' ').trim();
    
    // Remove headline from article body (everything after first line)
    let articleBody = headlineMatch ? article.substring(headlineMatch[0].length).trim() : article;
    
    // Clean up any leading newlines or whitespace
    articleBody = articleBody.replace(/^\n+/, '').trim();
    
    // If articleBody is empty or too short, use the full article (maybe headline wasn't on first line)
    if (!articleBody || articleBody.length < 50) {
      console.warn('Article body too short after headline extraction, using full article. Body length:', articleBody?.length);
      articleBody = article.trim();
      // Try to find and remove headline from body if it appears (but only if it's at the start)
      if (headline && articleBody.startsWith(headline)) {
        articleBody = articleBody.substring(headline.length).trim();
      } else if (headline) {
        // Try to find headline anywhere and remove it
        const headlineIndex = articleBody.indexOf(headline);
        if (headlineIndex === 0 || (headlineIndex > 0 && headlineIndex < 100)) {
          articleBody = articleBody.substring(headlineIndex + headline.length).trim();
        }
      }
    }
    
    // PRIORITY FIX: Fix possessives that were incorrectly generated with double quotes
    // In English text, letter + "s is ALWAYS a possessive, never a quotation mark
    // Use the simplest, most direct pattern: match ANY letter + "s and replace with 's
    // This will catch: company"s, BofA"s, it"s, Apple"s, Squibb"s, BMY"s, etc.
    
    // Direct replacement - match any letter (upper or lower) followed by "s or "S
    articleBody = articleBody.replace(/([a-zA-Z])"([sS])/g, "$1'$2");
    
    // Fix contractions: match word + "t or "d (isn"t, don"t, won"t, etc.)
    articleBody = articleBody.replace(/([a-zA-Z]{2,})"([td])/g, "$1'$2");
    
    // Double-check pass: if any "s still exists after a letter, fix it (safety net)
    articleBody = articleBody.replace(/([a-zA-Z])"([sS])/g, "$1'$2");
    
    // Convert single quotes in body to double quotes (headlines should use single quotes, body should use double)
    // This handles cases where the AI uses single quotes in the body instead of double quotes
    // Pattern: Match single quotes that contain at least 2 characters (to avoid matching apostrophes in contractions)
    // Match quotes that are likely direct quotations (have spaces/punctuation around them)
    // IMPORTANT: Do this AFTER fixing possessives to avoid converting apostrophes to quotes
    articleBody = articleBody.replace(/\b'([^']{2,})'\b/g, '"$1"');
    // Also handle quotes at sentence boundaries
    articleBody = articleBody.replace(/(\s|>|\(|\[|{)'([^']{2,})'(\s|\.|,|;|:|!|\?|\)|]|}|$|<)/g, '$1"$2"$3');
    
    console.log('Article body length after processing:', articleBody.length);
    console.log('Article body preview (first 200 chars):', articleBody.substring(0, 200));
    
    // Verify quotes in headline match source exactly
    if (headline) {
      // Match single quotes (but not apostrophes in contractions) - look for quotes with at least 2 characters
      // Pattern: ' followed by at least 2 non-quote chars, then '
      const singleQuotes = headline.match(/'([^']{2,})'/g) || [];
      // Match double quotes
      const doubleQuotes = headline.match(/"([^"]{2,})"/g) || [];
      const allHeadlineQuotes = [...singleQuotes, ...doubleQuotes];
      const sourceTextLower = analystNoteText.toLowerCase();
      
      allHeadlineQuotes.forEach(quote => {
        // Extract just the quoted text, removing the quote marks
        const quoteText = quote.replace(/^['"]|['"]$/g, '').trim();
        // Skip very short quotes (likely apostrophes) - need at least 3 chars
        if (quoteText.length < 3) {
          return;
        }
        
        const quoteTextLower = quoteText.toLowerCase();
        
        // Check if quote appears in source (exact match first)
        if (!sourceTextLower.includes(quoteTextLower)) {
          // For headline, be strict - if exact match not found, warn
          console.warn(`⚠️ INACCURATE QUOTE IN HEADLINE: "${quoteText}" - This exact phrase was not found in the source text.`);
        }
      });
    }
    
    // Verify quotes in body match source exactly (skip headline, already checked)
    const quotes = articleBody.match(/"([^"]{4,})"/g) || articleBody.match(/'([^']{4,})'/g);
    if (quotes) {
      const sourceTextLower = analystNoteText.toLowerCase();
      quotes.forEach(quote => {
        // Extract just the quoted text
        const quoteText = quote.replace(/^['"]|['"]$/g, '').trim();
        // Skip very short quotes (likely apostrophes or single words that might be accurate)
        if (quoteText.length < 4) {
          return;
        }
        
        const quoteTextLower = quoteText.toLowerCase();
        
        // First check: exact match (case-insensitive)
        if (sourceTextLower.includes(quoteTextLower)) {
          // Quote found exactly, skip warning
          return;
        }
        
        // Second check: check if words are in same order (more lenient for body text)
        const quoteWords = quoteTextLower.split(/\s+/).filter(w => w.length > 2); // Only check words longer than 2 chars
        if (quoteWords.length > 0) {
          // Check if all words appear in source in roughly the same order
          let sourceIndex = 0;
          let wordsFoundInOrder = 0;
          for (const word of quoteWords) {
            const wordIndex = sourceTextLower.indexOf(word, sourceIndex);
            if (wordIndex !== -1) {
              wordsFoundInOrder++;
              sourceIndex = wordIndex + word.length;
            } else {
              // Word not found, try from beginning
              const wordIndexFromStart = sourceTextLower.indexOf(word);
              if (wordIndexFromStart !== -1) {
                wordsFoundInOrder++;
                sourceIndex = wordIndexFromStart + word.length;
              }
            }
          }
          
          // If less than 70% of words found in order, it's likely inaccurate (more lenient for body)
          if (wordsFoundInOrder / quoteWords.length < 0.7) {
            console.warn(`⚠️ INACCURATE QUOTE DETECTED: "${quoteText}" - This exact phrase was not found in the source text. The AI may have paraphrased instead of using an exact quote.`);
          }
        }
      });
    }
    
    // Remove any section header that appears at the very beginning of the article (before first paragraph)
    // Headers should never come before the opening paragraph
    // Pattern matches: <strong>Header Text</strong> or Header Text at start of article
    const headerAtStartPattern = /^(<strong>)?([A-Z][^<\n]{10,100}:?)(<\/strong>)?(\s*\n\s*)/m;
    const startMatch = articleBody.match(headerAtStartPattern);
    if (startMatch && startMatch.index === 0) {
      // Check if this looks like a header (not a sentence - no period, reasonable length, title case)
      const potentialHeader = (startMatch[2] || startMatch[0]).trim();
      const isLikelyHeader = !potentialHeader.includes('.') && 
                            potentialHeader.length > 10 && 
                            potentialHeader.length < 100 &&
                            /^[A-Z]/.test(potentialHeader) && // Starts with capital
                            !potentialHeader.toLowerCase().startsWith('in a') && // Not "In a bold move..."
                            !potentialHeader.toLowerCase().startsWith('analysts'); // Not "Analysts at..."
      
      if (isLikelyHeader) {
        console.log('Removing header that appears before first paragraph:', potentialHeader);
        // Remove the header and any following newlines/whitespace
        articleBody = articleBody.substring(startMatch[0].length).trim();
      }
    }
    
    // Remove bold tags from dollar amounts and numbers (should never be bolded)
    // This must happen before other bold processing
    articleBody = articleBody.replace(/<strong>(\$[\d.,]+\s*(?:billion|million|thousand|B|M|K)?)<\/strong>/gi, "$1");
    articleBody = articleBody.replace(/<strong>([\d.,]+\s*(?:billion|million|thousand|B|M|K|%|percent))<\/strong>/gi, "$1");
    
    // Fix misplaced quotes before dollar amounts (e.g., "consensus" $2.5 billion)
    articleBody = articleBody.replace(/([a-zA-Z])"\s*(\$[\d.,]+)/gi, "$1 $2");
    articleBody = articleBody.replace(/"\s*(\$[\d.,]+)/g, "$1");
    
    // Convert <strong> headers to <h2> format if they're section headers
    // Pattern: <strong>Header Text</strong> at start of line (but not "The Analyst Call" or "The Math" which should stay as <strong>)
    articleBody = articleBody.replace(/^(<strong>)([^<]+)(<\/strong>)(\s*\n|$)/gm, (match, openTag, headerText, closeTag, newline) => {
      // Keep "The Analyst Call" and "The Math" as <strong>, convert others to <h2>
      if (headerText.trim() === 'The Analyst Call' || headerText.trim() === 'The Math:') {
        return match; // Keep as is
      }
      // Convert other headers to H2 format
      return `<h2>${headerText.trim()}</h2>${newline}`;
    });
    
    // Also convert standalone headers (not wrapped in tags) to H2 format
    // Pattern: Header text that looks like a section header (starts with capital, has colon, reasonable length)
    articleBody = articleBody.replace(/^([A-Z][^<\n]{5,80}:?)(\s*\n|$)/gm, (match, header, newline) => {
      // Only convert if it looks like a header (not already in tags, not a sentence, reasonable length)
      if (!header.includes('<') && !header.includes('>') && header.length > 5 && header.length < 80 && !header.includes('.') && !header.trim().toLowerCase().startsWith('in a')) {
        // Skip if it's the first paragraph or looks like regular text
        return `<h2>${header.trim()}</h2>${newline}`;
      }
      return match;
    });
    
    // Remove bold tags from company name after first mention
    // Extract company name from first mention (e.g., <strong>Broadcom Inc.</strong>)
    // Also extract it to use in price action line (to ensure consistency with article)
    let extractedCompanyName = null;
    const firstMentionMatch = articleBody.match(/<strong>([^<]+(?:Inc\.?|Corp\.?|LLC|Ltd\.?)?)<\/strong>\s*\([A-Z]+:[A-Z]+\)/i);
    if (firstMentionMatch) {
      extractedCompanyName = firstMentionMatch[1];
      const companyName = extractedCompanyName;
      // Remove "Inc.", "Corp.", etc. for matching (just use base name)
      const baseCompanyName = companyName.replace(/\s+(Inc\.?|Corp\.?|LLC|Ltd\.?)$/i, '').trim();
      
      // After the first mention, remove bold tags from subsequent mentions
      // Split article into parts: before first mention, first mention, and after
      const firstMentionIndex = articleBody.indexOf(firstMentionMatch[0]);
      const afterFirstMention = articleBody.substring(firstMentionIndex + firstMentionMatch[0].length);
      
      // Remove <strong> tags from company name in the rest of the article
      // Match patterns like <strong>Broadcom</strong> or <strong>Broadcom Inc.</strong>
      const companyNamePatterns = [
        new RegExp(`<strong>${baseCompanyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s+(?:Inc\\.?|Corp\\.?|LLC|Ltd\\.?))?<\\/strong>`, 'gi'),
        new RegExp(`<strong>${companyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<\\/strong>`, 'gi')
      ];
      
      let cleanedAfter = afterFirstMention;
      for (const pattern of companyNamePatterns) {
        cleanedAfter = cleanedAfter.replace(pattern, (match) => {
          // Remove the <strong> tags, keep the company name
          return match.replace(/<\/?strong>/g, '');
        });
      }
      
      articleBody = articleBody.substring(0, firstMentionIndex + firstMentionMatch[0].length) + cleanedAfter;
    }
    
    // Remove any Price Action line that the AI might have generated
    // We'll add the real one from Benzinga API
    // Match both "Price Action:" and "TICKER Price Action:" patterns
    const beforeRemoval = articleBody;
    articleBody = articleBody.replace(/\n\n[A-Z]+ Price Action:.*$/i, '');
    articleBody = articleBody.replace(/\n\nPrice Action:.*$/i, '');
    articleBody = articleBody.replace(/[A-Z]+ Price Action:.*$/i, '');
    articleBody = articleBody.replace(/Price Action:.*$/i, '');
    
    if (beforeRemoval !== articleBody) {
      console.log('✅ Removed AI-generated price action line from article body');
    }
    
    // Remove essay-style conclusion paragraphs and sentences
    // Pattern: Paragraphs that start with "In conclusion", "In summary", "To conclude", etc.
    // Match both plain text and HTML wrapped versions
    const conclusionPatterns = [
      /(In conclusion|In summary|To conclude|In closing|To wrap up|To sum up|In final analysis|Ultimately,|In the end,)[^<]*?\./gi,
      /(In conclusion|In summary|To conclude|In closing|To wrap up|To sum up|In final analysis|Ultimately,|In the end,)[^<]*?$/gi,
    ];
    
    for (const pattern of conclusionPatterns) {
      // Remove from plain text (double newline format)
      articleBody = articleBody.replace(new RegExp(`\\n\\n${pattern.source}`, 'gi'), '');
      // Remove from HTML format (wrapped in <p> tags)
      articleBody = articleBody.replace(new RegExp(`<p>${pattern.source}<\\/p>`, 'gi'), '');
      // Remove standalone (might be at start of line or after other content)
      articleBody = articleBody.replace(pattern, '');
    }
    
    // Remove essay-style conclusion language at the end (e.g., "By positioning...", "With strategic leadership...")
    // Pattern: Paragraphs that use conclusion-like language at the end
    const conclusionLanguagePatterns = [
      /By positioning[^<]*?(?:outlook|growth|disruption|future|potential|success|commitment|innovation|case|trajectory|upside|poised|watching|aiming|capture)\./gi,
      /With strategic leadership[^<]*?(?:growth|disruption|future|potential|success|outlook|trajectory|set towards|poised|watching|aiming|capture)\./gi,
      /With [^<]*?at the helm[^<]*?(?:poised|watching|aiming|capture|growth|potential|success|outlook|trajectory)\./gi,
      /Investors are watching[^<]*?(?:poised|aiming|capture|growth|potential|success|outlook|trajectory|development|advance)\./gi,
    ];
    
    for (const pattern of conclusionLanguagePatterns) {
      // Remove from plain text (double newline format)
      articleBody = articleBody.replace(new RegExp(`\\n\\n${pattern.source}`, 'gi'), '');
      // Remove from HTML format (wrapped in <p> tags)
      articleBody = articleBody.replace(new RegExp(`<p>${pattern.source}<\\/p>`, 'gi'), '');
      // Also try to match full paragraphs ending with these patterns
      articleBody = articleBody.replace(new RegExp(`[^<]*?${pattern.source}`, 'gi'), '');
    }
    
    // Additional catch-all: Remove any paragraph that ends with typical conclusion language
    articleBody = articleBody.replace(/\n\n[^<]*?(?:poised for|watching closely|aiming to|set towards|capture a|significant upside|market disruption|advances its|later stages|continues to innovate|market's response|crucial for investors)[^<]*?\.$/gim, '');
    articleBody = articleBody.replace(/<p>[^<]*?(?:poised for|watching closely|aiming to|set towards|capture a|significant upside|market disruption|advances its|later stages|continues to innovate|market's response|crucial for investors)[^<]*?\.<\/p>/gi, '');
    // More aggressive: Remove paragraphs that end with conclusion-like phrases anywhere in the article
    articleBody = articleBody.replace(/[^<]*?(?:continues to innovate|market's response|crucial for investors|watching the biotech|response to these developments)[^<]*?\./gi, '');
    
    // More aggressive removal: Match "In summary" even if it's part of a longer paragraph
    articleBody = articleBody.replace(/\n\n[^<]*?In summary[^<]*?\./gi, '');
    articleBody = articleBody.replace(/<p>[^<]*?In summary[^<]*?\.<\/p>/gi, '');
    articleBody = articleBody.replace(/In summary[^<]*?\./gi, '');
    
    // Remove cliché phrases and replace with more direct language
    articleBody = articleBody.replace(/has sent ripples through/gi, 'signals a commercial pivot for');
    articleBody = articleBody.replace(/brings a wealth of experience/gi, 'is a veteran of');
    articleBody = articleBody.replace(/brings a wealth/gi, 'has experience');
    articleBody = articleBody.replace(/has sent ripples/gi, 'signals');
    
    // Fix executive name bolding - ensure only first mention is bolded
    // Pattern: Find all bolded full names (e.g., <strong>Robert J. Dempsey</strong>)
    // Then unbold any subsequent bolded references to that person's last name
    const boldedExecutiveMatches = articleBody.matchAll(/<strong>([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)*[A-Z][a-z]+)<\/strong>/g);
    const boldedNames = Array.from(boldedExecutiveMatches);
    
    if (boldedNames.length > 0) {
      boldedNames.forEach(match => {
        const fullName = match[1]; // The captured name without tags
        // Extract last name (last word)
        const nameParts = fullName.trim().split(/\s+/);
        const lastName = nameParts[nameParts.length - 1];
        
        if (lastName && lastName.length > 1) {
          // Find the first occurrence of this specific bolded full name
          const firstOccurrenceIndex = articleBody.indexOf(match[0]);
          
          // After the first occurrence, unbold any bolded instances of the last name
          if (firstOccurrenceIndex >= 0) {
            const beforeFirst = articleBody.substring(0, firstOccurrenceIndex + match[0].length);
            const afterFirst = articleBody.substring(firstOccurrenceIndex + match[0].length);
            
            // Replace <strong>LastName</strong> with just LastName (only after first mention)
            const fixedAfter = afterFirst.replace(
              new RegExp(`<strong>${lastName}<\\/strong>`, 'gi'),
              lastName
            );
            
            articleBody = beforeFirst + fixedAfter;
          }
        }
      });
    }
    
    // FINAL PASS: Fix any remaining possessives that might have been missed or re-introduced
    // This is the absolute last step to ensure ALL possessives are fixed
    // Use the same simple pattern - match ANY letter + "s and replace
    articleBody = articleBody.replace(/([a-zA-Z])"([sS])/g, "$1'$2");
    articleBody = articleBody.replace(/([a-zA-Z]{2,})"([td])/g, "$1'$2");
    
    // Ensure hyperlink to Benzinga analyst ratings page is in the lead paragraph
    if (finalTicker && finalTicker.trim() !== '') {
      const analystRatingsUrl = `https://www.benzinga.com/quote/${finalTicker}/analyst-ratings`;
      const hyperlinkPattern = new RegExp(`https://www\\.benzinga\\.com/quote/${finalTicker}/analyst-ratings`, 'i');
      
      // Check if hyperlink already exists in the first few paragraphs (lead area)
      const leadArea = articleBody.substring(0, Math.min(1000, articleBody.length));
      
      if (!hyperlinkPattern.test(leadArea)) {
        console.log('Adding hyperlink to Benzinga analyst ratings page in lead paragraph');
        
        // Try to find "reiterated a Buy rating" or similar pattern and wrap three words
        const ratingPattern = /(reiterated|maintains|upgraded|downgraded)\s+(a|an)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(rating)/i;
        const match = leadArea.match(ratingPattern);
        
        if (match && match.index !== undefined) {
          // Insert hyperlink around "a Buy rating" or similar
          const beforeMatch = articleBody.substring(0, match.index + match[1].length + 1);
          const threeWords = `${match[2]} ${match[3]} ${match[4]}`;
          const afterMatch = articleBody.substring(match.index + match[0].length);
          const hyperlinkText = `<a href="${analystRatingsUrl}">${threeWords}</a>`;
          
          articleBody = beforeMatch + ' ' + hyperlinkText + afterMatch;
          console.log(`✅ Added hyperlink to analyst ratings page: "${threeWords}" -> ${analystRatingsUrl}`);
        } else {
          // Fallback: try to find "analysts, led by" pattern
          const analystPattern = /(analysts, led by\s+)([A-Z][a-z]+\s+[A-Z][a-z]+)/i;
          const analystMatch = leadArea.match(analystPattern);
          
          if (analystMatch && analystMatch.index !== undefined) {
            const beforeMatch = articleBody.substring(0, analystMatch.index);
            const threeWords = `analysts, led by`;
            const afterMatch = articleBody.substring(analystMatch.index + threeWords.length);
            const hyperlinkText = `<a href="${analystRatingsUrl}">${threeWords}</a>`;
            
            articleBody = beforeMatch + hyperlinkText + afterMatch;
            console.log(`✅ Added hyperlink to analyst ratings page (fallback): "${threeWords}" -> ${analystRatingsUrl}`);
          } else {
            console.warn('⚠️ Could not find suitable location to insert analyst ratings hyperlink in lead paragraph');
          }
        }
      } else {
        console.log('✅ Hyperlink to analyst ratings page already present in lead paragraph');
      }
    }
    
    // Add "Also Read" and "Read Next" sections if related articles are available
    if (relatedArticles && relatedArticles.length > 0) {
      // Use different articles for "Also Read" and "Read Next" when possible
      // If only one article is available, skip "Read Next" to avoid duplicate links
      const alsoReadArticle = relatedArticles[0];
      const readNextArticle = relatedArticles.length > 1 ? relatedArticles[1] : null;
      
      // Check if "Also Read" section exists
      const alsoReadPattern = /(?:<p>)?Also Read:.*?(?:<\/p>)?/i;
      const alsoReadMatch = articleBody.match(alsoReadPattern);
      const alsoReadExists = !!alsoReadMatch;
      
      if (!alsoReadExists) {
        console.log('Adding "Also Read" section');
        // Split content by double newlines (paragraph breaks) or </p> tags
        // Handle both HTML and plain text formats
        const hasHTMLTags = articleBody.includes('</p>');
        let paragraphs: string[];
        
        if (hasHTMLTags) {
          // HTML format: split by </p> tags
          paragraphs = articleBody.split('</p>').filter(p => p.trim().length > 0);
        } else {
          // Plain text format: split by double newlines
          paragraphs = articleBody.split(/\n\s*\n/).filter(p => p.trim().length > 0);
        }
        
        // Insert "Also Read" BEFORE the first header (h2 tag), not after paragraphs
        // Find the first header (h2) and insert before it
        let headerIndex = -1;
        for (let i = 0; i < paragraphs.length; i++) {
          if (paragraphs[i].includes('<h2>') || paragraphs[i].match(/^<strong>[A-Z][^<]+:<\/strong>/)) {
            headerIndex = i;
            break;
          }
        }
        
        // Always use HTML link format even if content is plain text (for clickable links)
        // Add line break after for proper spacing
        const alsoReadSection = `Also Read: <a href="${alsoReadArticle.url}">${alsoReadArticle.headline}</a>`;
        
        if (headerIndex > 0) {
          // Insert before the first header
          paragraphs.splice(headerIndex, 0, alsoReadSection);
          console.log(`✅ "Also Read" section placed before header at index ${headerIndex}`);
        } else if (paragraphs.length >= 2) {
          // Fallback: If no header found, insert after second paragraph (original behavior)
          paragraphs.splice(2, 0, alsoReadSection);
          console.log(`✅ "Also Read" section placed after second paragraph (no header found)`);
        } else {
          console.log('⚠️ Not enough paragraphs to insert "Also Read"');
        }
        
        // Rejoin content (after insertion, if it happened)
        if (headerIndex > 0 || (paragraphs.length >= 2 && headerIndex === -1)) {
          if (hasHTMLTags) {
            articleBody = paragraphs.map(p => {
              // If it already ends with </p>, return as-is
              if (p.trim().endsWith('</p>')) return p;
              // If it's the alsoReadSection, wrap in <p> tags and ensure line break after
              if (p.includes('Also Read:')) return `<p>${p}</p>\n\n`;
              // Otherwise, add </p> back
              return p + '</p>';
            }).join('');
          } else {
            // For plain text, ensure line break after "Also Read" section
            articleBody = paragraphs.map(p => {
              if (p.includes('Also Read:')) return p + '\n\n';
              return p;
            }).join('\n\n');
          }
        }
      } else {
        console.log('"Also Read" section already exists');
      }
      
      // Only add "Read Next" if we have a different article (at least 2 articles)
      if (readNextArticle && !articleBody.includes('Read Next:')) {
        console.log('Adding "Read Next" section');
        // Check if article uses HTML format
        const hasHTMLTags = articleBody.includes('</p>');
        // Always use HTML link format (for clickable links)
        const readNextLink = `Read Next: <a href="${readNextArticle.url}">${readNextArticle.headline}</a>`;
        const readNextSection = hasHTMLTags ? `<p>${readNextLink}</p>` : readNextLink;
        
        console.log(`✅ Using different article for "Read Next" (article 2 of ${relatedArticles.length})`);
        
        // Insert before price action line (which will be added next)
        // Add it at the end for now, it will be before price action
        articleBody = articleBody.trim() + '\n\n' + readNextSection;
        console.log('✅ "Read Next" section added before price action');
      } else if (!readNextArticle) {
        console.log('⚠️ Only one related article available, skipping "Read Next" to avoid duplicate link');
      } else {
        console.log('"Read Next" section already exists');
      }
    } else {
      console.log('No related articles available for "Also Read" and "Read Next" sections');
    }
    
    // Replace company name in price action line with the one from the article (if extracted)
    // This ensures consistency - the price action uses the same company name as the article
    // Price action line format is now: "<strong>TICKER Price Action:</strong> CompanyName shares..."
    if (extractedCompanyName && priceActionLine) {
      // Extract the current company name from price action (everything after "> " and before " shares")
      // Pattern: "<strong>TICKER Price Action:</strong> CompanyName shares"
      const priceActionMatch = priceActionLine.match(/<\/strong>\s+(.+?)\s+shares/i);
      if (priceActionMatch) {
        const currentCompanyName = priceActionMatch[1].trim();
        // Replace the first occurrence (the company name) with the one from the article
        priceActionLine = priceActionLine.replace(currentCompanyName, extractedCompanyName);
        console.log(`✅ Replaced company name in price action: "${currentCompanyName}" -> "${extractedCompanyName}"`);
      } else {
        console.warn(`⚠️ Could not extract company name from price action line for replacement. Line: ${priceActionLine.substring(0, 100)}`);
      }
    } else if (!extractedCompanyName && priceActionLine) {
      console.warn(`⚠️ No company name extracted from article body, using API company name in price action`);
    }
    
    // Price action line is already formatted with bold prefix, no need to modify
    // Add the real price action line from Benzinga API
    console.log(`[BEFORE APPENDING] Price action line to append: ${priceActionLine.substring(0, 150)}`);
    articleBody = articleBody.trim() + '\n\n' + priceActionLine;
    console.log(`[AFTER APPENDING] Article ends with: ${articleBody.substring(articleBody.length - 200)}`);
    
    // ONE MORE FINAL PASS on the complete article (including price action line)
    articleBody = articleBody.replace(/([a-zA-Z])"([sS])([^"'])/g, "$1'$2$3");
    articleBody = articleBody.replace(/([a-zA-Z])"([sS])$/g, "$1'$2");

    // Ensure we have content to return
    const finalArticleBody = articleBody.trim();
    if (!finalArticleBody || finalArticleBody.length < 50) {
      console.error('Generated article body is too short or empty. Length:', finalArticleBody?.length);
      console.error('Full generated content length:', article?.length);
      console.error('First 500 chars of generated content:', article?.substring(0, 500));
      console.error('Headline extracted:', headline);
      console.error('Article body after headline removal:', articleBody?.substring(0, 500));
      return NextResponse.json({ 
        error: `Generated article is too short or empty (${finalArticleBody?.length || 0} characters). Please try again.` 
      }, { status: 500 });
    }
    
    console.log('Returning article. Headline length:', headline?.length, 'Article length:', finalArticleBody.length);
    console.log('Article preview (first 500 chars):', finalArticleBody.substring(0, 500));
    console.log('Article contains HTML tags:', {
      hasH2: finalArticleBody.includes('<h2>'),
      hasStrong: finalArticleBody.includes('<strong>'),
      hasLinks: finalArticleBody.includes('<a href='),
      hasAlsoRead: finalArticleBody.includes('Also Read:'),
      hasReadNext: finalArticleBody.includes('Read Next:'),
      hasPriceAction: finalArticleBody.includes('Price Action:')
    });
    
    return NextResponse.json({ 
      headline: headline || 'No headline generated',
      article: finalArticleBody
    });

  } catch (error: any) {
    console.error('Error generating analyst article:', error);
    return NextResponse.json({ 
      error: error.message || 'Failed to generate article' 
    }, { status: 500 });
  }
}

