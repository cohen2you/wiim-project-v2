import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function getCurrentDayName(): string {
  // Get current day name in New York timezone
  const now = new Date();
  const nyTime = new Date(now.toLocaleString("en-US", {timeZone: "America/New_York"}));
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[nyTime.getDay()];
}

export async function POST(request: Request) {
  try {
    const { ticker } = await request.json();
    
    if (!ticker) {
      return NextResponse.json({ error: 'Ticker is required.' }, { status: 400 });
    }

    const currentDayName = getCurrentDayName();

    const prompt = `
Generate ONLY a headline for ${ticker} stock.

Format: "[Company] Stock Is Trending ${currentDayName}: What's Going On?"

Rules:
- NO bold formatting (**text**) - remove any ** symbols
- NO markdown formatting
- NO extra text or punctuation
- Just the plain headline text
- Use the company name, not just the ticker
- DO NOT include ** around the headline
- DO NOT include any formatting symbols

Generate the headline:`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 50,
      temperature: 0.3,
    });

    let headline = completion.choices[0].message?.content?.trim() || '';

    if (!headline) {
      return NextResponse.json({ error: 'Failed to generate headline.' }, { status: 500 });
    }

    // Remove any ** formatting that might have been added
    headline = headline.replace(/\*\*/g, '');

    console.log(`Generated headline for ${ticker}: ${headline}`);

    return NextResponse.json({ 
      headline,
      step: 1
    });
  } catch (error: any) {
    console.error('Error generating headline:', error);
    return NextResponse.json({ error: error.message || 'Failed to generate headline.' }, { status: 500 });
  }
} 