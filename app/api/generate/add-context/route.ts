import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const BENZINGA_API_KEY = process.env.BENZINGA_API_KEY!;
const BZ_NEWS_URL = 'https://api.benzinga.com/api/v2/news';

async function fetchRecentArticles(ticker: string): Promise<any[]> {
  try {
    // Strategy 1: Recent ticker-specific articles (48 hours)
    const dateFrom48h = new Date();
    dateFrom48h.setDate(dateFrom48h.getDate() - 2);
    const dateFrom48hStr = dateFrom48h.toISOString().slice(0, 10);
    
    const recentUrl = `${BZ_NEWS_URL}?token=${BENZINGA_API_KEY}&tickers=${encodeURIComponent(ticker)}&items=30&fields=headline,title,created,body,url,channels&accept=application/json&displayOutput=full&dateFrom=${dateFrom48hStr}`;
    
    console.log(`Searching for recent ${ticker} articles (48 hours)...`);
    const recentRes = await fetch(recentUrl, {
      headers: { Accept: 'application/json' },
    });
    
    if (recentRes.ok) {
      const recentData = await recentRes.json();
      if (Array.isArray(recentData) && recentData.length > 0) {
        const recentArticles = filterAndProcessArticles(recentData, false);
        console.log(`Found ${recentArticles.length} recent articles for ${ticker}`);
        
        if (recentArticles.length >= 2) {
          console.log('Using recent ticker-specific articles');
          return recentArticles.slice(0, 2);
        }
      }
    }
    
    // Strategy 2: Movers articles from past month (avoiding insights URLs)
    const dateFrom30d = new Date();
    dateFrom30d.setDate(dateFrom30d.getDate() - 30);
    const dateFrom30dStr = dateFrom30d.toISOString().slice(0, 10);
    
    const moversUrl = `${BZ_NEWS_URL}?token=${BENZINGA_API_KEY}&tickers=${encodeURIComponent(ticker)}&items=100&fields=headline,title,created,body,url,channels&accept=application/json&displayOutput=full&dateFrom=${dateFrom30dStr}`;
    
    console.log(`Searching for movers articles for ${ticker} (30 days)...`);
    const moversRes = await fetch(moversUrl, {
      headers: { Accept: 'application/json' },
    });
    
    if (moversRes.ok) {
      const moversData = await moversRes.json();
      if (Array.isArray(moversData) && moversData.length > 0) {
        const moversArticles = filterAndProcessArticles(moversData, true);
        console.log(`Found ${moversArticles.length} movers articles for ${ticker}`);
        
        if (moversArticles.length >= 2) {
          console.log('Using movers articles');
          return moversArticles.slice(0, 2);
        }
      }
    }
    
    // Strategy 3: SPY market articles (24 hours)
    const dateFrom24h = new Date();
    dateFrom24h.setDate(dateFrom24h.getDate() - 1);
    const dateFrom24hStr = dateFrom24h.toISOString().slice(0, 10);
    
    const spyUrl = `${BZ_NEWS_URL}?token=${BENZINGA_API_KEY}&tickers=SPY&items=20&fields=headline,title,created,body,url,channels&accept=application/json&displayOutput=full&dateFrom=${dateFrom24hStr}`;
    
    console.log('Searching for SPY market articles (24 hours)...');
    const spyRes = await fetch(spyUrl, {
      headers: { Accept: 'application/json' },
    });
    
    if (spyRes.ok) {
      const spyData = await spyRes.json();
      if (Array.isArray(spyData) && spyData.length > 0) {
        const spyArticles = filterAndProcessArticles(spyData, false);
        console.log(`Found ${spyArticles.length} SPY articles`);
        
        if (spyArticles.length >= 2) {
          console.log('Using SPY market articles as fallback');
          return spyArticles.slice(0, 2);
        }
      }
    }
    
    console.log('No suitable articles found from any strategy');
    return [];
  } catch (error) {
    console.error('Error fetching recent articles:', error);
    return [];
  }
}

