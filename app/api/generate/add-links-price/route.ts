import { NextResponse } from 'next/server';
import { preserveHyperlinks, ensureProperPriceActionPlacement } from '../../../../lib/hyperlink-preservation';

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
        const priceData = {
          last: quote.lastTradePrice || 0,
          change: quote.change || 0,
          change_percent: quote.changePercent || 0,
          volume: quote.volume || 0,
          high: quote.high || 0,
          low: quote.low || 0,
          open: quote.open || 0,
          close: quote.close || quote.lastTradePrice || 0,
          // Add extended hours data if available - using correct field names from API
          extendedHoursPrice: quote.ethPrice || quote.extendedHoursPrice || quote.afterHoursPrice || quote.ahPrice || quote.extendedPrice || null,
          extendedHoursChange: quote.ethChange || quote.extendedHoursChange || quote.afterHoursChange || quote.ahChange || quote.extendedChange || null,
          extendedHoursChangePercent: quote.ethChangePercent || quote.extendedHoursChangePercent || quote.afterHoursChangePercent || quote.ahChangePercent || quote.extendedChangePercent || null,
          extendedHoursTime: quote.ethTime || quote.extendedHoursTime || quote.afterHoursTime || quote.ahTime || quote.extendedTime || null,
          extendedHoursVolume: quote.ethVolume || null
        };
        
        return priceData;
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
  if (day === 0 || day === 6) {
    return 'closed';
  }
  
  // Pre-market (4:00 AM - 9:30 AM ET)
  if (time >= 400 && time < 930) {
    return 'premarket';
  }
  
  // Regular trading (9:30 AM - 4:00 PM ET)
  if (time >= 930 && time < 1600) {
    return 'regular';
  }
  
  // After-hours (4:00 PM - 8:00 PM ET)
  if (time >= 1600 && time < 2000) {
    return 'afterhours';
  }
  
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
  const regularLast = parseFloat(priceData.close || priceData.last || 0).toFixed(2);
  const regularChangePercent = parseFloat(priceData.change_percent || 0).toFixed(2);
  const regularDisplayChangePercent = regularChangePercent.startsWith('-') ? regularChangePercent.substring(1) : regularChangePercent;
  
  // Extended hours data
  const hasExtendedHours = priceData.extendedHoursPrice;
  const extPrice = hasExtendedHours ? parseFloat(priceData.extendedHoursPrice || 0).toFixed(2) : null;
  const extChangePercent = priceData.extendedHoursChangePercent ? parseFloat(priceData.extendedHoursChangePercent || 0).toFixed(2) : null;
  const extDisplayChangePercent = extChangePercent && extChangePercent.startsWith('-') ? extChangePercent.substring(1) : extChangePercent;
  
  // Calculate after-hours change if we have the price but not the change percentage
  const regularClose = parseFloat(priceData.close || priceData.last || 0);
  const calculatedExtChangePercent = priceData.extendedHoursPrice && !priceData.extendedHoursChangePercent ? 
    ((parseFloat(priceData.extendedHoursPrice) - regularClose) / regularClose * 100).toFixed(2) : null;
  
  const finalExtChangePercent = extChangePercent || calculatedExtChangePercent;
  const finalHasExtendedHours = priceData.extendedHoursPrice && finalExtChangePercent;
  const finalExtDisplayChangePercent = finalExtChangePercent && finalExtChangePercent.startsWith('-') ? finalExtChangePercent.substring(1) : finalExtChangePercent;
  
  if (marketSession === 'regular') {
    return `${ticker} Price Action: ${ticker} shares were ${regularChangePercent.startsWith('-') ? 'down' : 'up'} ${regularDisplayChangePercent}% at $${regularLast} during regular trading hours on ${dayName}, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
  } else if (marketSession === 'premarket') {
    if (finalHasExtendedHours && finalExtChangePercent && finalExtDisplayChangePercent) {
      return `${ticker} Price Action: ${ticker} shares were ${finalExtChangePercent.startsWith('-') ? 'down' : 'up'} ${finalExtDisplayChangePercent}% at $${extPrice} during pre-market trading on ${dayName}, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
    } else {
      return `${ticker} Price Action: ${ticker} shares were trading during pre-market hours on ${dayName}, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
    }
  } else if (marketSession === 'afterhours') {
    if (finalHasExtendedHours && finalExtChangePercent && finalExtDisplayChangePercent) {
      // Show both regular session and after-hours changes
      const regularDirection = regularChangePercent.startsWith('-') ? 'fell' : 'rose';
      const extDirection = finalExtChangePercent.startsWith('-') ? 'down' : 'up';
      
      return `${ticker} Price Action: ${ticker} shares ${regularDirection} ${regularDisplayChangePercent}% to $${regularLast} during regular trading hours, and were ${extDirection} ${finalExtDisplayChangePercent}% at $${extPrice} during after-hours trading on ${dayName}, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
    } else {
      // Show regular session data with after-hours indication
      const regularDirection = regularChangePercent.startsWith('-') ? 'fell' : 'rose';
      return `${ticker} Price Action: ${ticker} shares ${regularDirection} ${regularDisplayChangePercent}% to $${regularLast} during regular trading hours on ${dayName}. The stock is currently trading in after-hours session, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
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

// Helper function to remove existing Also Read, Read Next, and Price Action lines
function removeExistingLinks(story: string): string {
  // Remove Also Read links (can be anywhere in the story)
  story = story.replace(/Also Read:.*?(?=\n\n|\n[A-Z]|$)/g, '');
  
  // Remove Read Next links (usually at the end)
  story = story.replace(/Read Next:.*?(?=\n\n|\n[A-Z]|$)/g, '');
  
  // Remove Price Action lines (usually at the end, format: "TICKER Price Action: ...")
  story = story.replace(/[A-Z]+ Price Action:.*?(?=\n\n|\n[A-Z]|$)/g, '');
  
  // Clean up any double line breaks that might be left
  story = story.replace(/\n\n\n+/g, '\n\n');
  
  return story.trim();
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
  
  // Insert the Also Read link in the middle of the article
  // For stories with 3+ paragraphs, place it after the middle paragraph
  // For stories with 4+ paragraphs, place it after the second paragraph (more towards middle)
  const insertIndex = paragraphs.length >= 4 ? 2 : Math.floor(paragraphs.length / 2);
  const newParagraphs = [...paragraphs];
  newParagraphs.splice(insertIndex + 1, 0, alsoReadLink);
  
  // Reconstruct the story
  let result;
  if (story.includes('</p>')) {
    // HTML content - wrap in <p> tags
    result = newParagraphs.map(p => `<p>${p}</p>`).join('\n');
  } else {
    // Plain text content
    result = newParagraphs.join('\n\n');
  }
  
  // Verify we didn't lose any hyperlinks
  const originalHyperlinkCount = (story.match(/<a href=/g) || []).length;
  const newHyperlinkCount = (result.match(/<a href=/g) || []).length;
  
  if (newHyperlinkCount < originalHyperlinkCount) {
    // Fallback: just append at the end
    return story + '\n\n' + alsoReadLink;
  }
  
  return result;
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
    
    // Remove existing Also Read and Read Next links if they exist
    completeStory = removeExistingLinks(completeStory);
    
    // Insert Also Read link midway through the article
    if (alsoReadLink) {
      completeStory = insertAlsoReadMidway(completeStory, alsoReadLink);
    }
    
    // Ensure proper placement of price action and Read Next links
    completeStory = ensureProperPriceActionPlacement(completeStory, priceActionLine, readNextLink);
    
    // Preserve existing hyperlinks
    const finalStory = preserveHyperlinks(story, completeStory);
    
    return NextResponse.json({ 
      story: finalStory,
      priceActionLine,
      alsoReadLink,
      readNextLink
    });
  } catch (error: any) {
    console.error('Error adding links and price:', error);
    return NextResponse.json({ error: error.message || 'Failed to add links and price.' }, { status: 500 });
  }
} 