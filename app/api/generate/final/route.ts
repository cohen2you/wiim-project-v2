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

    // Add hyperlinks if URLs are provided
    if (primaryUrl || secondaryUrl) {
      try {
        const hyperlinkRes = await fetch(`${req.headers.get('origin') || 'http://localhost:3000'}/api/add-hyperlinks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: result,
            primaryUrl,
            secondaryUrl,
            primaryOutlet,
          }),
        });

        if (hyperlinkRes.ok) {
          const hyperlinkData = await hyperlinkRes.json();
          return NextResponse.json({ result: hyperlinkData.result });
        }
      } catch (hyperlinkError) {
        console.error('Error adding hyperlinks:', hyperlinkError);
        // Continue without hyperlinks if there's an error
      }
    }

    return NextResponse.json({ result });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Unexpected error occurred' },
      { status: 500 }
    );
  }
}