// Helper function to filter and process articles
function filterAndProcessArticles(data: any[], prioritizeMovers: boolean): any[] {
  // Filter out press releases and insights URLs
  const prChannelNames = ['press releases', 'press-releases', 'pressrelease'];
  const normalize = (str: string) => str.toLowerCase().replace(/[-_]/g, ' ');
  
  let articles = data
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
      
      return true;
    })
    .map((item: any) => ({
      headline: item.headline || item.title || '[No Headline]',
      body: item.body || '',
      url: item.url,
      created: item.created,
      isMovers: item.url && item.url.includes('/trading-ideas/movers'),
    }))
    .filter(item => {
      // Ensure substantial content and valid URL
      return item.body && item.body.length > 50 && item.url;
    });
  
  // Sort articles based on strategy
  if (prioritizeMovers) {
    // For movers strategy: prioritize movers articles, then by date
    articles.sort((a, b) => {
      if (a.isMovers && !b.isMovers) return -1;
      if (!a.isMovers && b.isMovers) return 1;
      
      const dateA = new Date(a.created || 0);
      const dateB = new Date(b.created || 0);
      return dateB.getTime() - dateA.getTime();
    });
  } else {
    // For other strategies: sort by date only
    articles.sort((a, b) => {
      const dateA = new Date(a.created || 0);
      const dateB = new Date(b.created || 0);
      return dateB.getTime() - dateA.getTime();
    });
  }
  
  return articles;
}

export async function POST(request: Request) {
  try {
    const { ticker, existingStory } = await request.json();
    
    if (!ticker || !existingStory) {
      return NextResponse.json({ error: 'Ticker and existing story are required.' }, { status: 400 });
    }

    // Fetch two recent articles for context
    const recentArticles = await fetchRecentArticles(ticker);
    
    if (recentArticles.length === 0) {
      return NextResponse.json({ error: 'No recent articles found for context.' }, { status: 404 });
    }

    // Validate that we have at least 2 articles with valid URLs
    const validArticles = recentArticles.filter(article => article.url && article.headline && article.body);
    
    console.log(`Valid articles found: ${validArticles.length}`);
    validArticles.forEach((article, index) => {
      console.log(`Article ${index + 1}: ${article.headline} - URL: ${article.url ? 'Yes' : 'No'}`);
    });
    
        if (validArticles.length < 2) {
      return NextResponse.json({ 
        error: `Insufficient articles with valid URLs. Found ${validArticles.length} valid articles, need at least 2.` 
      }, { status: 404 });
    }

    // Ensure we have exactly 2 articles for the context
    const articlesForContext = validArticles.slice(0, 2);

    // Get current price data for the price action line
    const priceData = await fetchPriceData(ticker);

    // Prepare article data for the prompt
    const articlesData = articlesForContext.map((article, index) => 
      `Article ${index + 1}:
Headline: ${article.headline}
Content: ${article.body}
URL: ${article.url}`
    ).join('\n\n');

    // Generate enhanced story with integrated context
    const prompt = `
You are a financial journalist. You have an existing story and two recent news articles about the same ticker. Your task is to intelligently integrate content from these articles into the existing story.

EXISTING STORY:
${existingStory}

RECENT ARTICLES:
${articlesData}

CRITICAL TASK: You MUST integrate content from BOTH articles with EXACTLY 2 hyperlinks total AND add a standalone "Also Read" line.

INSTRUCTIONS:
1. Review the existing story and identify where to integrate content from the two articles
2. Place ONE hyperlink from Article 1 in the FIRST or SECOND paragraph of the story
3. Place ONE hyperlink from Article 2 in a MIDDLE paragraph (paragraphs 3-5) of the story
4. Each integration should be MAXIMUM 2 sentences from each article source
5. Weave the content naturally into existing paragraphs - do NOT create standalone hyperlink lines
6. Use this exact hyperlink format: <a href="[URL]">[three word phrase]</a>
7. Maintain the two-sentence-per-paragraph rule throughout
8. Focus on technical data, market context, or relevant business developments
9. Make the integrations feel natural and enhance the story's flow
10. Do NOT reference "recent articles" or similar phrases - just embed the hyperlinks naturally
11. Ensure all prices are formatted to exactly 2 decimal places

MANDATORY HYPERLINK REQUIREMENTS:
- Article 1 URL: ${articlesForContext[0].url} - MUST be used in paragraph 1 or 2
- Article 2 URL: ${articlesForContext[1].url} - MUST be used in paragraph 3, 4, or 5
- Both hyperlinks must be embedded naturally in the text
- YOU MUST INCLUDE EXACTLY 2 HYPERLINKS - ONE FROM EACH ARTICLE
- DO NOT SKIP EITHER ARTICLE - BOTH MUST BE USED
- If you only include 1 hyperlink, you have failed the task

ALSO READ LINE REQUIREMENT:
- Add a standalone line in the middle of the story (paragraphs 3-5)
- Format: "Also Read: <a href="${articlesForContext[0].url}">${articlesForContext[0].headline}</a>"
- Place it between paragraphs, not integrated into text
- This is in addition to the 2 integrated hyperlinks

CRITICAL RULES:
- Article 1 hyperlink goes in paragraph 1 or 2
- Article 2 hyperlink goes in paragraph 3, 4, or 5
- Maximum 2 sentences per article integration
- No standalone hyperlink lines (except the "Also Read" line)
- Maintain existing story structure and flow
- Format all prices to exactly 2 decimal places

VERIFICATION: Before submitting, count your hyperlinks. You must have exactly 2 integrated hyperlinks plus 1 "Also Read" line.

Return the complete enhanced story with integrated context and "Also Read" line:`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000,
      temperature: 0.7,
    });

    const enhancedStory = completion.choices[0].message?.content?.trim() || '';

    if (!enhancedStory) {
      return NextResponse.json({ error: 'Failed to generate enhanced story.' }, { status: 500 });
    }

    // Add price action line at the bottom
    const priceActionLine = generatePriceActionLine(ticker, priceData);
    
    // Add Read Next link (only headline hyperlinked)
    const readNextLink = `Read Next: <a href="${articlesForContext[1].url}">${articlesForContext[1].headline}</a>`;
    
    // Combine enhanced story with price action line and read next link
    const completeStory = `${enhancedStory}\n\n${priceActionLine}\n\n${readNextLink}`;
    
    return NextResponse.json({ 
      story: completeStory,
      contextSources: articlesForContext.map(article => ({
        headline: article.headline,
        url: article.url
      }))
    });
  } catch (error: any) {
    console.error('Error adding context:', error);
    return NextResponse.json({ error: error.message || 'Failed to add context.' }, { status: 500 });
  }
}

