import { NextResponse } from 'next/server';
import { generateSecondarySection } from '@/lib/api';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { sourceUrl, outletName, primaryText, articleText } = body;

    console.log('Secondary request body:', body);

    if (!articleText && !sourceUrl) {
      return NextResponse.json({ result: 'Please provide either articleText or sourceUrl.' });
    }

    const result = await generateSecondarySection({
      secondaryUrl: sourceUrl,   // map sourceUrl internally to secondaryUrl
      outletName,
      primaryText,
      secondaryText: articleText, // map articleText internally to secondaryText
    });

    return NextResponse.json({ result });
  } catch (error: any) {
    console.error('Error in /api/generate/secondary:', error.message);
    return NextResponse.json(
      { error: error.message || 'Unexpected error occurred' },
      { status: 500 }
    );
  }
}
