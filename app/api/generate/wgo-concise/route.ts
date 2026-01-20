import { NextResponse } from 'next/server';
import { aiProvider, AIProvider } from '@/lib/aiProvider';

// Import necessary functions from technical-analysis route
// We'll need to import fetchTechnicalData and other helpers
// For now, let's create a standalone version

const BENZINGA_API_KEY = process.env.BENZINGA_API_KEY;

interface TechnicalData {
  symbol: string;
  companyName: string;
  currentPrice: number;
  changePercent: number;
  sma20: number | null;
  sma100: number | null;
  rsi: number | null;
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
  nextEarningsDate: string | null;
  exchange: string;
}

// Helper to fetch basic technical data
async function fetchBasicTechnicalData(ticker: string): Promise<TechnicalData | null> {
  try {
    // Use the existing technical-analysis route's data fetching approach
    // Fetch from Polygon and Benzinga APIs
    const [snapshotRes, overviewRes, benzingaRes, sma20Res, sma100Res, rsiRes, earningsRes] = await Promise.all([
      fetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}?apikey=${process.env.POLYGON_API_KEY}`),
      fetch(`https://api.polygon.io/v3/reference/tickers/${ticker}?apikey=${process.env.POLYGON_API_KEY}`),
      fetch(`https://api.benzinga.com/api/v2/quoteDelayed?token=${BENZINGA_API_KEY}&symbols=${ticker}`),
      fetch(`https://api.polygon.io/v1/indicators/sma/${ticker}?timespan=day&window=20&adjusted=true&order=desc&apikey=${process.env.POLYGON_API_KEY}`),
      fetch(`https://api.polygon.io/v1/indicators/sma/${ticker}?timespan=day&window=100&adjusted=true&order=desc&apikey=${process.env.POLYGON_API_KEY}`),
      fetch(`https://api.polygon.io/v1/indicators/rsi/${ticker}?timespan=day&adjusted=true&order=desc&apikey=${process.env.POLYGON_API_KEY}`),
      (async () => {
        const today = new Date();
        const dateFrom = today.toISOString().split('T')[0];
        const dateTo = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const url = 'https://api.benzinga.com/api/v2/calendar/earnings' +
          `?token=${BENZINGA_API_KEY}` +
          `&parameters[tickers]=${encodeURIComponent(ticker)}` +
          `&parameters[date_from]=${dateFrom}` +
          `&parameters[date_to]=${dateTo}` +
          `&pagesize=20`;
        return fetch(url, { headers: { accept: 'application/json' } });
      })()
    ]);

    const snapshot = snapshotRes.ok ? await snapshotRes.json().catch(() => null) : null;
    const overview = overviewRes.ok ? await overviewRes.json().catch(() => null) : null;
    const benzingaData = benzingaRes.ok ? await benzingaRes.json().catch(() => null) : null;
    const sma20Data = sma20Res.ok ? await sma20Res.json().catch(() => null) : null;
    const sma100Data = sma100Res.ok ? await sma100Res.json().catch(() => null) : null;
    const rsiData = rsiRes.ok ? await rsiRes.json().catch(() => null) : null;
    
    // Handle earnings data - use the same approach as technical-analysis route
    let nextEarningsDate: string | null = null;
    if (earningsRes.ok) {
      try {
        const raw = await earningsRes.text();
        let earningsData: any;
        try {
          earningsData = JSON.parse(raw);
        } catch (parseError) {
          console.log(`[WGO CONCISE] Earnings API returned non-JSON for ${ticker}`);
          earningsData = null;
        }
        
        if (earningsData && earningsData.earnings) {
          const results = Array.isArray(earningsData.earnings) ? earningsData.earnings : [];
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          
          // Filter for upcoming earnings and sort by date
          const upcomingEarnings = results
            .filter((item: any) => {
              const earningsDate = item.date || item.earnings_date || item.earningsDate;
              if (!earningsDate) return false;
              const date = new Date(earningsDate);
              date.setHours(0, 0, 0, 0);
              return date >= today;
            })
            .sort((a: any, b: any) => {
              const dateA = new Date(a.date || a.earnings_date || a.earningsDate || 0);
              const dateB = new Date(b.date || b.earnings_date || b.earningsDate || 0);
              return dateA.getTime() - dateB.getTime();
            });
          
          if (upcomingEarnings.length > 0) {
            const nextEarnings = upcomingEarnings[0];
            nextEarningsDate = nextEarnings.date || nextEarnings.earnings_date || nextEarnings.earningsDate || null;
            console.log(`[WGO CONCISE] Found next earnings date for ${ticker}:`, nextEarningsDate);
          } else {
            console.log(`[WGO CONCISE] No upcoming earnings found for ${ticker}`);
          }
        }
      } catch (error) {
        console.error(`[WGO CONCISE] Error parsing earnings data for ${ticker}:`, error);
      }
    } else {
      const errorText = await earningsRes.text().catch(() => '');
      console.log(`[WGO CONCISE] Earnings API error for ${ticker}:`, earningsRes.status, errorText.substring(0, 200));
    }

    if (!snapshot || !snapshot.ticker) return null;

    const tickerData = snapshot.ticker;
    const benzingaQuote = benzingaData?.[ticker];
    
    // Get current price from Benzinga (most accurate) or Polygon fallback
    const currentPrice = benzingaQuote?.lastTradePrice || tickerData?.lastTrade?.p || tickerData?.day?.c || 0;
    
    // Get change percent
    const changePercent = benzingaQuote?.changePercent || tickerData?.todaysChangePerc || 0;

    // Get SMA values
    const sma20 = sma20Data?.results?.values?.[0]?.value || null;
    const sma100 = sma100Data?.results?.values?.[0]?.value || null;

    // Get RSI
    const rsi = rsiData?.results?.values?.[0]?.value || null;

    // Get 52-week range from Benzinga (preferred) or calculate from historical data
    const fiftyTwoWeekHigh = benzingaQuote?.fiftyTwoWeekHigh || benzingaQuote?.yearHigh || currentPrice;
    const fiftyTwoWeekLow = benzingaQuote?.fiftyTwoWeekLow || benzingaQuote?.yearLow || currentPrice;

    // Next earnings date is already extracted above

    // Get company name and exchange
    const companyName = overview?.results?.name || benzingaQuote?.companyName || ticker;
    const exchangeCode = overview?.results?.primary_exchange || benzingaQuote?.exchange || 'XNAS';
    const exchange = exchangeCode === 'XNAS' ? 'NASDAQ' : exchangeCode === 'XNYS' ? 'NYSE' : exchangeCode;

    return {
      symbol: ticker,
      companyName,
      currentPrice,
      changePercent,
      sma20,
      sma100,
      rsi,
      fiftyTwoWeekHigh,
      fiftyTwoWeekLow,
      nextEarningsDate: nextEarningsDate,
      exchange
    };
  } catch (error) {
    console.error(`Error fetching technical data for ${ticker}:`, error);
    return null;
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
    console.error('Error scraping URL:', error);
    return null;
  }
}