// Helper function to fetch price data
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
          change_percent: quote.changePercent || 0,
          volume: quote.volume || 0,
          high: quote.high || 0,
          low: quote.low || 0,
          open: quote.open || 0
        };
      }
    }
    return null;
  } catch (error) {
    console.error('Error fetching price data:', error);
    return null;
  }
}

// Helper function to generate price action line
function generatePriceActionLine(ticker: string, priceData: any) {
  if (!priceData) {
    return `${ticker} Price Action: ${ticker} shares were trading during regular market hours, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
  }
  
  const last = parseFloat(priceData.last || 0).toFixed(2);
  const change = parseFloat(priceData.change || 0).toFixed(2);
  const changePercent = parseFloat(priceData.change_percent || 0).toFixed(2);
  
  // Check if market is open (rough estimate)
  const now = new Date();
  const isMarketOpen = now.getHours() >= 9 && now.getHours() < 16;
  
  if (isMarketOpen) {
    return `${ticker} Price Action: ${ticker} shares were ${changePercent.startsWith('-') ? 'down' : 'up'} ${changePercent}% at $${last} during regular trading hours on ${getCurrentDayName()}, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
  } else {
    return `${ticker} Price Action: ${ticker} shares ${changePercent.startsWith('-') ? 'fell' : 'rose'} ${changePercent}% to $${last} during regular trading hours on ${getCurrentDayName()}, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
  }
}

// Helper function to get current day name
function getCurrentDayName() {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[new Date().getDay()];
} 