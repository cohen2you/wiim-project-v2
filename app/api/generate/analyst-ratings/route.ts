import { NextResponse } from 'next/server';

interface AnalystRating {
  analystFirm: string;
  ratingAction: string;
  ratingCurrent: string;
  ratingPrior: string;
  priceTargetCurrent?: number;
  priceTargetPrior?: number;
  ticker: string;
  companyName?: string;
  researchDate: string;
}

export async function POST(request: Request) {
  try {
    const { ticker } = await request.json();

    if (!ticker || typeof ticker !== 'string' || !ticker.trim()) {
      return NextResponse.json({ ratings: [], error: 'Ticker is required.' });
    }

    const url = `https://api.benzinga.com/api/v1/analyst-ratings?symbols=${ticker.trim().toUpperCase()}&token=${process.env.BENZINGA_API_KEY}`;

    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Benzinga API error: ${text}`);
    }

    const data: AnalystRating[] = await res.json();

    if (!Array.isArray(data)) {
      return NextResponse.json({ ratings: [], error: 'Invalid response format' });
    }

    // Format the ratings into readable summaries
    const ratings = data.slice(0, 10).map((item) => {
      const firm = item.analystFirm;
      const action = item.ratingAction;
      const curr = item.ratingCurrent;
      const prior = item.ratingPrior;
      const priceFrom = item.priceTargetPrior !== undefined ? `$${item.priceTargetPrior}` : null;
      const priceTo = item.priceTargetCurrent !== undefined ? `$${item.priceTargetCurrent}` : null;
      const company = item.companyName ?? item.ticker;
      const date = new Date(item.researchDate).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });

      let summary = `${firm} ${action.toLowerCase()} ${company}`;
      if (prior && curr) summary += ` from ${prior} to ${curr}`;
      if (priceFrom && priceTo) summary += `, raising target from ${priceFrom} to ${priceTo}`;
      summary += ` on ${date}.`;

      return summary;
    });

    return NextResponse.json({ ratings });
  } catch (error) {
    console.error('Error fetching analyst ratings:', error);
    return NextResponse.json(
      { ratings: [], error: 'Failed to fetch analyst ratings.' },
      { status: 500 }
    );
  }
}