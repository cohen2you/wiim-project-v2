import { getFinalAssemblyPrompt } from './prompts/final';
import { getSecondaryPrompt } from './prompts/secondary';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o';

async function callOpenAI(prompt: string) {
  if (!OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY not set!');
    throw new Error('Missing OpenAI API key');
  }

  console.log('Calling OpenAI with prompt:', prompt.substring(0, 200));

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
      max_tokens: 800,
    }),
  });

  if (!res.ok) {
    const raw = await res.text();
    console.error('OpenAI raw error:', raw);
    throw new Error(`OpenAI failed with status ${res.status}`);
  }

  const data = await res.json();
  console.log('OpenAI response received');
  return data.choices[0].message.content.trim();
}

export async function generateFinalStory({
  lead,
  whatHappened,
  whyItMatters,
  priceAction,
  primaryOutlet,
  secondaryOutlet,
}: {
  lead: string;
  whatHappened: string;
  whyItMatters: string;
  priceAction: string;
  primaryOutlet: string;
  secondaryOutlet: string;
}) {
  const prompt = getFinalAssemblyPrompt.prompt({
    lead,
    whatHappened,
    whyItMatters,
    priceAction,
    primaryOutlet,
    secondaryOutlet,
  });
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
  const prompt = getSecondaryPrompt.prompt({
    secondaryUrl,
    outletName,
    primaryText,
    secondaryText,
  });
  return await callOpenAI(prompt);
}
