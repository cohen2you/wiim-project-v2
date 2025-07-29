interface FinalPromptParams {
  lead: string;
  whatHappened: string;
  whyItMatters: string;
  priceAction: string;
  primaryOutlet: string;
  secondaryOutlet: string;
}

export const getFinalAssemblyPrompt = {
  name: 'getFinalAssemblyPrompt',
  prompt: ({
    lead,
    whatHappened,
    whyItMatters,
    priceAction,
    primaryOutlet,
    secondaryOutlet,
  }: FinalPromptParams) => `
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
- In the "Price Action" section, do NOT include any source attributions.
- When citing sources in Lead, What Happened, and Why It Matters sections, ONLY use the exact outlet names provided below.
- Use the format "${primaryOutlet} reported" or "${secondaryOutlet} reported" exactly — do NOT output placeholders like "[Outlet]".
- Do NOT mention or invent any other sources beyond the provided outlet names.
- Break paragraphs so no paragraph has more than two sentences.
- Remove emojis and special formatting.
- Use a neutral, professional tone.
- Keep the article concise, between 300-400 words.
- After the Price Action section, add a placeholder for the stock chart: [STOCK_CHART_PLACEHOLDER]
- IMPORTANT: Format the output with proper HTML paragraph tags. Each paragraph should be wrapped in <p> tags.
- Example format:
  <p>First paragraph content.</p>
  <p>Second paragraph content.</p>
  <p>Third paragraph content.</p>

Make sure the output flows naturally and only attributes the sources you provide.
`,
};
