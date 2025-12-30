import { NextResponse } from 'next/server';
import { aiProvider, type AIProvider } from '../../../../lib/aiProvider';

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
    
    return relatedArticles;
  } catch (error) {
    console.error('Error fetching related articles:', error);
    return [];
  }
}

// Helper function to fetch price data from Benzinga
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
          close: quote.close || quote.lastTradePrice || 0,
          previousClose: quote.previousClosePrice || quote.previousClose || 0,
          companyName: quote.companyStandardName || quote.name || ticker.toUpperCase(),
          extendedHoursPrice: quote.ethPrice || quote.extendedHoursPrice || quote.afterHoursPrice || null,
          extendedHoursChangePercent: quote.ethChangePercent || quote.extendedHoursChangePercent || quote.afterHoursChangePercent || null,
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

// Helper function to generate price action line (matching add-price-action format)
function generatePriceActionLine(ticker: string, priceData: any): string {
  if (!priceData) {
    console.log(`No price data available for ${ticker}, using generic price action line`);
    return `Price Action: ${ticker} shares closed on ${getCurrentDayName()}.`;
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
  const regularLast = parseFloat(priceData.close || priceData.last || 0).toFixed(2);
  
  // Calculate regular trading hours change percent
  let regularChangePercent: string;
  if (priceData.previousClose && priceData.previousClose > 0 && priceData.close) {
    const regularChange = parseFloat(priceData.close) - parseFloat(priceData.previousClose);
    const calculatedChangePercent = (regularChange / parseFloat(priceData.previousClose) * 100).toFixed(2);
    regularChangePercent = calculatedChangePercent;
    console.log(`Calculated change percent from close/previousClose: ${regularChangePercent}%`);
  } else if (priceData.change && priceData.previousClose && priceData.previousClose > 0) {
    const calculatedChangePercent = (parseFloat(priceData.change.toString()) / parseFloat(priceData.previousClose.toString()) * 100).toFixed(2);
    regularChangePercent = calculatedChangePercent;
    console.log(`Calculated change percent from change/previousClose: ${regularChangePercent}%`);
  } else {
    const apiChangePercent = parseFloat(priceData.change_percent || 0);
    regularChangePercent = apiChangePercent.toFixed(2);
    console.log(`Using API change_percent: ${regularChangePercent}%`);
  }
  
  const regularDisplayChangePercent = regularChangePercent.startsWith('-') ? regularChangePercent.substring(1) : regularChangePercent;
  
  // Extended hours data
  const hasExtendedHours = priceData.extendedHoursPrice;
  const extPrice = hasExtendedHours ? parseFloat(priceData.extendedHoursPrice || 0).toFixed(2) : null;
  const extChangePercent = priceData.extendedHoursChangePercent ? parseFloat(priceData.extendedHoursChangePercent || 0).toFixed(2) : null;
  const extDisplayChangePercent = extChangePercent && extChangePercent.startsWith('-') ? extChangePercent.substring(1) : extChangePercent;
  
  const regularClose = parseFloat(priceData.close || priceData.last || 0);
  const calculatedExtChangePercent = priceData.extendedHoursPrice && !priceData.extendedHoursChangePercent ? 
    ((parseFloat(priceData.extendedHoursPrice) - regularClose) / regularClose * 100).toFixed(2) : null;
  
  const finalExtChangePercent = extChangePercent || calculatedExtChangePercent;
  const finalHasExtendedHours = priceData.extendedHoursPrice && finalExtChangePercent;
  const finalExtDisplayChangePercent = finalExtChangePercent && finalExtChangePercent.startsWith('-') ? finalExtChangePercent.substring(1) : finalExtChangePercent;
  
  if (marketSession === 'regular') {
    return `Price Action: ${companyName} shares were ${regularChangePercent.startsWith('-') ? 'down' : 'up'} ${regularDisplayChangePercent}% at $${regularLast} at the time of publication ${dayName}.`;
  } else if (marketSession === 'premarket') {
    if (priceData.change_percent && priceData.change_percent !== 0) {
      const premarketChangePercent = parseFloat(priceData.change_percent).toFixed(2);
      const premarketDisplayChangePercent = premarketChangePercent.startsWith('-') ? premarketChangePercent.substring(1) : premarketChangePercent;
      const premarketPrice = priceData.extendedHoursPrice ? parseFloat(priceData.extendedHoursPrice).toFixed(2) : parseFloat(priceData.last).toFixed(2);
      return `Price Action: ${companyName} shares were ${premarketChangePercent.startsWith('-') ? 'down' : 'up'} ${premarketDisplayChangePercent}% at $${premarketPrice} at the time of publication ${dayName}.`;
    } else if (finalHasExtendedHours && finalExtChangePercent && finalExtDisplayChangePercent) {
      return `Price Action: ${companyName} shares were ${finalExtChangePercent.startsWith('-') ? 'down' : 'up'} ${finalExtDisplayChangePercent}% at $${extPrice} at the time of publication ${dayName}.`;
    }
    return `Price Action: ${companyName} shares were trading during pre-market hours on ${dayName}.`;
  } else if (marketSession === 'afterhours') {
    if (finalHasExtendedHours && finalExtChangePercent && finalExtDisplayChangePercent) {
      const regularDirection = regularChangePercent.startsWith('-') ? 'fell' : 'rose';
      const extDirection = finalExtChangePercent.startsWith('-') ? 'down' : 'up';
      return `Price Action: ${companyName} shares ${regularDirection} ${regularDisplayChangePercent}% to $${regularLast} during regular trading hours, and were ${extDirection} ${finalExtDisplayChangePercent}% at $${extPrice} at the time of publication ${dayName}.`;
    } else {
      const regularDirection = regularChangePercent.startsWith('-') ? 'fell' : 'rose';
      return `Price Action: ${companyName} shares ${regularDirection} ${regularDisplayChangePercent}% to $${regularLast} during regular trading hours on ${dayName}.`;
    }
  } else {
    return `Price Action: ${companyName} shares ${regularChangePercent.startsWith('-') ? 'fell' : 'rose'} ${regularDisplayChangePercent}% to $${regularLast} during regular trading hours on ${dayName}.`;
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
    
    // Fetch related articles for "Also Read" and "Read Next" sections
    const relatedArticles = finalTicker ? await fetchRelatedArticles(finalTicker) : [];
    
    // Fetch price data for price action line (if ticker is available)
    let priceActionLine = '';
    if (finalTicker && finalTicker.trim() !== '' && finalTicker.trim().toUpperCase() !== 'PRICE') {
      console.log(`Fetching price data for ticker: ${finalTicker}`);
      const priceData = await fetchPriceData(finalTicker);
      
      // Validate price data - ensure we have valid price information
      const hasValidPrice = priceData && 
                           priceData.last && 
                           (typeof priceData.last === 'number' ? priceData.last > 0 : parseFloat(priceData.last) > 0);
      
      if (hasValidPrice) {
        priceActionLine = generatePriceActionLine(finalTicker, priceData);
        console.log(`Generated price action line: ${priceActionLine.substring(0, 100)}...`);
        
        // Double-check the generated price action line doesn't have invalid data
        if (priceActionLine.includes('PRICE shares') || 
            priceActionLine.includes('$0.00') || 
            priceActionLine.includes('0.00%') && !priceActionLine.includes('unchanged')) {
          console.warn(`Generated price action line contains invalid data, using fallback: ${priceActionLine}`);
          priceActionLine = `Price Action: ${finalTicker} shares closed on ${getCurrentDayName()}.`;
        }
      } else {
        console.warn(`Price data unavailable or invalid for ${finalTicker}, using fallback`);
        // Use a fallback that doesn't include specific price data
        priceActionLine = `Price Action: ${finalTicker} shares closed on ${getCurrentDayName()}.`;
      }
    } else {
      console.warn(`No valid ticker available for price action line (ticker: ${finalTicker})`);
      // If no ticker found, use a generic price action line
      priceActionLine = 'Price Action: Stock price data unavailable at the time of publication.';
    }

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

1. **Headline:** Create a narrative, editorial headline that tells a story. Use quotes, conflict, or intrigue when possible. Include specific numbers/metrics.
   - Good examples: "BofA Says 'Ignore The Noise': Broadcom Poised For $500 As AI Backlog Swells To $73 Billion" or "[Firm] Sees [Company] Hitting $[Target] As [Key Metric] Surges"
   - Use company name without "Inc." in headline (just "Broadcom" not "Broadcom Inc.")
   - **CRITICAL: Headline must be PLAIN TEXT ONLY - NO HTML TAGS, NO BOLD TAGS, NO TICKER FORMATS like (NASDAQ:XXX). Just plain text.**
   - Create intrigue: "Mystery Customer", "Ignore The Noise", "Beat Goes On"
   - Include specific numbers when impactful: "$73 billion", "$500 target"
   - Keep under 100 characters when possible
   - **CRITICAL: If you use quotation marks in the headline, use SINGLE QUOTES (') not double quotes ("). Example: 'Accelerating Momentum' not "Accelerating Momentum".**
   - **CRITICAL: If you use quotation marks in the headline, the quoted text MUST be an exact word-for-word copy from the source analyst note. Do NOT invent quotes or paraphrase. If you cannot find an exact quote in the source, do not use quotation marks in the headline.**

2. **NO DATELINE:** Do NOT include formal wire service datelines. Jump straight into the lede paragraph.

3. **The Lede (Opening Paragraph):** Start with a narrative hook that creates intrigue or conflict. Then state the analyst action.
   - Create a hook: "sitting on a 'massive' AI order book that bears are ignoring" or "post-earnings volatility has investors worried, but..."
   - Then state: Analyst Name AND Firm, Rating Action, and Price Target change
   - Use phrases like "telling investors that", "argues that", "notes that" to create narrative flow
   - **Keep the lede to 2-3 sentences maximum - break into multiple short paragraphs if needed**
   - Example: "Broadcom Inc. (NASDAQ:AVGO) is sitting on a 'massive' AI order book that bears are ignoring, according to BofA Securities. Analyst Vivek Arya reiterated a Buy rating and raised the price target from $460 to $500, telling investors that the 'beat goes on' for the semiconductor giant as its AI backlog hits $73 billion—smashing consensus expectations."

4. **The Body Structure:** Use 2-3 editorial section headers to organize the narrative:
   - Headers should be narrative/editorial: "The [Company] Thesis", "The 'Mystery' Customer Catalyst", "Valuation & Risks", "The [Company] Factor"
   - **CRITICAL: NEVER place a section header before the first paragraph. Always start with the opening paragraph (the lede), then place section headers after the first paragraph and throughout the rest of the article.**
   - **IMPORTANT: All section headers MUST be wrapped in <strong> tags to make them bold**
   - **CRITICAL: Keep paragraphs SHORT - maximum 2 sentences per paragraph. Break up long thoughts into multiple short paragraphs for better readability.**
   - Under each header, write 3-5 very short paragraphs (1-2 sentences each) with specific details
   - Create story elements: "mystery customer", "undue noise", "beat goes on"
   - **QUOTE FORMATTING (CRITICAL): In the BODY of the article, use DOUBLE QUOTES (") for all direct quotes. Example: "momentum is accelerating" not 'momentum is accelerating'. Single quotes (') are ONLY for headlines.**
   - **QUOTE ACCURACY (CRITICAL): When you use quotation marks, the text inside MUST be a word-for-word exact copy from the source. Do NOT reorder words, change word forms, or paraphrase. Example: If source says "momentum is accelerating", you MUST write "momentum is accelerating" - NOT "accelerating momentum". Before using ANY quote, search the source text for the exact phrase word-for-word. If you cannot find the exact phrase, do NOT use quotation marks - paraphrase without quotes instead (e.g., "Cassidy noted that momentum is accelerating" without quotes).**
   - **QUOTE PLACEMENT (CRITICAL): NEVER place quotation marks before dollar amounts or numbers. Examples: Write "consensus $2.5 billion" NOT "consensus" $2.5 billion". Write "target of $61" NOT "target of" $61". Quotes are ONLY for exact word-for-word phrases from the source, never for numbers or dollar amounts.**
   - **POSSESSIVES AND CONTRACTIONS (CRITICAL): ALWAYS use apostrophes (') for possessives and contractions, NEVER use double quotes ("). Examples: "company's" NOT "company"s", "it's" NOT "it"s", "don't" NOT "don"t", "won't" NOT "won"t". Double quotes (") are ONLY for direct quotations, never for possessives or contractions.**
   - Include specific numbers, metrics, and catalysts
   - Use phrases like "Arya believes", "Arya pointed to", "Arya noted" to maintain narrative flow
   - **Never create long, dense paragraphs - always break them into shorter, punchier segments**

5. **Bolding Strategy:** 
   - Bold company names on first mention only (see formatting rules below)
   - **Bold ALL section headers/subheads** using <strong> tags
   - Do NOT bold narrative phrases, analyst names, firms, ratings, price targets, numbers, dollar amounts, or metrics (except headers and company names)
   - **CRITICAL: NEVER bold dollar amounts like "$2.5 billion" or numbers - these should always be plain text**

6. **Formatting:** - Use HTML <strong> tags to bold text. DO NOT use markdown ** syntax.
   
   - On FIRST mention only: Bold ONLY the company name, then include the full exchange ticker format without bolding. Example: <strong>Broadcom Inc.</strong> (NASDAQ:AVGO) or <strong>Apple Inc.</strong> (NASDAQ:AAPL). Do NOT bold the exchange or ticker. Use no space after the colon (NASDAQ:AVGO not NASDAQ: AVGO).
   
   - After first mention: Do NOT bold the company name in follow-up references. Just use "Broadcom" or "Apple" without bolding.
   
   - Do NOT bold any other text - no numbers, metrics, analyst names, firms, or phrases

7. **Price Action Footer (REQUIRED):** Every article MUST end with a one-sentence "Price Action" line. DO NOT generate this yourself - it will be provided separately. Just end your article content before the Price Action line.

8. **Tone & Voice:** 
   - Editorial, narrative-driven - tell a story, create intrigue
   - Use phrases that create conflict or tension: "bears are ignoring", "undue noise", "smashing expectations"
   - Include analyst quotes to support narrative points
   - Fast-paced but with narrative flow - not just a list of facts
   - Create story elements around key catalysts (e.g., "mystery customer", "Apple Factor")
   - Use active voice and engaging language

### INPUT TEXT (Analyst Note${isMultipleNotes ? 's' : ''}):

${truncatedText}

### OUTPUT ARTICLE:`;

    const result = await aiProvider.generateCompletion(
      [
        {
          role: "system",
          content: "You are an editorial financial journalist writing for Benzinga, a fast-paced trading news site. Your articles are read by traders who scan content quickly but appreciate compelling narratives. Create editorial, story-driven content with intrigue, conflict, and tradeable information. Use narrative hooks, create story elements (like 'mystery customer'), and include analyst quotes to support the narrative. Use 2-3 editorial section headers (e.g., 'The Broadcom Thesis', 'The Mystery Customer Catalyst'). NEVER include formal datelines or conclusion sections. Do NOT generate a Price Action line - it will be added automatically. Use HTML <strong> tags for bold text, NOT markdown ** syntax. CRITICAL: You MUST bold ALL section headers/subheads using <strong> tags. ONLY bold company names on first mention - do NOT bold any other text (no numbers, metrics, analyst names, firms, or phrases) except for section headers. Always include the analyst's name along with the firm name. On first mention, bold ONLY the company name (e.g., <strong>Broadcom Inc.</strong>), then include the full exchange ticker format (NASDAQ:AVGO) without bolding and with no space after the colon. MOST IMPORTANT: Keep ALL paragraphs SHORT - maximum 2 sentences per paragraph. Break up any long thoughts into multiple short, punchy paragraphs. Never create dense blocks of text. CRITICAL: Use APOSTROPHES (') for possessives (e.g., company's, BofA's, Bristol-Myers Squibb's). NEVER use double quotes (\") for possessives. QUOTE FORMATTING: Use SINGLE QUOTES (') in headlines only. Use DOUBLE QUOTES (\") in the body of the article for all direct quotes. QUOTE ACCURACY IS ABSOLUTELY CRITICAL IN HEADLINES AND BODY: If you use quotation marks anywhere (headline or body), the text inside MUST be a word-for-word exact copy from the source. Do NOT reorder words, change word forms, or paraphrase. Example: If source says 'momentum is accelerating', you MUST write 'momentum is accelerating' in headlines or \"momentum is accelerating\" in body - NOT 'accelerating momentum' or \"accelerating momentum\". Before using ANY quote in the headline or body, search the source text for the exact phrase word-for-word. If you cannot find the exact phrase, do NOT use quotation marks - paraphrase without quotes instead."
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
    
    // Bold section headers that might not be bolded (common patterns)
    // Look for headers that are on their own line and not already bolded
    articleBody = articleBody.replace(/^(The [A-Z][^<\n]+?)(\n|$)/gm, (match, header, newline) => {
      if (!header.includes('<strong>')) {
        return `<strong>${header}</strong>${newline}`;
      }
      return match;
    });
    
    // Bold other common header patterns
    articleBody = articleBody.replace(/^([A-Z][^<\n]{5,50}:?)(\n|$)/gm, (match, header, newline) => {
      // Only bold if it looks like a header (starts with capital, reasonable length, not already bolded)
      if (!header.includes('<strong>') && header.length > 5 && header.length < 50 && !header.includes('.')) {
        return `<strong>${header}</strong>${newline}`;
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
    articleBody = articleBody.replace(/\n\nPrice Action:.*$/i, '');
    articleBody = articleBody.replace(/Price Action:.*$/i, '');
    
    // FINAL PASS: Fix any remaining possessives that might have been missed or re-introduced
    // This is the absolute last step to ensure ALL possessives are fixed
    // Use the same simple pattern - match ANY letter + "s and replace
    articleBody = articleBody.replace(/([a-zA-Z])"([sS])/g, "$1'$2");
    articleBody = articleBody.replace(/([a-zA-Z]{2,})"([td])/g, "$1'$2");
    
    // Add "Also Read" and "Read Next" sections if related articles are available
    if (relatedArticles && relatedArticles.length > 0) {
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
        
        // Insert "Also Read" after the second paragraph (index 2)
        if (paragraphs.length >= 2) {
          // Always use HTML link format even if content is plain text (for clickable links)
          const alsoReadSection = `Also Read: <a href="${relatedArticles[0].url}">${relatedArticles[0].headline}</a>`;
          
          // Insert at index 2 (after second paragraph)
          paragraphs.splice(2, 0, alsoReadSection);
          
          // Rejoin content
          if (hasHTMLTags) {
            articleBody = paragraphs.map(p => {
              // If it already ends with </p>, return as-is
              if (p.trim().endsWith('</p>')) return p;
              // If it's the alsoReadSection, wrap in <p> tags
              if (p.includes('Also Read:')) return `<p>${p}</p>`;
              // Otherwise, add </p> back
              return p + '</p>';
            }).join('');
          } else {
            articleBody = paragraphs.join('\n\n');
          }
          
          console.log('✅ "Also Read" section placed after second paragraph');
        } else {
          console.log('⚠️ Not enough paragraphs to insert "Also Read" (need at least 2)');
        }
      } else {
        console.log('"Also Read" section already exists');
      }
      
      // Check if "Read Next" section exists, if not add it before price action
      if (!articleBody.includes('Read Next:')) {
        console.log('Adding "Read Next" section');
        // Check if article uses HTML format
        const hasHTMLTags = articleBody.includes('</p>');
        // Always use HTML link format (for clickable links)
        const readNextLink = `Read Next: <a href="${relatedArticles[1]?.url || relatedArticles[0].url}">${relatedArticles[1]?.headline || relatedArticles[0].headline}</a>`;
        const readNextSection = hasHTMLTags ? `<p>${readNextLink}</p>` : readNextLink;
        
        // Insert before price action line (which will be added next)
        // Add it at the end for now, it will be before price action
        articleBody = articleBody.trim() + '\n\n' + readNextSection;
        console.log('✅ "Read Next" section added before price action');
      } else {
        console.log('"Read Next" section already exists');
      }
    } else {
      console.log('No related articles available for "Also Read" and "Read Next" sections');
    }
    
    // Replace company name in price action line with the one from the article (if extracted)
    // This ensures consistency - the price action uses the same company name as the article
    if (extractedCompanyName && priceActionLine) {
      // Extract the current company name from price action (everything between "Price Action: " and " shares")
      // This pattern handles various formats: "Price Action: CompanyName shares" or "Price Action: Company Name shares"
      const priceActionMatch = priceActionLine.match(/^Price Action:\s+(.+?)\s+shares/i);
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
    
    // Bold "Price Action:" in the price action line
    const boldedPriceActionLine = priceActionLine.replace(/^(Price Action:)/i, '<strong>$1</strong>');
    
    // Add the real price action line from Benzinga API
    articleBody = articleBody.trim() + '\n\n' + boldedPriceActionLine;
    
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

