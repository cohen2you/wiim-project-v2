import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { preserveHyperlinks, ensureProperPriceActionPlacement } from '../../../../lib/hyperlink-preservation';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const BENZINGA_API_KEY = process.env.BENZINGA_API_KEY!;
const BZ_NEWS_URL = 'https://api.benzinga.com/api/v2/news';

async function fetchRelatedArticles(ticker: string, excludeUrl?: string): Promise<any[]> {
  try {
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - 7);
    const dateFromStr = dateFrom.toISOString().slice(0, 10);
    
    const url = `${BZ_NEWS_URL}?token=${BENZINGA_API_KEY}&tickers=${encodeURIComponent(ticker)}&items=10&fields=headline,title,created,body,url,channels&accept=application/json&displayOutput=full&dateFrom=${dateFromStr}`;
    
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    
    if (!res.ok) {
      console.error('Benzinga API error:', await res.text());
      return [];
    }
    
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return [];
    
    // Filter out press releases and the current article URL
    const prChannelNames = ['press releases', 'press-releases', 'pressrelease', 'pr'];
    const normalize = (str: string) => str.toLowerCase().replace(/[-_]/g, ' ');
    
    const relatedArticles = data
      .filter(item => {
        // Exclude press releases
        if (Array.isArray(item.channels) && item.channels.some((ch: any) => 
          typeof ch.name === 'string' && prChannelNames.includes(normalize(ch.name))
        )) {
          return false;
        }
        
        // Exclude insights URLs
        if (item.url && item.url.includes('/insights/')) {
          return false;
        }
        
        // Exclude the current article URL if provided
        if (excludeUrl && item.url === excludeUrl) {
          return false;
        }
        
        return true;
      })
      .map((item: any) => ({
        headline: item.headline || item.title || '[No Headline]',
        body: item.body || '',
        url: item.url,
        created: item.created,
      }))
      .filter(item => item.body && item.body.length > 100) // Ensure there's substantial content
      .slice(0, 2); // Get exactly 2 articles
    
    return relatedArticles;
  } catch (error) {
    console.error('Error fetching related articles:', error);
    return [];
  }
}

