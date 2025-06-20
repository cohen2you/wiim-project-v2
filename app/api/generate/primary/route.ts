// app/api/generate/primary/route.ts

import { NextResponse } from 'next/server';
import { generatePrimaryArticle } from '@/lib/api';

export async function POST(req: Request) {
  try {
    const { sourceUrl, ticker, articleText } = await req.json();

    console.log('Received request:', { sourceUrl, ticker, length: articleText?.length });

    const result = await generatePrimaryArticle({
      sourceUrl,
      ticker,
      articleText,
    });

    return NextResponse.json({ result });
  } catch (error: any) {
    console.error('Error in /api/generate/primary:', error);
    return NextResponse.json(
      { error: error.message || 'Unexpected error occurred' },
      { status: 500 }
    );
  }
}
