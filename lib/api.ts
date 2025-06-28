const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o';

async function callOpenAI(prompt: string) {
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
      max_tokens: 4000,  // Increased max tokens for longer completions
    }),
  });

  if (!res.ok) {
    const raw = await res.text();
    console.error('OpenAI raw error:', raw);
    throw new Error(`OpenAI failed with status ${res.status}`);
  }

  const data = await res.json();
  return data.choices[0].message.content.trim();
}

export async function generatePrimaryArticle({
  sourceUrl,
  ticker,
  articleText,
}: {
  sourceUrl: string;
  ticker?: string;
  articleText: string;
}) {
  const { getPrimaryPrompt } = await import('./prompts/primary');
  const prompt = getPrimaryPrompt.prompt({ sourceUrl, ticker: ticker || '', articleText });
  return await callOpenAI(prompt);
}

export async function generateSecondarySection({
  secondaryUrl,
  outletName,
  primaryText,
  secondaryText,
}: {
  secondaryUrl: string;
  outletName: string;
  primaryText: string;
  secondaryText: string;
}) {
  const { getSecondaryPrompt } = await import('./prompts/secondary');
  const prompt = getSecondaryPrompt.prompt({
    secondaryUrl,
    outletName,
    primaryText,
    secondaryText,
  });
  return await callOpenAI(prompt);
}

export async function generateFinalStory({
  lead,
  whatHappened,
  whyItMatters,
  priceAction,
}: {
  lead: string;
  whatHappened: string;
  whyItMatters: string;
  priceAction: string;
}) {
  const { getFinalAssemblyPrompt } = await import('./prompts/final');
  const prompt = getFinalAssemblyPrompt.prompt({
    lead,
    whatHappened,
    whyItMatters,
    priceAction,
  });
  return await callOpenAI(prompt);
}