export async function POST(request: Request) {
  try {
    const { ticker, existingStory } = await request.json();
    
    if (!ticker || !existingStory) {
      return NextResponse.json({ error: 'Ticker and existing story are required.' }, { status: 400 });
    }

    // Fetch related articles for context (needed for the Read Next link)
    const relatedArticles = await fetchRelatedArticles(ticker);
    
    if (relatedArticles.length < 2) {
      return NextResponse.json({ error: 'Not enough related articles found for context.' }, { status: 404 });
    }

    // Condense and polish the story to 350-400 words while preserving all elements
    const condensationPrompt = `
You are a professional financial journalist. Take the existing story and AGGRESSIVELY condense it to exactly 350-400 words while preserving all hyperlinks, structure, and formatting.

EXISTING STORY:
${existingStory}

CRITICAL TASK: AGGRESSIVELY condense this story to exactly 350-400 words total. Be RUTHLESS in cutting content.

CONDENSATION RULES:
1. **MANDATORY WORD COUNT**: The final story MUST be 350-400 words - NO EXCEPTIONS
2. **PRESERVE ALL ELEMENTS**: Keep headline, lead, technical analysis, analyst ratings, "Also Read" line, price action line, and "Read Next" link
3. **PRESERVE HTML HYPERLINKS**: CRITICAL - Keep ALL existing HTML hyperlinks (<a href="...">text</a>) exactly as they are. DO NOT convert them to plain text URLs.
4. **AGGRESSIVE CUTTING**: Remove redundant information, combine similar points, eliminate unnecessary details
5. **STREAMLINE SENTENCES**: Make every sentence more concise and impactful
6. **TWO-SENTENCE PARAGRAPHS**: Ensure no paragraph exceeds 2 sentences
7. **PRESERVE FORMATTING**: Keep HTML formatting and hyperlink structure intact

WHAT TO CUT/COMBINE:
- **Redundant technical details**: Combine similar technical points into single sentences
- **Repetitive analyst commentary**: Keep only the most essential analyst ratings
- **Excessive market context**: Streamline background information
- **Verbose explanations**: Make explanations more direct and concise
- **Similar data points**: Combine related price levels and indicators
- **Unnecessary qualifiers**: Remove "may", "could", "potentially" when possible
- **Repetitive phrases**: Eliminate redundant language

CONDENSATION STRATEGY:
- **Lead paragraph**: Keep essential company name and movement, cut excessive context
- **Technical analysis**: Combine similar indicators, keep only key levels
- **"Also Read" line**: CRITICAL - DO NOT REMOVE. Keep exactly as is and place in the MIDDLE of the story (after technical analysis, before analyst ratings)
- **Analyst ratings**: Keep only the most important ratings and targets
- **Market context**: Streamline to essential points only
- **Price action line**: Keep exactly as is at the bottom
- **"Read Next" link**: Keep exactly as is at the very bottom

CORRECT STORY STRUCTURE:
1. Headline
2. Lead paragraph (2 sentences max)
3. Technical analysis (condensed)
4. "Also Read" line (in the MIDDLE) - DO NOT REMOVE
5. Analyst ratings (condensed)
6. Price action line (at bottom)
7. "Read Next" link (at very bottom)

EXAMPLE CONDENSATION:
Before: "The stock's upward movement was supported by a favorable technical setup, indicating strong buying interest as the U.S. prepares to announce semiconductor import probe results in two weeks, potentially impacting the industry due to national security concerns."
After: "The stock's upward movement reflects strong buying interest amid semiconductor import probe developments."

VERIFICATION: The final story must contain:
- Headline
- Lead paragraph (2 sentences max)
- Technical analysis (condensed)
- "Also Read" line (in the MIDDLE of the story) - CRITICAL ELEMENT
- Analyst ratings (condensed)
- Price action line (at bottom)
- "Read Next" link (at very bottom)

CRITICAL: The "Also Read" line must be preserved. If you remove it, you have failed the task.

Be RUTHLESS in cutting. If the story is still over 400 words, you have failed the task.

Return the AGGRESSIVELY condensed story (350-400 words) with all elements preserved in the correct order:`;

    const condensationCompletion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: condensationPrompt }],
      max_tokens: 2000,
      temperature: 0.3,
    });

    const condensedStory = condensationCompletion.choices[0].message?.content?.trim() || existingStory;

    // Check if "Also Read" line is missing and add it back if needed
    if (!condensedStory.includes('Also Read:')) {
      // Find the "Also Read" line in the original story
      const alsoReadMatch = existingStory.match(/Also Read:.*?(?=\n\n|\n[A-Z]|$)/);
      if (alsoReadMatch) {
        const alsoReadLine = alsoReadMatch[0].trim();
        // Insert it after technical analysis (before analyst ratings)
        const parts = condensedStory.split('\n\n');
        const insertIndex = Math.min(3, parts.length - 2); // Insert after technical analysis
        parts.splice(insertIndex, 0, alsoReadLine);
        const finalStory = parts.join('\n\n');
        
        return NextResponse.json({ 
          story: finalStory,
          relatedArticles: relatedArticles.map(article => ({
            headline: article.headline,
            url: article.url
          }))
        });
      }
    }

    // Enforce two-sentence paragraph rule and ensure proper hyperlinking
    const enforceRulesPrompt = `
Take this story and ensure:
1. NO paragraph exceeds 2 sentences
2. The "Also Read" line is properly hyperlinked (without **)
3. Remove detailed price information from the lead paragraph
4. All other formatting is preserved
5. PRESERVE ALL HTML HYPERLINKS - DO NOT convert them to plain text URLs

STORY TO FIX:
${condensedStory}

RULES:
- Break any paragraph with more than 2 sentences into multiple paragraphs
- Ensure "Also Read:" line has the headline hyperlinked (not the whole line) and remove any ** formatting
- Remove specific price details from the lead paragraph (current price, change, high/low) - these belong in the price action line
- Keep all other HTML hyperlinks (<a href="...">text</a>) exactly as they are - DO NOT convert to plain text URLs
- Maintain the story structure and flow

EXAMPLE FIXES:
- "Also Read:**" should become "Also Read:"
- Lead paragraph should not include specific prices like "$179.04, up $5.33, nearing a high of $179.81"
- Lead paragraph should focus on movement and context, not specific price data

Return the corrected story:`;

    const rulesCompletion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: enforceRulesPrompt }],
      max_tokens: 2000,
      temperature: 0.2,
    });

    const correctedStory = rulesCompletion.choices[0].message?.content?.trim() || condensedStory;

    // If the story is still too long, do a second aggressive cut
    if (correctedStory.length > 2500) {
      const secondCutPrompt = `
The story is still too long. Make a FINAL aggressive cut to get it to 350-400 words maximum.

STORY TO CUT:
${correctedStory}

RULES:
- Cut to 350-400 words MAXIMUM
- Keep all HTML hyperlinks (<a href="...">text</a>) exactly as they are - DO NOT convert to plain text URLs
- Be extremely aggressive in cutting
- Combine sentences, remove redundancy
- Keep only the most essential information
- CRITICAL: Preserve the "Also Read" line with proper hyperlinking (remove any ** formatting)
- ENFORCE: No paragraph longer than 2 sentences
- REMOVE: Specific price details from lead paragraph (current price, change, high/low)
- LEAD PARAGRAPH: Should focus on movement and context, not specific price data
- PRESERVE ALL HTML HYPERLINKS: Keep all <a href="...">text</a> tags exactly as they are

Return the FINAL condensed story:`;

      const secondCutCompletion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: secondCutPrompt }],
        max_tokens: 1500,
        temperature: 0.2,
      });

      const finalStory = secondCutCompletion.choices[0].message?.content?.trim() || correctedStory;
      
      // Preserve existing hyperlinks
      let preservedStory = preserveHyperlinks(existingStory, finalStory);
      
      // Ensure proper placement of price action and Read Next links after condensation
      preservedStory = ensureProperPriceActionPlacement(preservedStory, '', '');
      
      return NextResponse.json({ 
        story: preservedStory,
        relatedArticles: relatedArticles.map(article => ({
          headline: article.headline,
          url: article.url
        }))
      });
    }

    // Preserve existing hyperlinks
    let finalStory = preserveHyperlinks(existingStory, correctedStory);
    
    // Ensure proper placement of price action and Read Next links after condensation
    finalStory = ensureProperPriceActionPlacement(finalStory, '', '');

    return NextResponse.json({ 
      story: finalStory,
      relatedArticles: relatedArticles.map(article => ({
        headline: article.headline,
        url: article.url
      }))
    });
  } catch (error: any) {
    console.error('Error adding WGO context:', error);
    return NextResponse.json({ error: error.message || 'Failed to add WGO context.' }, { status: 500 });
  }
}