// Helper to format date (for earnings, use "Month Year" format)
function formatDate(dateString: string | null): string {
  if (!dateString) return 'Not scheduled';
  try {
    const date = new Date(dateString);
    const month = date.toLocaleDateString('en-US', { month: 'long' });
    const day = date.getDate();
    const year = date.getFullYear();
    return `${month} ${day}, ${year}`;
  } catch {
    return dateString;
  }
}

function formatDateline(companyName: string): string {
  // Extract city from company name or use a default
  // For now, use a simple approach - could be enhanced with a lookup
  const cityMap: { [key: string]: string } = {
    'Palantir': 'DENVER',
    'Micron': 'BOISE',
    'Nvidia': 'SANTA CLARA',
    'Apple': 'CUPERTINO',
    'Microsoft': 'REDMOND',
    'Amazon': 'SEATTLE',
    'Meta': 'MENLO PARK',
    'Google': 'MOUNTAIN VIEW',
    'Tesla': 'AUSTIN'
  };
  
  const city = cityMap[companyName.split(' ')[0]] || 'NEW YORK';
  const now = new Date();
  const month = now.toLocaleDateString('en-US', { month: 'short' });
  const day = now.getDate();
  const year = now.getFullYear();
  
  return `[DATELINE: ${city} — ${month}. ${day}, ${year}]`;
}

