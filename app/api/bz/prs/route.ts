import { NextResponse } from 'next/server';

const BENZINGA_API_KEY = process.env.BENZINGA_API_KEY!;
const BENZINGA_PR_API_KEY = process.env.BENZINGA_PR_API_KEY || BENZINGA_API_KEY;
const BZ_NEWS_URL = 'https://api.benzinga.com/api/v2/news';

function get7DaysAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

export async function POST(req: Request) {
  try {
    const { ticker } = await req.json();
    if (!ticker) return NextResponse.json({ error: 'Ticker is required' }, { status: 400 });

    const dateFrom = get7DaysAgo();
    const url = `${BZ_NEWS_URL}?token=${BENZINGA_PR_API_KEY}&tickers=${encodeURIComponent(ticker)}&channels=press-releases&items=10&fields=headline,title,created,body,teaser,id,url,channels&accept=application/json&displayOutput=full&dateFrom=${dateFrom}`;
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
    });
    const text = await res.text();
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
    // Robust filter for PR channel names
    const prChannelNames = ['press releases', 'press-releases', 'pressrelease', 'pr'];
    const normalize = (str: string) => str.toLowerCase().replace(/[-_]/g, ' ');
    const prs = data
      .filter(item =>
        Array.isArray(item.channels) &&
        item.channels.some(
          (ch: any) =>
            typeof ch.name === 'string' &&
            prChannelNames.includes(normalize(ch.name))
        )
      )
      .map((item: any) => ({
        id: item.id,
        headline: item.headline || item.title || '[No Headline]',
        created: item.created,
        body: item.body || item.teaser || '[No body text]',
        url: item.url || '',
      }));
    prs.sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());
    return NextResponse.json({ prs });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to fetch PRs' }, { status: 500 });
  }
} 