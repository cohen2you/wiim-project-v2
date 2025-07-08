import { NextResponse } from 'next/server';

const POLYGON_API_KEY = process.env.POLYGON_API_KEY!;
const POLYGON_BASE_URL = 'https://api.polygon.io/v2/aggs/ticker';

function formatDate(date: Date) {
  return date.toISOString().split('T')[0];
}

function calcPercentChange(start: number, end: number) {
  return ((end - start) / start) * 100;
}

export async function POST(req: Request) {
  try {
    const { ticker } = await req.json();

    if (!ticker || ticker.trim() === '') {
      return NextResponse.json({ error: 'Ticker symbol is required.' }, { status: 400 });
    }

    const symbol = ticker.trim().toUpperCase();

    // Date range: last 1 year to today (limit to avoid plan restriction)
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setFullYear(toDate.getFullYear() - 1);

    const fromStr = formatDate(fromDate);
    const toStr = formatDate(toDate);

    // Fetch daily aggregated bars for the ticker
    const url = `${POLYGON_BASE_URL}/${symbol}/range/1/day/${fromStr}/${toStr}?adjusted=true&sort=desc&limit=365&apiKey=${POLYGON_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Polygon API error: ${errorText}`);
    }
    const data = await res.json();

    if (!data.results || data.results.length === 0) {
      return NextResponse.json({ error: `No price data found for ${symbol}.` }, { status: 404 });
    }

    const bars = data.results;

    // Latest bar is the most recent trading day (descending order)
    const latestBar = bars[0];
    const previousBar = bars[1];

    // Year start bar - find the bar closest to Jan 1 of this year
    const yearStartDate = new Date(new Date().getFullYear(), 0, 1);
    let yearStartBar = bars.find(bar => new Date(bar.t) >= yearStartDate);
    if (!yearStartBar) {
      // fallback to the oldest bar
      yearStartBar = bars[bars.length - 1];
    }

    const lastClose = latestBar.c;
    const prevClose = previousBar ? previousBar.c : lastClose;
    const ytdClose = yearStartBar.c;

    const dailyChangePct = calcPercentChange(prevClose, lastClose);
    const ytdChangePct = calcPercentChange(ytdClose, lastClose);

    const lastTradeDate = new Date(latestBar.t).toLocaleDateString('en-US');

    const priceActionText = `On ${lastTradeDate}, ${symbol} is priced at $${lastClose.toFixed(
      2
    )} and has ${dailyChangePct >= 0 ? 'increased' : 'decreased'} by ${Math.abs(dailyChangePct).toFixed(
      2
    )}% today. Since the start of the year, it has ${ytdChangePct >= 0 ? 'increased' : 'decreased'} by ${Math.abs(
      ytdChangePct
    ).toFixed(2)}%.`;

    return NextResponse.json({ priceAction: priceActionText });
  } catch (error: any) {
    console.error('Error in /api/generate/priceaction:', error);
    return NextResponse.json({ error: error.message || 'Unexpected error occurred' }, { status: 500 });
  }
}