export async function POST(request: Request) {
  try {
    const { ticker, newsUrl, provider } = await request.json();
    
    console.log('[WGO CONCISE] Request received:', { ticker, hasNewsUrl: !!newsUrl, provider });

    if (!ticker || !ticker.trim()) {
      return NextResponse.json({ error: 'Ticker is required' }, { status: 400 });
    }

    const tickerUpper = ticker.trim().toUpperCase();
    const selectedProvider: AIProvider = provider === 'gemini' ? 'gemini' : 'openai';
    
    // Set the provider
    aiProvider.setProvider(selectedProvider);

    // Fetch technical data
    const technicalData = await fetchBasicTechnicalData(tickerUpper);
    if (!technicalData) {
      return NextResponse.json({ error: 'Failed to fetch technical data' }, { status: 500 });
    }

    // Scrape news URL if provided
    let newsContent = '';
    if (newsUrl && newsUrl.trim()) {
      const scraped = await scrapeNewsUrl(newsUrl.trim());
      if (scraped) {
        newsContent = scraped;
      }
    }

    // Get day of week
    const now = new Date();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayOfWeek = days[now.getDay()];

    // Calculate price vs SMA percentages
    const sma20Pct = technicalData.sma20 
      ? ((technicalData.currentPrice - technicalData.sma20) / technicalData.sma20 * 100).toFixed(1)
      : 'N/A';
    const sma100Pct = technicalData.sma100
      ? ((technicalData.currentPrice - technicalData.sma100) / technicalData.sma100 * 100).toFixed(1)
      : 'N/A';

    // Determine price position relative to 52-week range
    const rangePct = ((technicalData.currentPrice - technicalData.fiftyTwoWeekLow) / (technicalData.fiftyTwoWeekHigh - technicalData.fiftyTwoWeekLow) * 100).toFixed(1);
    const pricePosition = parseFloat(rangePct) > 80 ? 'near highs' : parseFloat(rangePct) < 20 ? 'near lows' : 'mid-range';

    // RSI interpretation with actionable context
    const rsiStatus = technicalData.rsi 
      ? (technicalData.rsi > 70 
          ? `Overbought (RSI ${technicalData.rsi.toFixed(1)} >70 suggests potential pullback)` 
          : technicalData.rsi < 30 
            ? `Oversold (RSI ${technicalData.rsi.toFixed(1)} <30 indicates potential bounce)`
            : `Neutral (RSI ${technicalData.rsi.toFixed(1)} in balanced range)`)
      : 'N/A';

    // Support/Resistance context with actionable insight
    let priceContext = '';
    if (technicalData.currentPrice > technicalData.fiftyTwoWeekHigh * 0.95) {
      const pctFromHigh = ((technicalData.currentPrice - technicalData.fiftyTwoWeekHigh) / technicalData.fiftyTwoWeekHigh * 100).toFixed(1);
      priceContext = `Testing ATH (within ${Math.abs(parseFloat(pctFromHigh))}% of 52-week high)`;
    } else if (technicalData.sma20) {
      const pctFromSMA20 = ((technicalData.currentPrice - technicalData.sma20) / technicalData.sma20 * 100).toFixed(1);
      if (parseFloat(pctFromSMA20) > 0) {
        priceContext = `Trading ${pctFromSMA20}% above 20-day average (bullish momentum)`;
      } else {
        priceContext = `Trading ${Math.abs(parseFloat(pctFromSMA20))}% below 20-day average (bearish pressure)`;
      }
    } else {
      priceContext = 'Trading range (awaiting trend confirmation)';
    }

    // Exchange name (already fetched in technicalData)
    const exchange = technicalData.exchange || 'NASDAQ';
    
    // Generate dateline
    const dateline = formatDateline(technicalData.companyName);

    // Build the prompt
    const prompt = `# ROLE
You are a Senior Financial Wire Correspondent writing enhanced, analytical news reports for traders. Your goal is to produce insightful, data-dense stories that explain both the news AND the market reaction. You prioritize narrative clarity, analytical depth, and actionable insights.

# PRIMARY CONSTRAINTS
1. NO DANCING: Start with the news. No "In a rapidly evolving market..." or "Investors are looking at..."
2. INVERTED PYRAMID: Lead with Ticker, Action (%), and Catalyst. Put secondary context in the body. Put technical data in a table at the end.
3. ABSOLUTE TONE: Use short, punchy, active-voice sentences. 
   - Good: "Shares rose 8%." (Active)
   - Bad: "Shares were seen to be rising by 8%." (Passive)
4. DATA ENRICHMENT: You must pull and calculate technical indicators from the provided data or your internal market knowledge.

# ZERO-INFERENCE GUARDRAILS (CRITICAL - NO HALLUCINATIONS)
1. THE VERBATIM RULE: DO NOT generate or paraphrase quotes. You are strictly forbidden from attributing any statement to an executive unless that specific quote exists verbatim in the provided text.
2. THE "UNCERTAINTY" PROTOCOL: If the source text does not contain a direct quote from the CEO or executive, do not mention them in a speaking capacity. Instead, use a neutral transition like: "${technicalData.companyName} operations are led by CEO [Name]."
3. FACT-CHECK REQUIREMENT: For every quote used, append the name of the executive and their exact title as stated in the source. If no quote exists verbatim in the source, skip the 'Executive Insight' section entirely.

# OUTPUT STRUCTURE

## Dateline
Start with: ${dateline} — 

## The Lead
Two sentences that combine price action, news, and market interpretation. Format: Shares of ${technicalData.companyName} (${exchange}:${tickerUpper}) are trading [higher/lower] ${dayOfWeek}, [slipping/rising] ${Math.abs(technicalData.changePercent).toFixed(2)}% to $${technicalData.currentPrice.toFixed(2)}, [even after/despite] [the news catalyst]. [Second sentence: Interpret the market reaction - e.g., "The dip appears to be a 'sell the news' reaction to a major strategic win" or "The rally reflects strong fundamental support"].

${newsUrl ? `CRITICAL HYPERLINK REQUIREMENT: You MUST include a hyperlink in the lead paragraph. Embed it naturally within three consecutive words using: <a href="${newsUrl}">three consecutive words</a>` : ''}

${newsUrl ? `CRITICAL HYPERLINK REQUIREMENT: You MUST include a hyperlink in the lead paragraph. Embed it naturally within three consecutive words of the existing text using this format: <a href="${newsUrl}">three consecutive words</a>

Example: "**Micron Technology, Inc.** (NASDAQ: MU) shares rose 7.85% to $363.07 Monday following the <a href="${newsUrl}">announcement of a</a> $1.8 billion cash acquisition..."

The hyperlink MUST be embedded naturally within the text - do NOT use phrases like "as detailed in" or "according to reports". Just embed it in three consecutive words that flow naturally with the sentence.` : ''}

${newsContent ? `CRITICAL: Use SPECIFIC DETAILS from the news content below. 

**FOR THE LEAD PARAGRAPH:**
- Include exact dollar amounts (e.g., "$1.8 billion")
- Include specific facility details (e.g., "300,000-square-foot facility")
- Include basic purpose/context
- MERGE THE NEWS DIRECTLY INTO THE LEAD: Integrate key news details with specific numbers/dates into the Lead paragraph

**FOR THE EXECUTION & SYNERGY DETAILS BULLETS (DO NOT REPEAT LEAD FACTS):**
- Include exact dates and timelines (e.g., "Q2 2026 closing", "H2 2027 production ramp") - these are CRITICAL for SEO
- Include geographic entities (e.g., "Tongluo, Taiwan", "proximity to Taichung operations") - Google's 2026 algorithm looks for geographic entity mapping
- Include functional context (e.g., "bypassing 3-year construction lead times", "streamlining logistics")
- Include specific operational details (e.g., "300mm fab cleanroom", "DRAM production", "post-wafer assembly")
- DO NOT repeat dollar amounts or facility sizes already mentioned in the Lead

**FOR EXECUTIVE COMMENTARY:**
- Include exact executive quotes (verbatim, with name and title)

Here is the source news content:
${newsContent.substring(0, 4000)}${newsContent.length > 4000 ? '...' : ''}` : `No news provided - generate the article based on technical data and market context only.`}

## Key Takeaways: The Deal at a Glance (Section Header - Use H2 format: <h2>Key Takeaways: The Deal at a Glance</h2>)
Create 3-4 bullet points using <ul> and <li> tags that summarize the deal in digestible format:
- **The News:** [One-sentence summary of what happened]
- **The Scale:** [One-sentence description of scope/significance, use quotes from executives if available]
- **The Tech/Details:** [One-sentence description of technology/products/services involved]
- **New Hub/Timeline/Geography:** [One-sentence about future plans, timelines, or geographic expansion]

Format:
<h2>Key Takeaways: The Deal at a Glance</h2>
<ul>
<li><strong>The News:</strong> [Summary]</li>
<li><strong>The Scale:</strong> [Scope/significance, can include executive quote]</li>
<li><strong>The Tech:</strong> [Technology/products involved]</li>
<li><strong>New Hub:</strong> [Future plans/timeline/geography]</li>
</ul>

## Why Is the Stock Down/Up? (Section Header - Use H2 format: <h2>Why Is the Stock ${technicalData.changePercent < 0 ? 'Down' : 'Up'}?</h2>)
${technicalData.changePercent < 0 ? `Despite the positive news, ${tickerUpper} is testing key technical levels. Explain the disconnect between fundamentals and price action. Include 2-3 bullet points using <ul> and <li> tags:
- **Technical Resistance/Support:** [Explain current technical position relative to key levels]
- **Market Context:** [Explain broader market factors affecting the stock]
- **Catalyst Timing:** [If applicable, explain why the reaction might be delayed or muted]

Format:
<h2>Why Is the Stock Down?</h2>
<ul>
<li><strong>Technical Resistance:</strong> The stock is [cooling off/rallying] after [hitting near all-time highs/testing support at $X].</li>
<li><strong>Market Context:</strong> [Broad tech weakness/broader sector trends] may be [dragging the ticker down/boosting the stock] despite the [bullish/bearish] catalyst.</li>
</ul>` : `The stock is trading higher. Explain why the news is being received positively. Include 2-3 bullet points using <ul> and <li> tags:
- **Fundamental Strength:** [Explain why the news is bullish]
- **Technical Momentum:** [Explain current technical position]
- **Market Context:** [Explain broader market factors]

Format:
<h2>Why Is the Stock Up?</h2>
<ul>
<li><strong>Fundamental Strength:</strong> [Explanation]</li>
<li><strong>Technical Momentum:</strong> [Explanation]</li>
</ul>`}

## Execution & Synergy Details (Section Header - Use H2 format: <h2>Execution & Synergy Details</h2>)
CRITICAL: This section MUST use numbered format (1., 2., 3.) with descriptive headers in bold, NOT HTML bulleted lists. Embed executive quotes directly within the narrative.

# INFORMATION DENSITY RULE (CRITICAL FOR SEO)
**DO NOT REPEAT FACTS FROM THE LEAD.** The Lead paragraph should contain the primary facts (deal value, facility size). The bullets must provide NEW, UNIQUE data points that were NOT mentioned in the Lead.

**What to include in the Lead:** Deal value ($1.8 billion), facility size (300,000-square-foot), basic purpose
**What to include in the Bullets:** Timeline (Q2 2026 closing, H2 2027 production), Geography (Tongluo, Taiwan; proximity to Taichung), Functional context (bypassing construction lead times, operational synergies)

**BAD EXAMPLE (Repetition):**
- Lead: "...acquisition of PSMC's P5 site for $1.8 billion, including a 300,000-square-foot cleanroom..."
- Bullet: "Acquisition Details: Micron acquires PSMC's P5 site for $1.8 billion, including a 300,000-square-foot cleanroom..." ❌ REPEATS LEAD

**GOOD EXAMPLE (Information Density):**
- Lead: "...acquisition of PSMC's P5 site for $1.8 billion, including a 300,000-square-foot cleanroom..."
- Bullet: "Investment Velocity: The $1.8B cash consideration secures an existing facility, bypassing the 3-year lead time required for greenfield construction." ✅ NEW DATA (timeline, functional context)
- Bullet: "Operational Horizon: Significant DRAM wafer output is projected to begin in H2 2027, following the transition of PSMC's existing operations." ✅ NEW DATA (production timeline)
- Bullet: "Regional Synergy: The Tongluo site integrates directly into Micron's Taiwan cluster, streamlining logistics for post-wafer assembly." ✅ NEW DATA (geography, location)

Format:
<h2>Execution & Synergy Details</h2>

<p><strong>1. [Descriptive Header]</strong></p>
<p>[Narrative paragraph explaining the detail. If an executive quote exists, embed it naturally: "This expanded strategic partnership marks an important turning point in connecting data and workflows... into a single, cohesive system." — <strong>[Name]</strong>, [title in lowercase], [company].]</p>

<p><strong>2. [Descriptive Header]</strong></p>
<p>[Narrative paragraph with timeline, geography, or functional context. DO NOT repeat facts from Lead.]</p>

<p><strong>3. [Descriptive Header]</strong></p>
<p>[Narrative paragraph with additional new information.]</p>

EXAMPLE FORMAT:
<h2>Execution & Synergy Details</h2>

<p><strong>1. Shipbuilding Revolution ("Future of Shipyard")</strong></p>
<p>Palantir is no longer just a software vendor; it is now the "orchestration layer" for HD Hyundai's massive shipbuilding division. "This expanded strategic partnership marks an important turning point in connecting data and workflows... into a single, cohesive system." — <strong>Chung Kisun</strong>, chairman of HD Hyundai.</p>

<p><strong>2. From Oil to Robotics</strong></p>
<p>Originally starting with HD Hyundai Oilbank in 2021 (refining), the partnership has proven its value by optimizing crude selection. Now, it expands to electric systems, construction equipment, and robotics.</p>

CRITICAL REQUIREMENTS:
1. Use numbered format (1., 2., 3.) with descriptive headers in <strong> tags
2. Write narrative paragraphs (2-3 sentences each), NOT bullet points
3. **EMBED QUOTES:** If executive quotes exist, embed them naturally within the narrative paragraphs using AP style: <strong>[Name]</strong>, [title in lowercase], [company]
4. **NO REPETITION:** Do NOT repeat dollar amounts, facility sizes, or other facts already stated in the Lead paragraph
5. **INCLUDE GEOGRAPHIC ENTITIES:** Mention specific locations (e.g., "Tongluo, Taiwan", "South Korea") - Google's 2026 algorithm looks for geographic entity mapping
6. **INCLUDE TIMELINES:** Include specific dates, quarters, or timeframes (e.g., "Q2 2026 closing", "H2 2027 production ramp", "began in 2021") - this adds forward-looking value
7. **USE FUNCTIONAL CONTEXT:** Instead of repeating numbers, explain what they enable (e.g., "bypassing 3-year construction lead times", "streamlining logistics")
8. Each numbered section must provide NEW, UNIQUE information not mentioned in the Lead

## Technical Analysis: The [Bullish/Bearish] Signal (Section Header - Use H2 format: <h2>Technical Analysis: The ${technicalData.changePercent < 0 ? 'Bearish' : 'Bullish'} Signal</h2>)

Start with a brief narrative paragraph (1-2 sentences) explaining the technical situation: "While the fundamental story is [bullish/bearish], the chart is flashing [warning signs/positive signals]."

Then create an HTML table with "Signal" column instead of "Context":

Create an HTML table. Use this EXACT format and order:

<table>
<thead>
<tr>
<th>Metric</th>
<th>Value</th>
<th>Signal</th>
</tr>
</thead>
<tbody>
<tr>
<td><strong>Current Price</strong></td>
<td>$${technicalData.currentPrice.toFixed(2)}</td>
<td>${technicalData.currentPrice > technicalData.fiftyTwoWeekHigh * 0.95 ? `Bearish (Below 20-Day SMA)` : parseFloat(sma20Pct) < 0 ? `Bearish (Below 20-Day SMA)` : `Bullish (Above 20-Day SMA)`}</td>
</tr>
<tr>
<td><strong>RSI (14)</strong></td>
<td>${technicalData.rsi ? technicalData.rsi.toFixed(1) : 'N/A'}</td>
<td>${technicalData.rsi ? (technicalData.rsi > 70 ? 'Overbought (Indicates potential pullback risk)' : technicalData.rsi < 30 ? 'Oversold (Potential bounce opportunity)' : 'Neutral (Approaching Oversold)') : 'N/A'}</td>
</tr>
<tr>
<td><strong>Support Level</strong></td>
<td>$${technicalData.sma20 ? technicalData.sma20.toFixed(2) : technicalData.fiftyTwoWeekLow.toFixed(2)}</td>
<td>Key psychological floor</td>
</tr>
<tr>
<td><strong>Next Catalyst</strong></td>
<td>${formatDate(technicalData.nextEarningsDate)}</td>
<td>${technicalData.nextEarningsDate ? 'Q4 Earnings Report' : 'Not scheduled'}</td>
</tr>
</tbody>
</table>

CRITICAL REQUIREMENTS:
- Use proper HTML table tags (<table>, <thead>, <tbody>, <tr>, <th>, <td>)
- Use "Signal" column instead of "Context"
- Include only these 4 rows in this exact order: Current Price, RSI (14), Support Level, Next Catalyst
- Every "Signal" cell must provide clear, actionable insight (Bullish/Bearish/Neutral with context)
- Use concise, professional language

# INSTRUCTIONS FOR ADDITIONAL DATA
- If a stock is up >5%, emphasize the SMA 20 gap and RSI overbought risk.
- If a stock is down >5%, emphasize support levels and oversold RSI.
- Always compare the Current Price to the 52-Week High to show "Room to Run."

# TECHNICAL DATA PROVIDED:
- Current Price: $${technicalData.currentPrice.toFixed(2)}
- Change: ${technicalData.changePercent > 0 ? '+' : ''}${technicalData.changePercent.toFixed(2)}%
- 52-Week High: $${technicalData.fiftyTwoWeekHigh.toFixed(2)}
- 52-Week Low: $${technicalData.fiftyTwoWeekLow.toFixed(2)}
- SMA 20: ${technicalData.sma20 ? `$${technicalData.sma20.toFixed(2)}` : 'N/A'}
- SMA 100: ${technicalData.sma100 ? `$${technicalData.sma100.toFixed(2)}` : 'N/A'}
- RSI: ${technicalData.rsi ? technicalData.rsi.toFixed(1) : 'N/A'}
- Next Earnings: ${technicalData.nextEarningsDate || 'Not scheduled'}

# SELF-AUDIT STEP (REQUIRED BEFORE OUTPUT)
Before finalizing your article, review:
1. **DATELINE:** Does the article start with the dateline format: [DATELINE: CITY — Month. Day, Year]?
2. **LEAD INTERPRETATION:** Does the lead explain WHY the stock is moving (e.g., "sell the news" reaction, fundamental support)?
3. **KEY TAKEAWAYS:** Have you created the "Key Takeaways" section with The News, The Scale, The Tech, and New Hub/Timeline?
4. **WHY IS STOCK DOWN/UP:** Have you explained the disconnect between fundamentals and price action (if stock is down despite good news) or why it's rallying (if up)?
5. **INFORMATION DENSITY CHECK:** Have you repeated any facts from the Lead paragraph in the Execution & Synergy Details? If yes, replace with NEW data (timeline, geography, functional context).
6. **GEOGRAPHIC ENTITIES:** Have you included specific locations in the Execution & Synergy Details? This is critical for 2026 SEO.
7. **TIMELINES:** Have you included specific dates/quarters in the Execution & Synergy Details? This adds forward-looking value.
8. **QUOTES EMBEDDED:** Are executive quotes embedded naturally within the Execution & Synergy Details narrative paragraphs (not in a separate section)?
9. **TECHNICAL TABLE:** Does the table use "Signal" column instead of "Context", and include only Current Price, RSI (14), Support Level, and Next Catalyst?
10. Are executive names bolded using <strong> tags and titles in AP style (lowercase when after name)?

# OUTPUT ARTICLE:`;

    const systemPrompt = `You are a Senior Financial Wire Correspondent writing enhanced, analytical news reports for traders. Your writing is:
- Narrative-driven with analytical depth
- Conversational yet professional tone
- Explains both the news AND the market reaction
- Uses dateline format for wire service authenticity
- Includes interpretive sections that explain price action
- Embeds quotes naturally within narrative paragraphs
- Includes technical analysis with clear signals

CRITICAL RULES:
1. NO HALLUCINATIONS: Never create quotes that don't exist verbatim in the source. Embed quotes naturally within Execution & Synergy Details paragraphs.
2. DATELINE FORMAT: Start with [DATELINE: CITY — Month. Day, Year] — format.
3. LEAD INTERPRETATION: The lead must explain WHY the stock is moving (e.g., "sell the news" reaction, fundamental support, technical resistance).
4. KEY TAKEAWAYS SECTION: Create a "Key Takeaways: The Deal at a Glance" section with The News, The Scale, The Tech, and New Hub/Timeline bullets.
5. WHY IS STOCK DOWN/UP SECTION: Explain the disconnect between fundamentals and price action if stock is down despite good news, or explain why it's rallying if up.
6. INFORMATION DENSITY (NO REPETITION): The Lead paragraph contains primary facts. The Execution & Synergy Details MUST provide NEW, UNIQUE data points: timelines, geography, and functional context. DO NOT repeat facts from the Lead.
7. EXECUTION & SYNERGY FORMAT: Use numbered format (1., 2., 3.) with descriptive headers in bold, NOT bulleted lists. Write narrative paragraphs (2-3 sentences each).
8. EMBED QUOTES: Embed executive quotes naturally within Execution & Synergy Details paragraphs using AP style: <strong>[Name]</strong>, [title in lowercase], [company].
9. GEOGRAPHIC ENTITIES: Include specific locations in Execution & Synergy Details - Google's 2026 algorithm looks for geographic entity mapping.
10. TIMELINES: Include specific dates/quarters in Execution & Synergy Details - this adds forward-looking value.
11. TECHNICAL TABLE: Use "Signal" column (not "Context") with only 4 rows: Current Price, RSI (14), Support Level, Next Catalyst.
12. HYPERLINK IN LEAD: ${newsUrl ? `You MUST include a hyperlink in the lead paragraph. Embed it naturally within three consecutive words using: <a href="${newsUrl}">three words</a>.` : 'No hyperlink required (no newsUrl provided).'}
13. SECTION HEADERS: You MUST use HTML <h2> tags for section headers:
   - <h2>Key Takeaways: The Deal at a Glance</h2>
   - <h2>Why Is the Stock Down/Up?</h2>
   - <h2>Execution & Synergy Details</h2>
   - <h2>Technical Analysis: The [Bullish/Bearish] Signal</h2>
14. USE SPECIFIC DETAILS: Extract and use exact numbers, dates, dollar amounts, facility details, geographic locations, timelines, and quotes from the source text.

CRITICAL: The output MUST include:
- Dateline format: [DATELINE: CITY — Month. Day, Year] —
- HTML <h2> tags for all section headers (Key Takeaways, Why Is the Stock Down/Up?, Execution & Synergy Details, Technical Analysis)
- "Key Takeaways: The Deal at a Glance" section with The News, The Scale, The Tech, and New Hub/Timeline
- "Why Is the Stock Down/Up?" section explaining the price action
- Execution & Synergy Details in numbered format (1., 2., 3.) with narrative paragraphs, NOT bulleted lists
- Executive quotes embedded naturally within Execution & Synergy Details paragraphs (not in a separate section)
- An HTML table for "Technical Analysis" section with "Signal" column (not "Context") and only 4 rows: Current Price, RSI (14), Support Level, Next Catalyst
- Specific details from the source (dollar amounts, dates, facility sizes, geographic locations, timelines, etc.)
- Verbatim executive quotes only (if they exist in source)`;

    const result = await aiProvider.generateCompletion(
      [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: prompt
        }
      ],
      {
        model: selectedProvider === 'gemini' ? 'gemini-2.5-flash' : 'gpt-4-turbo',
        temperature: 0.7,
        maxTokens: 1500,
      },
      selectedProvider
    );

    const article = result.content.trim();

    if (!article) {
      return NextResponse.json({ error: 'Failed to generate article' }, { status: 500 });
    }

    return NextResponse.json({
      ticker: tickerUpper,
      article,
      headline: article.split('\n')[0].replace(/^#+\s*/, '').trim() // Extract first line as headline
    });

  } catch (error: any) {
    console.error('Error generating concise WGO:', error);
    return NextResponse.json({
      error: error.message || 'Failed to generate article'
    }, { status: 500 });
  }
}
