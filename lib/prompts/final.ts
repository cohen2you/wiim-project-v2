// lib/prompts/final.ts

import { z } from 'zod';
import { PromptTemplate } from '../../types';

export const finalInputSchema = z.object({
  lead: z.string(),
  whatHappened: z.string(),
  whyItMatters: z.string(),
});

export const getFinalAssemblyPrompt: PromptTemplate<typeof finalInputSchema> = {
  name: 'getFinalAssemblyPrompt',
  inputSchema: finalInputSchema,
  system: 'You are a financial editor assembling a complete news article from structured inputs.',
  prompt: ({ lead, whatHappened, whyItMatters }) => `
Your task is to assemble a stock movement news article using the following three sections:

Lead:
${lead}

What Happened:
${whatHappened}

Why It Matters:
${whyItMatters}

Instructions:
- Begin the article with the Lead text exactly as written.
- Immediately after the Lead, start the next paragraph with "What Happened:" inline with the first sentence of the What Happened section.
- After the What Happened section, begin the next paragraph with "Why It Matters:" inline with the first sentence of the Why It Matters section.
- Do not repeat the labels multiple times.
- Maintain paragraph breaks within each section.
- Use AP style and a clear, concise tone.
- Limit all paragraphs to two sentences maximum.
- Add paragraph breaks after every two sentences to ensure readable spacing.
- Include the full ticker with exchange after the first company mention (e.g., Amazon.com Inc. (NASDAQ: AMZN)).
- For all subsequent mentions, use only the short company name.
- Do not output any Markdown, HTML tags, formatting, asterisks, or bold symbols.
- Do not fabricate or speculate; all content in the Why It Matters section must come from the secondary article content.
- Return only the final plain-text article with paragraph breaks that paste cleanly into WordPress.
`,
};
