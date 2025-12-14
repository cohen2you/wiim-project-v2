import { NextResponse } from 'next/server';
import { aiProvider, type AIProvider } from '../../../../lib/aiProvider';

export const dynamic = 'force-dynamic';

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
  // 1. "TICKER US" or "TICKER" at the start of a line
  // 2. "(NASDAQ:TICKER)" or "(NYSE:TICKER)" patterns
  // 3. "TICKER" in uppercase, 1-5 characters, often near company name
  
  // Try pattern 1: "AVGO US" or "AVGO" at start of line
  const pattern1 = /^([A-Z]{1,5})\s+US\b/mi;
  const match1 = text.match(pattern1);
  if (match1) {
    return match1[1].toUpperCase();
  }
  
  // Try pattern 2: "(NASDAQ:AVGO)" or "(NYSE:AVGO)"
  const pattern2 = /\((?:NASDAQ|NYSE|AMEX|OTC):([A-Z]{1,5})\)/i;
  const match2 = text.match(pattern2);
  if (match2) {
    return match2[1].toUpperCase();
  }
  
  // Try pattern 3: Look for common ticker patterns near company mentions
  // This is less reliable but can catch cases like "AVGO" mentioned in context
  const tickerPattern = /\b([A-Z]{2,5})\s+(?:US|NASDAQ|NYSE|shares|stock)/i;
  const match3 = text.match(tickerPattern);
  if (match3) {
    const potentialTicker = match3[1].toUpperCase();
    // Filter out common words that might match
    const invalidTickers = ['THE', 'AND', 'FOR', 'ARE', 'WAS', 'HAS', 'HAD', 'WILL', 'THIS', 'THAT'];
    if (!invalidTickers.includes(potentialTicker)) {
      return potentialTicker;
    }
  }
  
  return null;
}

