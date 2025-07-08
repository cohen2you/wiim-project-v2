import { NextResponse } from 'next/server';
import { generateFinalStory } from '@/lib/api';

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const {
      lead,
      whatHappened,
      whyItMatters,
      priceAction,
      primaryUrl,
      secondaryUrl,
      primaryOutlet,
      secondaryOutlet,
    } = body;

    if (!lead || !whatHappened || !whyItMatters) {
      return NextResponse.json(
        { error: 'Missing required fields: lead, whatHappened, whyItMatters.' },
        { status: 400 }
      );
    }

    // Generate the story without embedding hyperlinks (just raw text)
    const result = await generateFinalStory({
      lead,
      whatHappened,
      whyItMatters,
      priceAction: priceAction || '',
      primaryOutlet: primaryOutlet || '',
      secondaryOutlet: secondaryOutlet || '',
    });

    return NextResponse.json({ result });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Unexpected error occurred' },
      { status: 500 }
    );
  }
}
