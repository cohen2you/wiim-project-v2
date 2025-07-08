import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { finalStory, narrativeOption } = await req.json();

    if (!finalStory || finalStory.trim() === '') {
      return NextResponse.json({ error: 'finalStory is required' }, { status: 400 });
    }
    if (!narrativeOption || narrativeOption.trim() === '') {
      return NextResponse.json({ error: 'narrativeOption is required' }, { status: 400 });
    }

    const prompt = `You are an expert financial journalist. Using the original news story below and the chosen narrative option, write a 300-400 word narrative story that expands on the news with insightful analysis, storytelling, and context.

Original News Story:
${finalStory}

Chosen Narrative Option:
${narrativeOption}

Narrative Story:
`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.75,
      max_tokens: 700,
    });

    const narrative = completion.choices[0].message.content;

    return NextResponse.json({ narrative });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Unexpected error occurred' },
      { status: 500 }
    );
  }
}
