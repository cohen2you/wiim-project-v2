// lib/prompts/secondary.ts

import { z } from 'zod';
import { PromptTemplate } from '../../types';

export const secondaryInputSchema = z.object({
  secondaryUrl: z.string(),
  outletName: z.string(),
  primaryText: z.string(),
  secondaryText: z.string(),
});

export const getSecondaryPrompt: PromptTemplate<typeof secondaryInputSchema> = {
  name: 'getSecondaryPrompt',
  inputSchema: secondaryInputSchema,
  system: 'You are a financial journalist writing the "Why It Matters" section of a stock movement article.',
  prompt: ({ secondaryUrl, primaryText, secondaryText }) => `
Use the following information to write the **"Why It Matters"** section of a stock movement story. The section should clearly explain how the secondary article adds meaningful context to the primary one.

Instructions:
- ONLY use facts that appear in the secondaryText. Do NOT invent, speculate, or summarize general knowledge.
- Do not mention the outlet or link the secondary source.
- Make sure the section logically continues from the themes and developments in the primary section.
- Highlight how the secondary story enhances understanding of the company’s strategy, risks, or market position.
- Use AP style.
- Keep paragraphs short: no paragraph may be longer than two sentences.
- Keep the entire section under 150 words.
- Do not repeat details already included in the primary section.
- Do not reference sources or analysis that are not in the secondaryText.

Primary context:
${primaryText}

Secondary article content:
${secondaryText}

Write only the "Why It Matters" section. Label it as such.
`,
};
