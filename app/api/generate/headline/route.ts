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
- No bold formatting
- No extra text
- Just the headline
- Use the company name, not just the ticker

Generate the headline:`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 50,
      temperature: 0.3,
    });

    const headline = completion.choices[0].message?.content?.trim() || '';

    if (!headline) {
      return NextResponse.json({ error: 'Failed to generate headline.' }, { status: 500 });
    }

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