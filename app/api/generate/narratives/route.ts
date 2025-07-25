import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { storyText } = await req.json();

    if (!storyText || storyText.trim() === '') {
      return NextResponse.json({ error: 'storyText is required' }, { status: 400 });
    }

    const prompt = `You are a skilled financial editor. Given the following news story, provide three distinct narrative options that go beyond just reporting the facts. Each narrative should offer a unique angle or perspective for a deeper story.

Story:
${storyText}

Provide the three narrative options as a numbered list, each a single sentence or short paragraph.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 300,
    });

    // Extract the text output
    const rawOutput = completion.choices[0].message.content;

    // Parse the numbered list into an array of strings
    // Simple parsing: split by lines, filter lines that start with 1. 2. 3.
    const lines = (rawOutput ?? '').split('\n').map(line => line.trim());
    const options: string[] = [];
    for (const line of lines) {
      const match = line.match(/^\d+\.\s*(.*)/);
      if (match && match[1]) {
        options.push(match[1].trim());
      }
    }

    if (options.length === 0) {
      // fallback: if parsing fails, just send whole raw text as one option
      options.push(rawOutput ?? '');
    }

    return NextResponse.json({ options });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Unexpected error occurred' },
      { status: 500 }
    );
  }
}
