import { NextResponse } from 'next/server';

const BENZINGA_API_KEY = process.env.BENZINGA_API_KEY!;
const BZ_NEWS_URL = 'https://api.benzinga.com/api/v2/news';

export async function POST(req: Request) {
  try {
    const { ticker } = await req.json();
    
    if (!ticker) {
      return NextResponse.json({ error: 'Ticker is required' }, { status: 400 });
    }
    
    console.log('Testing Benzinga API for ticker:', ticker);
    console.log('BENZINGA_API_KEY available:', !!BENZINGA_API_KEY);
    console.log('BENZINGA_API_KEY length:', BENZINGA_API_KEY ? BENZINGA_API_KEY.length : 0);
    
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - 7);
    const dateFromStr = dateFrom.toISOString().slice(0, 10);
    
    const url = `${BZ_NEWS_URL}?token=${BENZINGA_API_KEY}&tickers=${encodeURIComponent(ticker)}&items=5&fields=headline,title,created,url,channels&accept=application/json&displayOutput=full&dateFrom=${dateFromStr}`;
    
    console.log('Benzinga API URL:', url);
    
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    
    console.log('Benzinga API response status:', res.status);
    console.log('Benzinga API response headers:', Object.fromEntries(res.headers.entries()));
    
    if (!res.ok) {
      const errorText = await res.text();
      console.error('Benzinga API error:', errorText);
      return NextResponse.json({ 
        error: 'Benzinga API error', 
        status: res.status, 
        response: errorText 
      }, { status: 500 });
    }
    
    const data = await res.json();
    console.log('Benzinga API response data:', data);
    
    return NextResponse.json({ 
      success: true,
      data,
      ticker,
      apiKeyAvailable: !!BENZINGA_API_KEY
    });
  } catch (error: any) {
    console.error('Error testing Benzinga API:', error);
    return NextResponse.json({ 
      error: error.message || 'Failed to test Benzinga API',
      apiKeyAvailable: !!BENZINGA_API_KEY
    }, { status: 500 });
  }
} 