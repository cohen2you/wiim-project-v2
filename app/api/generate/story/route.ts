import { NextResponse } from 'next/server';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o';

function buildPrompt({ ticker, sourceText, analystSummary, priceSummary }: { ticker: string; sourceText: string; analystSummary: string; priceSummary: string }) {
  return `You are a professional financial news writer for Benzinga.

Write a concise, fact-based news article (about 350 words) about the stock with ticker: ${ticker}. Use the provided press release or news article text as your main source, but focus only on information relevant to ${ticker}. Ignore other tickers or companies mentioned in the source text.

Structure your article as follows:
- Headline: Write a clear, engaging headline in the style of these examples:
  - C3 AI Stock Is Tumbling Thursday: What's Going On?
  - What's Going On With Oklo Stock?
- First paragraph: Start with a sentence noting the price movement of the stock, using the full company name and ticker in this format: **Nvidia Corp. (NASDAQ: NVDA)**. The company name should be in bold. Then state what happened and why it matters for ${ticker}.
- Additional paragraphs: Provide factual details, context, and any relevant quotes about ${ticker}.
- Final paragraph: Briefly summarize recent analyst ratings for ${ticker}, using the provided data.
- At the very bottom, include the following price action summary for ${ticker} exactly as provided, without changing the wording or format:
${priceSummary}

Keep the tone neutral and informative, suitable for a financial news audience. Do not include speculation or personal opinion.

Source Text:
${sourceText}

Analyst Ratings Summary:
${analystSummary}

Write the article now.`;
}

export async function POST(req: Request) {
  try {
    const { ticker, sourceText, analystSummary, priceSummary } = await req.json();
    if (!ticker || !sourceText) return NextResponse.json({ error: 'Ticker and source text are required.' }, { status: 400 });
    console.log('Prompt priceSummary:', priceSummary); // Log the priceSummary
    const prompt = buildPrompt({ ticker, sourceText, analystSummary: analystSummary || '', priceSummary: priceSummary || '' });
    const res = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.5,
        max_tokens: 900,
      }),
    });
    if (!res.ok) {
      const raw = await res.text();
      return NextResponse.json({ error: `OpenAI error: ${raw}` }, { status: 500 });
    }
    const data = await res.json();
    const story = data.choices[0].message.content.trim();
    return NextResponse.json({ story });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to generate story.' }, { status: 500 });
  }
} 