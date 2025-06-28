interface FinalPromptParams {
  lead: string;
  whatHappened: string;
  whyItMatters: string;
  priceAction: string;
}

export const getFinalAssemblyPrompt = {
  name: 'getFinalAssemblyPrompt',
  // optionally add zod inputSchema here for validation
  prompt: ({ lead, whatHappened, whyItMatters, priceAction }: FinalPromptParams) => `
You are an experienced financial editor assembling a concise news article from the given sections.

Lead:
${lead}

What Happened:
${whatHappened}

Why It Matters:
${whyItMatters}

Price Action:
${priceAction}

Instructions:
- Use only the given text — do not fetch or invent additional content.
- Write in clear, plain text suitable for publication.
- Maintain a neutral, professional tone.
- Organize the content in the order above with paragraph breaks.
`,
};
