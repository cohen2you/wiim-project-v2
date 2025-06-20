// lib/api.ts

import { getPrimaryPrompt } from './prompts/primary';
import { getSecondaryPrompt } from './prompts/secondary';
import { getFinalAssemblyPrompt } from './prompts/final';

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

// Step 1: Primary
export async function generatePrimaryArticle({
  sourceUrl,
  ticker,
  articleText,
}: {
  sourceUrl: string;
  ticker: string;
  articleText: string;
}) {
  const prompt = getPrimaryPrompt.prompt({ sourceUrl, ticker, articleText });
  return await callOpenAI(prompt);
}

// Step 2: Secondary
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

// Step 3: Final
export async function generateFinalStory({
  lead,
  whatHappened,
  whyItMatters,
}: {
  lead: string;
  whatHappened: string;
  whyItMatters: string;
}) {
  const prompt = getFinalAssemblyPrompt.prompt({
    lead,
    whatHappened,
    whyItMatters,
  });
  return await callOpenAI(prompt);
}
