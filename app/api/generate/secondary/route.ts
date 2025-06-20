import { NextResponse } from 'next/server';
import { generateSecondarySection } from '@/lib/api';

export async function POST(req: Request) {
  try {
    const { secondaryUrl, outletName, primaryText, secondaryText } = await req.json();

    console.log('Received secondary request:', {
      secondaryUrl,
      outletName,
      primaryText,
      secondaryText,
    });

    const result = await generateSecondarySection({
      secondaryUrl,
      outletName,
      primaryText,
      secondaryText,
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
