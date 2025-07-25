import { NextResponse } from 'next/server';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o';

function buildPrompt({ ticker, sourceText, analystSummary, priceSummary, priceActionDay, sourceUrl, sourceDateFormatted }: { ticker: string; sourceText: string; analystSummary: string; priceSummary: string; priceActionDay?: string; sourceUrl?: string; sourceDateFormatted?: string }) {
  return `You are a professional financial news writer for Benzinga.

Write a concise, fact-based news article (about 350 words) about the stock with ticker: ${ticker}. Use the provided press release or news article text as your main source, but focus only on information relevant to ${ticker}. Ignore other tickers or companies mentioned in the source text.

CRITICAL FORMATTING RULES:
- NO paragraph should be longer than 2 sentences
- Break up any long paragraphs into multiple shorter ones
- The hyperlink MUST appear in the lead paragraph
- Use HTML tags for formatting, not markdown

Structure your article as follows:
- Headline: Write a clear, engaging headline in the style of these examples (do not use bold, asterisks, or markdown headings such as # or ##; the headline should be plain text only):
  - C3 AI Stock Is Tumbling Thursday: What's Going On?
  - What's Going On With Oklo Stock?

- Lead paragraph: Start with a sentence describing the price movement of the stock (e.g., "rose modestly," "traded higher," "slipped," "declined," etc.) using the full company name and ticker in this format: <strong>Company Name</strong> (NYSE: TICKER). The company name should be bolded using HTML <strong> tags. Do not use markdown bold (**) or asterisks elsewhere. Do not include the specific price or percentage in the lead; reserve that for the price action line at the bottom. Then state what happened and why it matters for ${ticker}. 

CRITICAL: In the lead paragraph, you MUST wrap exactly three consecutive existing words in a hyperlink using <a href="${sourceUrl}"> and </a> tags. Choose any three consecutive words from the existing text that fit naturally in the sentence. IMPORTANT: Do not add any new words, do not insert placeholder text, and do not use any example words in your output.

CRITICAL: The lead paragraph must be exactly 2 sentences maximum. If you have more information, create additional paragraphs.

- IMPORTANT: In your lead, use this exact phrase to reference the timing of the price movement: "${priceActionDay || '[Day not provided]'}". Do not use or infer any other day or date, even if the source text or PR/article date mentions a different day.

- Additional paragraphs: Provide factual details, context, and any relevant quotes about ${ticker}. When referencing the source material, mention the actual date: "${sourceDateFormatted || '[Date not provided]'}" (e.g., "In a press release dated ${sourceDateFormatted}" or "According to the ${sourceDateFormatted} announcement"). CRITICAL: Each paragraph must be no longer than 2 sentences. If you have more information, create additional paragraphs.

- Analyst Ratings: Briefly summarize recent analyst ratings for ${ticker} in two concise paragraphs: the first paragraph should highlight the overall trend or sentiment, and the second paragraph should list the most recent analyst actions in a reader-friendly flow. Use the provided data. Each paragraph must be no longer than 2 sentences.

- At the very bottom, include the following price action summary for ${ticker} exactly as provided, but with these modifications:
  - Bold the ticker and "Price Action:" part using HTML <strong> tags (e.g., <strong>AA Price Action:</strong>)
  - Hyperlink "according to Benzinga Pro." to https://pro.benzinga.com/ using <a href="https://pro.benzinga.com/">according to Benzinga Pro.</a>
${priceSummary}

Keep the tone neutral and informative, suitable for a financial news audience. Do not include speculation or personal opinion. 

REMEMBER: NO paragraph should exceed 2 sentences. Break up longer content into multiple paragraphs. The hyperlink MUST appear in the lead paragraph.

Source Text:
${sourceText}

Analyst Ratings Summary:
${analystSummary}

Write the article now.`;
}

export async function POST(req: Request) {
  try {
    const { ticker, sourceText, analystSummary, priceSummary, priceActionDay, sourceUrl, sourceDateFormatted } = await req.json();
    if (!ticker || !sourceText) return NextResponse.json({ error: 'Ticker and source text are required.' }, { status: 400 });
    console.log('Prompt priceSummary:', priceSummary); // Log the priceSummary
    const prompt = buildPrompt({ ticker, sourceText, analystSummary: analystSummary || '', priceSummary: priceSummary || '', priceActionDay, sourceUrl, sourceDateFormatted });
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