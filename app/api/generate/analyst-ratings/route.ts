import { NextResponse } from 'next/server';

interface AnalystRating {
  ticker: string;
  analyst: string;
  action_company: string;
  action_pt?: string;
  rating_current: string;
  rating_prior?: string;
  date: string;
  pt_current?: string;
  pt_prior?: string;
}

async function fetchAnalystRatings(ticker: string): Promise<AnalystRating[]> {
  const url = 'https://api.benzinga.com/api/v2.1/calendar/ratings' +
    `?token=${process.env.BENZINGA_API_KEY}` +
    `&parameters[tickers]=${encodeURIComponent(ticker)}` +
    `&parameters[range]=6m`;

  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Benzinga API error ${res.status} ${res.statusText}: ${body || '<no body>'}`
    );
  }

  const raw = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    throw new Error('Invalid JSON from Benzinga');
  }

  const ratingsArray: AnalystRating[] = Array.isArray(parsed)
    ? (parsed as AnalystRating[])
    : ((parsed as { ratings?: AnalystRating[] }).ratings ?? []);

  return ratingsArray;
}

function formatRatingsBlock(ratings: AnalystRating[]): string {
  return ratings
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, 5)
    .map(r => {
      // Extract just the firm name, removing any analyst name if present
      const firmName = r.action_company.split(' - ')[0].split(':')[0].trim();
      let line = `${firmName} maintains ${r.rating_current} rating`;
      if (r.pt_current) {
        line += ` with $${parseFloat(r.pt_current).toFixed(0)} price target`;
      }
      return line;
    })
    .join(', ');
}

export async function POST(request: Request) {
  try {
    const { ticker } = (await request.json()) as { ticker?: string };
    const symbol = (ticker ?? '').trim().toUpperCase();
    if (!symbol) {
      return NextResponse.json({ ratings: [], error: 'Ticker parameter is required.' }, { status: 400 });
    }

    const ratings = await fetchAnalystRatings(symbol);
    if (ratings.length === 0) {
      return NextResponse.json({ ratings: [], error: `No recent analyst ratings found for ${symbol}.` });
    }

    const block = formatRatingsBlock(ratings);
    return NextResponse.json({ ratings: [block] });
  } catch (err: unknown) {
    console.error('Error in /api/generate/analyst-ratings:', err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ratings: [], error: message },
      { status: 500 }
    );
  }
}