// Helper function to fetch price data
async function fetchPriceData(ticker: string) {
  try {
    const response = await fetch(`https://api.benzinga.com/api/v2/quoteDelayed?token=${BENZINGA_API_KEY}&symbols=${encodeURIComponent(ticker)}`);
    
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
          volume: quote.volume || 0,
          high: quote.high || 0,
          low: quote.low || 0,
          open: quote.open || 0,
          // Add extended hours data if available
          extendedHoursPrice: quote.extendedHoursPrice || null,
          extendedHoursChange: quote.extendedHoursChange || null,
          extendedHoursChangePercent: quote.extendedHoursChangePercent || null,
          extendedHoursTime: quote.extendedHoursTime || null
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
  
  // Weekend
  if (day === 0 || day === 6) return 'closed';
  
  // Pre-market (4:00 AM - 9:30 AM ET)
  if (time >= 400 && time < 930) return 'premarket';
  
  // Regular trading (9:30 AM - 4:00 PM ET)
  if (time >= 930 && time < 1600) return 'regular';
  
  // After-hours (4:00 PM - 8:00 PM ET)
  if (time >= 1600 && time < 2000) return 'afterhours';
  
  // Closed (8:00 PM - 4:00 AM ET)
  return 'closed';
}

// Helper function to generate price action line
function generatePriceActionLine(ticker: string, priceData: any) {
  if (!priceData) {
    return `${ticker} Price Action: ${ticker} shares were trading during regular market hours, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
  }
  
  const marketSession = getMarketSession();
  const dayName = getCurrentDayName();
  
  // Regular session data
  const regularLast = parseFloat(priceData.last || 0).toFixed(2);
  const regularChangePercent = parseFloat(priceData.change_percent || 0).toFixed(2);
  const regularDisplayChangePercent = regularChangePercent.startsWith('-') ? regularChangePercent.substring(1) : regularChangePercent;
  
  // Extended hours data
  const hasExtendedHours = priceData.extendedHoursPrice && priceData.extendedHoursChangePercent;
  const extPrice = hasExtendedHours ? parseFloat(priceData.extendedHoursPrice || 0).toFixed(2) : null;
  const extChangePercent = hasExtendedHours ? parseFloat(priceData.extendedHoursChangePercent || 0).toFixed(2) : null;
  const extDisplayChangePercent = extChangePercent && extChangePercent.startsWith('-') ? extChangePercent.substring(1) : extChangePercent;
  
  if (marketSession === 'regular') {
    return `${ticker} Price Action: ${ticker} shares were ${regularChangePercent.startsWith('-') ? 'down' : 'up'} ${regularDisplayChangePercent}% at $${regularLast} during regular trading hours on ${dayName}, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
  } else if (marketSession === 'premarket') {
    if (hasExtendedHours && extChangePercent) {
      return `${ticker} Price Action: ${ticker} shares were ${extChangePercent.startsWith('-') ? 'down' : 'up'} ${extDisplayChangePercent}% at $${extPrice} during pre-market trading on ${dayName}, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
    } else {
      return `${ticker} Price Action: ${ticker} shares were trading during pre-market hours on ${dayName}, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
    }
  } else if (marketSession === 'afterhours') {
    if (hasExtendedHours && extChangePercent) {
      // Show both regular session and after-hours changes
      const regularDirection = regularChangePercent.startsWith('-') ? 'fell' : 'rose';
      const extDirection = extChangePercent.startsWith('-') ? 'down' : 'up';
      
      return `${ticker} Price Action: ${ticker} shares ${regularDirection} ${regularDisplayChangePercent}% to $${regularLast} during regular trading hours, and were ${extDirection} ${extDisplayChangePercent}% at $${extPrice} during after-hours trading on ${dayName}, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
    } else {
      // Fallback to regular session data if no extended hours data
      return `${ticker} Price Action: ${ticker} shares ${regularChangePercent.startsWith('-') ? 'fell' : 'rose'} ${regularDisplayChangePercent}% to $${regularLast} during regular trading hours on ${dayName}, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
    }
  } else {
    // Market is closed, use last regular session data
    return `${ticker} Price Action: ${ticker} shares ${regularChangePercent.startsWith('-') ? 'fell' : 'rose'} ${regularDisplayChangePercent}% to $${regularLast} during regular trading hours on ${dayName}, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
  }
}

// Helper function to get current day name
function getCurrentDayName() {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[new Date().getDay()];
} 