import { NextResponse } from 'next/server';
import { getPrimaryPrompt } from '@/lib/prompts/primary';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o';

// Helper to call OpenAI Chat Completion API
async function callOpenAI(prompt: string) {
  const res = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
      max_tokens: 800,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('OpenAI error:', text);
    throw new Error(`OpenAI API error: ${res.status}`);
  }

  const data = await res.json();
  return data.choices[0].message.content.trim();
}

export async function POST(req: Request) {
  try {
    const { sourceUrl, articleText, ticker } = await req.json();

    if (!sourceUrl && !articleText) {
      return NextResponse.json({ error: 'Missing sourceUrl or articleText' }, { status: 400 });
    }

    // Use the proper prompt with hyperlink requirements
    const prompt = getPrimaryPrompt.prompt({
      sourceUrl: sourceUrl || '',
      ticker: ticker || '',
      articleText: articleText || '',
    });

    const generatedText = await callOpenAI(prompt);

    return NextResponse.json({ result: generatedText });
  } catch (error: any) {
    console.error('Error in /api/generate/primary:', error);
    return NextResponse.json({ error: error.message || 'Unexpected error' }, { status: 500 });
  }
}
