import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(request: Request) {
  try {
    const { articleText, style } = await request.json();

    if (!articleText?.trim()) {
      return NextResponse.json({ lead: '', error: 'Article text is required.' });
    }

    // Sanitize style input and set defaults
    const styleOptions = ['longer', 'shorter', 'more narrative', 'more context'];
    const chosenStyle = styleOptions.includes(style?.toLowerCase()) ? style.toLowerCase() : 'normal';

    const prompt = `
You are a professional financial journalist writing for a high-traffic news site.

Based on the article below, generate a lead paragraph that is ${chosenStyle} in length and tone.

Article:
${articleText}

Lead paragraph:
`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 250,
      temperature: 0.7,
    });

    const lead = completion.choices?.[0]?.message?.content?.trim() || '';

    return NextResponse.json({ lead });
  } catch (error) {
    console.error('Error generating lead:', error);
    return NextResponse.json({ lead: '', error: 'Failed to generate lead paragraph.' }, { status: 500 });
  }
}
