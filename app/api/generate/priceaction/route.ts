import { NextResponse } from 'next/server';

const POLYGON_API_KEY = process.env.POLYGON_API_KEY!;

async function fetchAggData(ticker: string, from: string, to: string) {
  const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}?adjusted=true&sort=asc&apiKey=${POLYGON_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Polygon API error: ${text}`);
  }
  const data = await res.json();
  if (!data.results || data.results.length === 0) {
    throw new Error(`No price data found for ${ticker} between ${from} and ${to}`);
  }
  return data.results;
}

function calcPercentChange(data: any[]) {
  if (data.length < 2) return 0;
  const firstClose = data[0].c;
  const lastClose = data[data.length - 1].c;
  return ((lastClose - firstClose) / firstClose) * 100;
}

function formatDate(date: Date) {
  return date.toISOString().split('T')[0];
}

function getWeekdayName(date: Date) {
  return date.toLocaleDateString('en-US', { weekday: 'long' });
}

function getPreviousTradingDay(date: Date): Date {
  const prevDate = new Date(date);
  do {
    prevDate.setDate(prevDate.getDate() - 1);
    const day = prevDate.getDay(); // Sunday=0, Saturday=6
    if (day !== 0 && day !== 6) break;
  } while (true);
  return prevDate;
}

function getETDate() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = formatter.formatToParts(now);
  const dateParts: Record<string, string> = {};
  parts.forEach(({ type, value }) => {
    dateParts[type] = value;
  });
  return new Date(
    `${dateParts.year}-${dateParts.month}-${dateParts.day}T${dateParts.hour}:${dateParts.minute}:${dateParts.second}`
  );
}

function isMarketOpen(etDate: Date): boolean {
  const day = etDate.getDay(); // Sunday=0 .. Saturday=6
  const hour = etDate.getHours();
  const minutes = etDate.getMinutes();

  // Market open Mon-Fri 9:30am - 4:00pm ET
  if (day < 1 || day > 5) return false;

  if (hour < 9) return false;
  if (hour > 16) return false;
  if (hour === 9 && minutes < 30) return false;

  return hour < 16 || (hour === 16 && minutes === 0);
}

function formatChange(percent: number) {
  const absVal = Math.abs(percent).toFixed(2);
  if (percent > 0) return `increased by ${absVal}%`;
  if (percent < 0) return `decreased by ${absVal}%`;
  return 'remained unchanged';
}

export async function POST(req: Request) {
  try {
    const { ticker } = await req.json();

    if (!ticker || ticker.trim() === '') {
      return NextResponse.json({ error: 'Ticker symbol is required.' }, { status: 400 });
    }

    const upperTicker = ticker.trim().toUpperCase();

    const etNow = getETDate();
    const marketIsOpen = isMarketOpen(etNow);

    // Use current day as headline day regardless of market open or close
    const mostRecentClose = etNow;
    const mostRecentCloseStr = formatDate(mostRecentClose);

    // Previous trading day for "since yesterday" comparison
    const yesterday = getPreviousTradingDay(mostRecentClose);
    const yesterdayName = getWeekdayName(yesterday);

    const oneYearAgo = new Date(mostRecentClose);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const oneYearAgoStr = formatDate(oneYearAgo);

    const aggData = await fetchAggData(upperTicker, oneYearAgoStr, mostRecentCloseStr);

    const TRADING_DAYS_IN_MONTH = 21;
    const TRADING_DAYS_IN_YEAR = 252;

    const dayChange = calcPercentChange(aggData.slice(-2));
    const monthChange = calcPercentChange(aggData.slice(-TRADING_DAYS_IN_MONTH));
    const yearChange = calcPercentChange(aggData.slice(-TRADING_DAYS_IN_YEAR));

    const spyData = await fetchAggData('SPY', oneYearAgoStr, mostRecentCloseStr);
    const spyYearChange = calcPercentChange(spyData.slice(-TRADING_DAYS_IN_YEAR));

    const latestClose = aggData[aggData.length - 1].c;

    const todayName = getWeekdayName(mostRecentClose);

    const priceActionText = marketIsOpen
      ? `On ${todayName}, ${upperTicker} was last priced at $${latestClose.toFixed(
          2
        )}. Since ${yesterdayName}, its price has ${formatChange(dayChange)}. Compared to one month ago, the stock has ${formatChange(
          monthChange
        )}. Over the last year, it has ${formatChange(yearChange)}. For context, the S&P 500 (tracked by SPY) has ${formatChange(
          spyYearChange
        )} during the same period.`
      : `On ${todayName}, ${upperTicker} closed at $${latestClose.toFixed(
          2
        )}. Since ${yesterdayName}, its price has ${formatChange(dayChange)}. Compared to one month ago, the stock has ${formatChange(
          monthChange
        )}. Over the last year, it has ${formatChange(yearChange)}. For context, the S&P 500 (tracked by SPY) has ${formatChange(
          spyYearChange
        )} during the same period.`;

    return NextResponse.json({ priceAction: priceActionText });
  } catch (error: any) {
    console.error('Error in /api/generate/priceaction:', error);
    return NextResponse.json({ error: error.message || 'Unexpected error occurred' }, { status: 500 });
  }
}
