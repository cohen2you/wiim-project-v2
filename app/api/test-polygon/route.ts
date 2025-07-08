import { NextResponse } from 'next/server';

const POLYGON_API_KEY = process.env.POLYGON_API_KEY!;
const POLYGON_BASE_URL = 'https://api.polygon.io/v2/aggs/ticker';

export async function GET(req: Request) {
  try {
    const symbol = 'AAPL'; // Test ticker

    const url = `${POLYGON_BASE_URL}/${symbol}/range/1/day/2024-01-01/2025-06-30?adjusted=true&sort=desc&limit=5&apiKey=${POLYGON_API_KEY}`;

    const res = await fetch(url);
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Polygon API error: ${errorText}`);
    }

    const data = await res.json();

    return NextResponse.json({ data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unexpected error' }, { status: 500 });
  }
}
