import { NextResponse } from 'next/server';

const BENZINGA_API_KEY = process.env.BENZINGA_API_KEY!;
const BZ_PRICE_URL = 'https://api.benzinga.com/api/v2/quoteDelayed';

function formatPrice(val: number | undefined): string {
  return typeof val === 'number' ? (Math.trunc(val * 100) / 100).toFixed(2) : 'N/A';
}

function getMarketStatus(): 'open' | 'premarket' | 'afterhours' | 'closed' {
  const now = new Date();
  const nowUtc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const nyOffset = -4; // EDT
  const nyTime = new Date(nowUtc + (3600000 * nyOffset));
  const day = nyTime.getDay();
  const hour = nyTime.getHours();
  const minute = nyTime.getMinutes();
  const time = hour * 100 + minute;
  if (day === 0 || day === 6) return 'closed';
  if (time >= 400 && time < 930) return 'premarket';
  if (time >= 930 && time < 1600) return 'open';
  if (time >= 1600 && time < 2000) return 'afterhours';
  return 'closed';
}

export async function POST(req: Request) {
  try {
    const { ticker } = await req.json();
    console.log('Price action request for ticker:', ticker); // Log the ticker
    if (!ticker) return NextResponse.json({ error: 'Ticker is required' }, { status: 400 });
    const url = `${BZ_PRICE_URL}?token=${BENZINGA_API_KEY}&symbols=${encodeURIComponent(ticker)}`;
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      console.error('Benzinga API error response:', text);
      throw new Error(`Benzinga API error: ${text}`);
    }
    const data = await res.json();
    console.log('Raw Benzinga API data:', data); // Log the raw API data
    if (!data || typeof data !== 'object') {
      return NextResponse.json({ error: 'Invalid Benzinga response' });
    }
    const quote = data[ticker.toUpperCase()];
    if (!quote || typeof quote !== 'object') {
      return NextResponse.json({ error: 'No price data found.' });
    }
    const symbol = quote.symbol ?? ticker.toUpperCase();
    const companyName = quote.companyStandardName || quote.name || symbol;
    const changePercent = typeof quote.changePercent === 'number' ? quote.changePercent : 0;
    const lastPrice = formatPrice(quote.lastTradePrice);
    const upDown = changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : 'unchanged';
    const absChange = Math.abs(changePercent).toFixed(2);
    const date = quote.closeDate ? new Date(quote.closeDate) : new Date();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayOfWeek = dayNames[date.getDay()];
    const marketStatus = getMarketStatus();
    let marketStatusPhrase = '';
    if (marketStatus === 'premarket') {
      marketStatusPhrase = ' during premarket trading';
    } else if (marketStatus === 'afterhours') {
      marketStatusPhrase = ' during after-hours trading';
    } else if (marketStatus === 'closed') {
      marketStatusPhrase = ' while the market was closed';
    }
    let priceActionText = `${symbol} Price Action: ${companyName} shares were ${upDown} ${absChange}% at $${lastPrice}${marketStatusPhrase} on ${dayOfWeek}, according to Benzinga Pro.`;
    return NextResponse.json({ priceAction: priceActionText });
  } catch (error: any) {
    console.error('Error generating price action:', error);
    return NextResponse.json({ error: error.message || 'Failed to generate price action.' }, { status: 500 });
  }
} 