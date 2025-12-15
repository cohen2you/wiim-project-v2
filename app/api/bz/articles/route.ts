import { NextResponse } from 'next/server';

const BENZINGA_API_KEY = process.env.BENZINGA_API_KEY!;
const BZ_NEWS_URL = 'https://api.benzinga.com/api/v2/news';

export async function POST(req: Request) {
  try {
    const { ticker, count } = await req.json();
    if (!ticker) return NextResponse.json({ error: 'Ticker is required' }, { status: 400 });
    // Fetch more items to ensure enough non-PR articles after filtering
    const desiredCount = count && typeof count === 'number' ? count : 10;
    const items = Math.max(desiredCount * 5, 50); // Fetch more items to ensure we get recent articles after filtering
    
    // Fetch articles - start with last 7 days, don't use dateTo to get all articles up to today
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);
    
    // Don't use dateTo parameter - let API return all articles up to today
    let url = `${BZ_NEWS_URL}?token=${BENZINGA_API_KEY}&tickers=${encodeURIComponent(ticker)}&items=${items}&fields=headline,title,created,body,teaser,id,url,channels&accept=application/json&displayOutput=full&dateFrom=${startDate.toISOString().split('T')[0]}`;
    
    console.log(`Fetching articles from ${startDate.toISOString().split('T')[0]} to today for ticker ${ticker}`);
    
    let res = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
    });
    let text = await res.text();
    if (!res.ok) {
      console.error('Benzinga API error:', text);
      throw new Error(`Benzinga API error: ${text}`);
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.error('Benzinga API did not return valid JSON. Response:', text);
      return NextResponse.json({ error: 'Benzinga API did not return valid JSON. Response: ' + text }, { status: 500 });
    }
    if (!Array.isArray(data)) {
      console.error('Benzinga API response (not array):', data);
      return NextResponse.json({ error: 'Invalid response format from Benzinga', raw: data }, { status: 500 });
    }
    
    console.log(`Benzinga API returned ${data.length} raw articles for ticker ${ticker}`);
    
    // Log first few article dates for debugging
    if (data.length > 0) {
      const sampleDates = data.slice(0, 5).map((item: any) => ({
        headline: item.headline || item.title,
        created: item.created,
        date: item.created ? new Date(item.created).toISOString().split('T')[0] : 'N/A'
      }));
      console.log('Sample article dates:', JSON.stringify(sampleDates, null, 2));
    }
    // Exclude PRs and insights URLs by filtering out items with PR channel names or insights URLs
    const prChannelNames = ['press releases', 'press-releases', 'pressrelease', 'pr'];
    const normalize = (str: string) => str.toLowerCase().replace(/[-_]/g, ' ');
        const articles = data
      .filter(item => {
        // First, check for valid headline
        const headline = item.headline || item.title;
        if (!headline || headline === 'undefined' || headline === '') {
          console.log(`Filtered out article with invalid headline: "${headline}"`);
          return false;
        }
        
        // Exclude press releases
        if (Array.isArray(item.channels) &&
          item.channels.some(
            (ch: any) =>
              typeof ch.name === 'string' &&
              prChannelNames.includes(normalize(ch.name))
          )) {
          return false;
        }
        
        // Exclude insights URLs
        if (item.url && item.url.includes('/insights/')) {
          return false;
        }
        
        // Ensure the article actually mentions the ticker prominently
        const tickerUpper = ticker.toUpperCase();
        const headlineUpper = headline.toUpperCase();
        const body = (item.body || item.teaser || '').toUpperCase();
        
        // Check if ticker appears in headline or first 500 characters of body
        const tickerInHeadline = headlineUpper.includes(tickerUpper);
        const tickerInBody = body.substring(0, 500).includes(tickerUpper);
        
        // For companies, also check for company name variations
        let companyNameMatch = false;
        if (tickerUpper === 'TOL') {
          companyNameMatch = headlineUpper.includes('TOLL BROTHERS') || body.substring(0, 500).includes('TOLL BROTHERS');
        }
        
        // Include articles that feature the ticker or company name prominently
        const isRelevant = tickerInHeadline || tickerInBody || companyNameMatch;
        
        // Debug logging for filtered out items
        if (!isRelevant) {
          console.log(`Filtered out article: "${headline}" - No ticker/company match found`);
        }
        
        return isRelevant;
      })
      .map((item: any) => ({
        id: item.id,
        headline: item.headline || item.title || '[No Headline]',
        created: item.created,
        body: item.body || item.teaser || '[No body text]',
        url: item.url || '',
      }))
      .filter(item => item.headline !== '[No Headline]' && item.headline !== 'undefined');
    
    // Sort by date descending (newest first) - handle various date formats
    articles.sort((a, b) => {
      const dateA = a.created ? new Date(a.created).getTime() : 0;
      const dateB = b.created ? new Date(b.created).getTime() : 0;
      return dateB - dateA; // Descending order (newest first)
    });
    
    // Log the dates of articles we're returning
    if (articles.length > 0) {
      const returnedDates = articles.slice(0, Math.min(articles.length, desiredCount)).map((item: any) => ({
        headline: item.headline,
        created: item.created,
        date: item.created ? new Date(item.created).toISOString().split('T')[0] : 'N/A'
      }));
      console.log(`Returning ${Math.min(articles.length, desiredCount)} articles with dates:`, JSON.stringify(returnedDates, null, 2));
    }
    
    console.log(`After filtering: ${articles.length} articles remain`);
    console.log(`Returning ${Math.min(articles.length, desiredCount)} articles`);
    
    return NextResponse.json({ articles: articles.slice(0, desiredCount) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to fetch articles' }, { status: 500 });
  }
} 