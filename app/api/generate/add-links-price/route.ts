import { NextResponse } from 'next/server';

const BENZINGA_API_KEY = process.env.BENZINGA_API_KEY!;
const BZ_NEWS_URL = 'https://api.benzinga.com/api/v2/news';

// Helper function to fetch additional market articles for Also Read and Read Next links
async function fetchAdditionalMarketArticles(): Promise<any[]> {
  try {
    const dateFrom24h = new Date();
    dateFrom24h.setDate(dateFrom24h.getDate() - 1);
    const dateFrom24hStr = dateFrom24h.toISOString().slice(0, 10);
    
    // Search for general market articles from the past 24 hours
    const marketUrl = `${BZ_NEWS_URL}?token=${BENZINGA_API_KEY}&items=20&fields=headline,title,created,body,url,channels&accept=application/json&displayOutput=full&dateFrom=${dateFrom24hStr}`;
    
    console.log('Fetching additional market articles for Also Read/Read Next links...');
    const marketRes = await fetch(marketUrl, {
      headers: { Accept: 'application/json' },
    });
    
    if (marketRes.ok) {
      const marketData = await marketRes.json();
      if (Array.isArray(marketData) && marketData.length > 0) {
        const marketArticles = filterAndProcessArticles(marketData);
        console.log(`Found ${marketArticles.length} additional market articles`);
        return marketArticles.slice(0, 2);
      }
    }
    
    return [];
  } catch (error) {
    console.error('Error fetching additional market articles:', error);
    return [];
  }
}

// Helper function to filter and process articles
function filterAndProcessArticles(data: any[]): any[] {
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
    }))
    .filter(item => {
      // Ensure substantial content and valid URL
      return item.body && item.body.length > 50 && item.url;
    })
    .sort((a, b) => {
      // Sort by date (newer first)
      const dateA = new Date(a.created || 0);
      const dateB = new Date(b.created || 0);
      return dateB.getTime() - dateA.getTime();
    });
  
  return articles;
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
  
  // Use extended hours data if available and we're in extended hours
  const useExtendedHours = (marketSession === 'premarket' || marketSession === 'afterhours') && 
                           priceData.extendedHoursPrice && 
                           priceData.extendedHoursChangePercent;
  
  if (useExtendedHours) {
    const extPrice = parseFloat(priceData.extendedHoursPrice || 0).toFixed(2);
    const extChangePercent = parseFloat(priceData.extendedHoursChangePercent || 0).toFixed(2);
    const sessionText = marketSession === 'premarket' ? 'pre-market trading' : 'after-hours trading';
    
    return `${ticker} Price Action: ${ticker} shares were ${extChangePercent.startsWith('-') ? 'down' : 'up'} ${extChangePercent}% at $${extPrice} during ${sessionText} on ${dayName}, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
  }
  
  // Use regular session data
  const last = parseFloat(priceData.last || 0).toFixed(2);
  const changePercent = parseFloat(priceData.change_percent || 0).toFixed(2);
  
  if (marketSession === 'regular') {
    return `${ticker} Price Action: ${ticker} shares were ${changePercent.startsWith('-') ? 'down' : 'up'} ${changePercent}% at $${last} during regular trading hours on ${dayName}, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
  } else if (marketSession === 'premarket') {
    return `${ticker} Price Action: ${ticker} shares were ${changePercent.startsWith('-') ? 'down' : 'up'} ${changePercent}% at $${last} during pre-market trading on ${dayName}, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
  } else if (marketSession === 'afterhours') {
    return `${ticker} Price Action: ${ticker} shares were ${changePercent.startsWith('-') ? 'down' : 'up'} ${changePercent}% at $${last} during after-hours trading on ${dayName}, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
  } else {
    // Market is closed, use last regular session data
    return `${ticker} Price Action: ${ticker} shares ${changePercent.startsWith('-') ? 'fell' : 'rose'} ${changePercent}% to $${last} during regular trading hours on ${dayName}, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
  }
}

// Helper function to get current day name
function getCurrentDayName() {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[new Date().getDay()];
}

// Helper function to insert Also Read link midway through the article
function insertAlsoReadMidway(story: string, alsoReadLink: string): string {
  if (!alsoReadLink) return story;
  
  // Split the story into paragraphs (handle both \n\n and </p><p> patterns)
  let paragraphs: string[];
  
  if (story.includes('</p>')) {
    // HTML content - split by </p><p> or </p>\n<p>
    paragraphs = story.split(/<\/p>\s*<p[^>]*>/).filter(p => p.trim());
    // Clean up the first and last paragraphs
    if (paragraphs.length > 0) {
      paragraphs[0] = paragraphs[0].replace(/^<p[^>]*>/, '');
      paragraphs[paragraphs.length - 1] = paragraphs[paragraphs.length - 1].replace(/<\/p>$/, '');
    }
  } else {
    // Plain text content
    paragraphs = story.split('\n\n').filter(p => p.trim());
  }
  
  if (paragraphs.length <= 2) {
    // If story is too short, just add at the end
    return story + '\n\n' + alsoReadLink;
  }
  
  // Find the middle paragraph (approximately)
  const middleIndex = Math.floor(paragraphs.length / 2);
  
  // Insert the Also Read link after the middle paragraph
  const newParagraphs = [...paragraphs];
  newParagraphs.splice(middleIndex + 1, 0, alsoReadLink);
  
  // Reconstruct the story
  if (story.includes('</p>')) {
    // HTML content - wrap in <p> tags
    return newParagraphs.map(p => `<p>${p}</p>`).join('\n');
  } else {
    // Plain text content
    return newParagraphs.join('\n\n');
  }
}

export async function POST(request: Request) {
  try {
    const { ticker, story } = await request.json();
    
    if (!ticker || !story) {
      return NextResponse.json({ error: 'Ticker and story are required.' }, { status: 400 });
    }

    // Get current price data for the price action line
    const priceData = await fetchPriceData(ticker);
    
    // Get separate articles for Also Read and Read Next links
    const additionalArticles = await fetchAdditionalMarketArticles();
    
    // Add price action line at the bottom
    const priceActionLine = generatePriceActionLine(ticker, priceData);
    
    // Add Also Read link
    const alsoReadArticle = additionalArticles.length > 0 ? additionalArticles[0] : null;
    const alsoReadLink = alsoReadArticle ? `Also Read: <a href="${alsoReadArticle.url}">${alsoReadArticle.headline}</a>` : '';
    
    // Add Read Next link
    const readNextArticle = additionalArticles.length > 1 ? additionalArticles[1] : (additionalArticles.length > 0 ? additionalArticles[0] : null);
    const readNextLink = readNextArticle ? `Read Next: <a href="${readNextArticle.url}">${readNextArticle.headline}</a>` : '';
    
    // Combine story with price action line and additional links
    let completeStory = story;
    
    // Insert Also Read link midway through the article
    if (alsoReadLink) {
      console.log('Inserting Also Read link midway through article');
      completeStory = insertAlsoReadMidway(completeStory, alsoReadLink);
    }
    
    // Add price action line at the bottom
    if (priceActionLine) {
      completeStory += `\n\n${priceActionLine}`;
    }
    
    // Add Read Next link at the very end
    if (readNextLink) {
      completeStory += `\n\n${readNextLink}`;
    }
    
    return NextResponse.json({ 
      story: completeStory,
      priceActionLine,
      alsoReadLink,
      readNextLink
    });
  } catch (error: any) {
    console.error('Error adding links and price:', error);
    return NextResponse.json({ error: error.message || 'Failed to add links and price.' }, { status: 500 });
  }
} 