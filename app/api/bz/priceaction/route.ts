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
    if (!ticker) return NextResponse.json({ error: 'Ticker is required' }, { status: 400 });
    const url = `${BZ_PRICE_URL}?token=${BENZINGA_API_KEY}&symbols=${encodeURIComponent(ticker)}`;
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Benzinga API error: ${text}`);
    }
    const data = await res.json();
    if (!data || typeof data !== 'object') {
      return NextResponse.json({ error: 'Invalid Benzinga response' });
    }
    const quote = data[ticker.toUpperCase()];
    if (!quote || typeof quote !== 'object') {
      return NextResponse.json({ error: 'No price data found.' });
    }
    
    const symbol = quote.symbol ?? ticker.toUpperCase();
    const companyName = quote.companyStandardName || quote.name || symbol;
    const date = quote.closeDate ? new Date(quote.closeDate) : new Date();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    // Get the day of week, but if today is a weekend, use Friday as the last trading day
    const today = new Date();
    const currentDay = today.getDay();
    let dayOfWeek: string;
    if (currentDay === 0) { // Sunday
      dayOfWeek = 'Friday';
    } else if (currentDay === 6) { // Saturday
      dayOfWeek = 'Friday';
    } else {
      // Use the date from the quote if available, otherwise use today
      dayOfWeek = dayNames[date.getDay()];
    }
    
    const marketStatus = getMarketStatus();
    
    // Regular session data
    const regularChangePercent = typeof quote.changePercent === 'number' ? quote.changePercent : 0;
    const regularLastPrice = formatPrice(quote.lastTradePrice);
    const regularUpDown = regularChangePercent > 0 ? 'up' : regularChangePercent < 0 ? 'down' : 'unchanged';
    const regularAbsChange = Math.abs(regularChangePercent).toFixed(2);
    
    // Extended hours data
    const hasExtendedHours = quote.extendedHoursPrice && quote.extendedHoursChangePercent;
    const extChangePercent = hasExtendedHours ? (typeof quote.extendedHoursChangePercent === 'number' ? quote.extendedHoursChangePercent : 0) : 0;
    const extLastPrice = hasExtendedHours ? formatPrice(quote.extendedHoursPrice) : null;
    const extUpDown = extChangePercent > 0 ? 'up' : extChangePercent < 0 ? 'down' : 'unchanged';
    const extAbsChange = Math.abs(extChangePercent).toFixed(2);
    
    let priceActionText = '';
    
    if (marketStatus === 'open') {
      priceActionText = `<strong>${symbol} Price Action:</strong> ${companyName} shares were ${regularUpDown} ${regularAbsChange}% at $${regularLastPrice} during regular trading hours on ${dayOfWeek}, according to Benzinga Pro.`;
    } else if (marketStatus === 'premarket') {
      if (hasExtendedHours) {
        priceActionText = `<strong>${symbol} Price Action:</strong> ${companyName} shares were ${extUpDown} ${extAbsChange}% at $${extLastPrice} during premarket trading on ${dayOfWeek}, according to Benzinga Pro.`;
      } else {
        priceActionText = `<strong>${symbol} Price Action:</strong> ${companyName} shares were trading during premarket hours on ${dayOfWeek}, according to Benzinga Pro.`;
      }
    } else if (marketStatus === 'afterhours') {
      if (hasExtendedHours) {
        // Show both regular session and after-hours changes
        const regularVerb = regularChangePercent > 0 ? 'rose' : regularChangePercent < 0 ? 'fell' : 'were unchanged';
        const extVerb = extChangePercent > 0 ? 'up' : extChangePercent < 0 ? 'down' : 'unchanged';
        
        priceActionText = `<strong>${symbol} Price Action:</strong> ${companyName} shares ${regularVerb} ${regularAbsChange}% to $${regularLastPrice} during regular trading hours, and were ${extVerb} ${extAbsChange}% at $${extLastPrice} during after-hours trading on ${dayOfWeek}, according to Benzinga Pro.`;
      } else {
        // Fallback to regular session data
        const regularVerb = regularChangePercent > 0 ? 'rose' : regularChangePercent < 0 ? 'fell' : 'were unchanged';
        priceActionText = `<strong>${symbol} Price Action:</strong> ${companyName} shares ${regularVerb} ${regularAbsChange}% to $${regularLastPrice} during regular trading hours on ${dayOfWeek}, according to Benzinga Pro.`;
      }
    } else {
      // Market is closed
      const regularVerb = regularChangePercent > 0 ? 'rose' : regularChangePercent < 0 ? 'fell' : 'were unchanged';
      priceActionText = `<strong>${symbol} Price Action:</strong> ${companyName} shares ${regularVerb} ${regularAbsChange}% to $${regularLastPrice} during regular trading hours on ${dayOfWeek}, according to Benzinga Pro.`;
    }
    
    return NextResponse.json({ priceAction: priceActionText });
  } catch (error: any) {
    console.error('Error generating price action:', error);
    return NextResponse.json({ error: error.message || 'Failed to generate price action.' }, { status: 500 });
  }
} 