// Helper function to fetch price data from Benzinga
async function fetchPriceData(ticker: string) {
  try {
    const response = await fetch(`https://api.benzinga.com/api/v2/quoteDelayed?token=${process.env.BENZINGA_API_KEY}&symbols=${encodeURIComponent(ticker)}`);
    
    if (!response.ok) {
      console.error('Failed to fetch price data');
      return null;
    }
    
    const data = await response.json();
    
    if (data && typeof data === 'object') {
      const quote = data[ticker.toUpperCase()];
      if (quote && typeof quote === 'object') {
        return {
          last: quote.lastTradePrice || 0,
          change: quote.change || 0,
          change_percent: quote.changePercent || quote.change_percent || 0,
          close: quote.close || quote.lastTradePrice || 0,
          previousClose: quote.previousClosePrice || quote.previousClose || 0,
          companyName: quote.companyStandardName || quote.name || ticker.toUpperCase(),
          extendedHoursPrice: quote.ethPrice || quote.extendedHoursPrice || quote.afterHoursPrice || null,
          extendedHoursChangePercent: quote.ethChangePercent || quote.extendedHoursChangePercent || quote.afterHoursChangePercent || null,
        };
      }
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
    return `Price Action: ${ticker} shares closed on ${getCurrentDayName()}.`;
  }

  const marketSession = getMarketSession();
  const dayName = getCurrentDayName();
  const companyName = priceData.companyName || ticker.toUpperCase();
  
  // Regular session data
  const regularLast = parseFloat(priceData.close || priceData.last || 0).toFixed(2);
  
  // Calculate regular trading hours change percent
  let regularChangePercent: string;
  if (priceData.previousClose && priceData.previousClose > 0 && priceData.close) {
    const regularChange = parseFloat(priceData.close) - parseFloat(priceData.previousClose);
    const calculatedChangePercent = (regularChange / parseFloat(priceData.previousClose) * 100).toFixed(2);
    regularChangePercent = calculatedChangePercent;
  } else if (priceData.change && priceData.previousClose && priceData.previousClose > 0) {
    const calculatedChangePercent = (parseFloat(priceData.change.toString()) / parseFloat(priceData.previousClose.toString()) * 100).toFixed(2);
    regularChangePercent = calculatedChangePercent;
  } else {
    const apiChangePercent = parseFloat(priceData.change_percent || 0);
    regularChangePercent = apiChangePercent.toFixed(2);
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
    const { analystNoteText, ticker, aiProvider: providerOverride } = await req.json();
    
    if (!analystNoteText || !analystNoteText.trim()) {
      return NextResponse.json({ error: 'Analyst note text is required' }, { status: 400 });
    }

    const provider: AIProvider = providerOverride || 'openai';
    
    // Extract ticker from text if not provided, or use provided ticker
    let finalTicker = ticker?.trim() || '';
    if (!finalTicker) {
      const extractedTicker = extractTickerFromText(analystNoteText);
      if (extractedTicker) {
        finalTicker = extractedTicker;
        console.log(`Extracted ticker from analyst note: ${finalTicker}`);
      }
    } else {
      finalTicker = finalTicker.toUpperCase();
    }
    
    // Fetch price data for price action line (if ticker is available)
    let priceActionLine = '';
    if (finalTicker) {
      const priceData = await fetchPriceData(finalTicker);
      priceActionLine = generatePriceActionLine(finalTicker, priceData);
    } else {
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

    const truncatedText = truncateText(analystNoteText.trim(), maxInputChars);
    
    if (truncatedText !== analystNoteText.trim()) {
      console.log(`Truncated analyst note from ${analystNoteText.length} to ${truncatedText.length} characters`);
    }

    const prompt = `Write a news article based on the following analyst note text. Follow the "Benzinga Style" guidelines strictly. This is editorial content for traders - create a compelling narrative with intrigue, conflict, and tradeable information.

### STYLE GUIDELINES:

1. **Headline:** Create a narrative, editorial headline that tells a story. Use quotes, conflict, or intrigue when possible. Include specific numbers/metrics.
   - Good examples: "BofA Says 'Ignore The Noise': Broadcom Poised For $500 As AI Backlog Swells To $73 Billion" or "[Firm] Sees [Company] Hitting $[Target] As [Key Metric] Surges"
   - Use company name without "Inc." in headline (just "Broadcom" not "Broadcom Inc.")
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
   - **IMPORTANT: All section headers MUST be wrapped in <strong> tags to make them bold**
   - **CRITICAL: Keep paragraphs SHORT - maximum 2 sentences per paragraph. Break up long thoughts into multiple short paragraphs for better readability.**
   - Under each header, write 3-5 very short paragraphs (1-2 sentences each) with specific details
   - Create story elements: "mystery customer", "undue noise", "beat goes on"
   - **QUOTE ACCURACY (CRITICAL): When you use quotation marks, the text inside MUST be a word-for-word exact copy from the source. Do NOT reorder words, change word forms, or paraphrase. Example: If source says "momentum is accelerating", you MUST write "momentum is accelerating" - NOT "accelerating momentum". Before using ANY quote, search the source text for the exact phrase word-for-word. If you cannot find the exact phrase, do NOT use quotation marks - paraphrase without quotes instead (e.g., "Cassidy noted that momentum is accelerating" without quotes).**
   - Include specific numbers, metrics, and catalysts
   - Use phrases like "Arya believes", "Arya pointed to", "Arya noted" to maintain narrative flow
   - **Never create long, dense paragraphs - always break them into shorter, punchier segments**

5. **Bolding Strategy:** 
   - Bold company names on first mention only (see formatting rules below)
   - **Bold ALL section headers/subheads** using <strong> tags
   - Do NOT bold narrative phrases, analyst names, firms, ratings, price targets, numbers, or metrics (except headers and company names)

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

### INPUT TEXT (Analyst Note):

${truncatedText}

### OUTPUT ARTICLE:`;

    const result = await aiProvider.generateCompletion(
      [
        {
          role: "system",
          content: "You are an editorial financial journalist writing for Benzinga, a fast-paced trading news site. Your articles are read by traders who scan content quickly but appreciate compelling narratives. Create editorial, story-driven content with intrigue, conflict, and tradeable information. Use narrative hooks, create story elements (like 'mystery customer'), and include analyst quotes to support the narrative. Use 2-3 editorial section headers (e.g., 'The Broadcom Thesis', 'The Mystery Customer Catalyst'). NEVER include formal datelines or conclusion sections. Do NOT generate a Price Action line - it will be added automatically. Use HTML <strong> tags for bold text, NOT markdown ** syntax. CRITICAL: You MUST bold ALL section headers/subheads using <strong> tags. ONLY bold company names on first mention - do NOT bold any other text (no numbers, metrics, analyst names, firms, or phrases) except for section headers. Always include the analyst's name along with the firm name. On first mention, bold ONLY the company name (e.g., <strong>Broadcom Inc.</strong>), then include the full exchange ticker format (NASDAQ:AVGO) without bolding and with no space after the colon. MOST IMPORTANT: Keep ALL paragraphs SHORT - maximum 2 sentences per paragraph. Break up any long thoughts into multiple short, punchy paragraphs. Never create dense blocks of text. QUOTE ACCURACY IS ABSOLUTELY CRITICAL IN HEADLINES AND BODY: If you use quotation marks anywhere (headline or body), the text inside MUST be a word-for-word exact copy from the source. Do NOT reorder words, change word forms, or paraphrase. Example: If source says 'momentum is accelerating', you MUST write 'momentum is accelerating' - NOT 'accelerating momentum'. Before using ANY quote in the headline or body, search the source text for the exact phrase word-for-word. If you cannot find the exact phrase, do NOT use quotation marks - paraphrase without quotes instead."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      {
        // Use models with larger context windows
        model: provider === 'gemini' ? 'gemini-3-pro-preview' : 'gpt-4-turbo',
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
    article = article.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    
    // Extract headline (first line before any blank line or paragraph break)
    const headlineMatch = article.match(/^([^\n]+)/);
    let headline = headlineMatch ? headlineMatch[1] : '';
    
    // Remove quotes that wrap the entire headline (common AI mistake)
    // Check if headline starts and ends with matching quotes
    headline = headline.trim();
    if ((headline.startsWith("'") && headline.endsWith("'")) || 
        (headline.startsWith('"') && headline.endsWith('"'))) {
      headline = headline.slice(1, -1).trim();
    }
    
    // Convert double quotes to single quotes in headline (for quoted phrases within headline)
    headline = headline.replace(/"([^"]+)"/g, "'$1'");
    
    // Remove headline from article body (everything after first line)
    let articleBody = headlineMatch ? article.substring(headlineMatch[0].length).trim() : article;
    
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
    const firstMentionMatch = articleBody.match(/<strong>([^<]+(?:Inc\.?|Corp\.?|LLC|Ltd\.?)?)<\/strong>\s*\([A-Z]+:[A-Z]+\)/i);
    if (firstMentionMatch) {
      const companyName = firstMentionMatch[1];
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
    
    // Bold "Price Action:" in the price action line
    const boldedPriceActionLine = priceActionLine.replace(/^(Price Action:)/i, '<strong>$1</strong>');
    
    // Add the real price action line from Benzinga API
    articleBody = articleBody.trim() + '\n\n' + boldedPriceActionLine;

    return NextResponse.json({ 
      headline: headline || '',
      article: articleBody || ''
    });

  } catch (error: any) {
    console.error('Error generating analyst article:', error);
    return NextResponse.json({ 
      error: error.message || 'Failed to generate article' 
    }, { status: 500 });
  }
}

