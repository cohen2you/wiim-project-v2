// lib/prompts/primary.ts

import { z } from 'zod';
import { PromptTemplate } from '@/lib/types';

export const primaryInputSchema = z.object({
  ticker: z.string(),
  sourceUrl: z.string(),
  articleText: z.string(),
});

export const getPrimaryPrompt: PromptTemplate<typeof primaryInputSchema> = {
  name: 'getPrimaryPrompt',
  inputSchema: primaryInputSchema,
  system: 'You are a financial journalist writing the Lead and What Happened sections of a stock movement article.',
  prompt: ({ ticker, sourceUrl, articleText }) => `
Write the **Lead** and **What Happened** sections for a stock movement article about ${ticker}.

Instructions:
- Use a concise, journalistic tone following AP style.
- Begin with a Lead paragraph that introduces the stock's movement and the news driving it.
- Include a hyperlink to the source using this format: "according to [Benzinga](${sourceUrl})".
- In the "What Happened" section, expand on the key developments — including timing, context, stock impact, and industry relevance.
- Ensure the combined length of both sections is between **200 and 250 words**.
- Break into paragraphs every **two sentences** for readability.
- The output should be formatted like this:

**Lead**

[Two-sentence paragraph]  
[Two-sentence paragraph]

**What Happened**

[Two-sentence paragraph]  
[Two-sentence paragraph]  
[Two-sentence paragraph]  
[Two-sentence paragraph]

Here is the article content for reference:
${articleText}
`,
};
