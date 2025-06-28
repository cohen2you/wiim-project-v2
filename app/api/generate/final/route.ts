import { NextResponse } from 'next/server';
import { generateFinalStory } from '@/lib/api';

export async function POST(req: Request) {
  try {
    const body = await req.json();

    console.log('Final API received body:', body);

    const { lead, whatHappened, whyItMatters, priceAction } = body;

    if (!lead || !whatHappened || !whyItMatters) {
      console.warn('Missing required fields in final generation:', { lead, whatHappened, whyItMatters });
      return NextResponse.json(
        { error: 'Missing required fields: lead, whatHappened, whyItMatters.' },
        { status: 400 }
      );
    }

    const result = await generateFinalStory({
      lead,
      whatHappened,
      whyItMatters,
      priceAction: priceAction || '',
    });

    console.log('Final generation result:', result);

    return NextResponse.json({ result });
  } catch (error: any) {
    console.error('Error in /api/generate/final:', error);
    return NextResponse.json(
      { error: error.message || 'Unexpected error occurred' },
      { status: 500 }
    );
  }
}
