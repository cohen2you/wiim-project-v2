// app/api/generate/final/route.ts

import { NextResponse } from 'next/server';
import { generateFinalStory } from '@/lib/api';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    console.log('Final API received body:', body);

    const result = await generateFinalStory({
      lead: body.leadAndWhatHappened,
      whatHappened: '', // if your function needs it separately, else omit or parse it
      whyItMatters: body.whyItMatters,
    });

    return NextResponse.json({ output: result });
  } catch (error: any) {
    console.error('Error in /api/generate/final:', error);
    return NextResponse.json(
      { error: error.message || 'Unexpected error occurred' },
      { status: 500 }
    );
  }
}
