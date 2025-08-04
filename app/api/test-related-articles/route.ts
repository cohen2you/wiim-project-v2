import { NextResponse } from 'next/server';

const BENZINGA_API_KEY = process.env.BENZINGA_API_KEY!;
const BZ_NEWS_URL = 'https://api.benzinga.com/api/v2/news';

async function fetchRelatedArticles(ticker: string, excludeUrl?: string): Promise<any[]> {
  try {
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - 7);
    const dateFromStr = dateFrom.toISOString().slice(0, 10);
    
    const url = `${BZ_NEWS_URL}?token=${BENZINGA_API_KEY}&tickers=${encodeURIComponent(ticker)}&items=20&fields=headline,title,created,url,channels&accept=application/json&displayOutput=full&dateFrom=${dateFromStr}`;
    
    console.log('Fetching related articles for ticker:', ticker);
    console.log('Benzinga API URL:', url);
    
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    
    if (!res.ok) {
      console.error('Benzinga API error:', await res.text());
      return [];
    }
    
    const data = await res.json();
    console.log('Benzinga API response:', data);
    if (!Array.isArray(data)) return [];
    
    // Filter out press releases and the current article URL
    const prChannelNames = ['press releases', 'press-releases', 'pressrelease', 'pr'];
    const normalize = (str: string) => str.toLowerCase().replace(/[-_]/g, ' ');
    
    const relatedArticles = data
      .filter(item => {
        // Exclude press releases
        if (Array.isArray(item.channels) && item.channels.some((ch: any) => 
          typeof ch.name === 'string' && prChannelNames.includes(normalize(ch.name))
        )) {
          console.log('Filtering out press release:', item.headline || item.title);
          return false;
        }
        
        // Exclude the current article URL if provided
        if (excludeUrl && item.url === excludeUrl) {
          console.log('Filtering out current article URL:', item.headline || item.title);
          return false;
        }
        
        return true;
      })
      .map((item: any) => ({
        headline: item.headline || item.title || '[No Headline]',
        url: item.url,
        created: item.created,
      }))
      .slice(0, 5);
    
    console.log('Filtered related articles:', relatedArticles);
    
    return relatedArticles;
  } catch (error) {
    console.error('Error fetching related articles:', error);
    console.error('BENZINGA_API_KEY available:', !!BENZINGA_API_KEY);
    return [];
  }
}

export async function POST(req: Request) {
  try {
    const { ticker } = await req.json();
    
    if (!ticker) {
      return NextResponse.json({ error: 'Ticker is required' }, { status: 400 });
    }
    
    const relatedArticles = await fetchRelatedArticles(ticker);
    
    return NextResponse.json({ 
      relatedArticles,
      count: relatedArticles.length,
      ticker 
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to fetch related articles' }, { status: 500 });
  }
} 