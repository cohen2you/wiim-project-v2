import { NextResponse } from 'next/server';
import { aiProvider, type AIProvider } from '../../../../lib/aiProvider';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { analystNoteText, ticker, aiProvider: providerOverride, existingHeadlines } = await req.json();
    
    if (!analystNoteText || !analystNoteText.trim()) {
      return NextResponse.json({ error: 'Analyst note text is required' }, { status: 400 });
    }

    const provider: AIProvider = providerOverride || 'openai';
    
    // Truncate text if needed (headlines don't need full context)
    const maxInputChars = provider === 'gemini' ? 200000 : 100000;
    const truncatedText = analystNoteText.length > maxInputChars 
      ? analystNoteText.substring(0, maxInputChars) 
      : analystNoteText.trim();

    // Build prompt that encourages different takes
    const existingHeadlinesText = existingHeadlines && existingHeadlines.length > 0
      ? `\n\nIMPORTANT: Here are previous headlines that were generated. Create a DIFFERENT take/angle:\n${existingHeadlines.map((h: string, i: number) => `${i + 1}. ${h}`).join('\n')}\n\nMake sure your new headline has a different angle, focus, or narrative approach.`
      : '';

    const prompt = `Generate a news headline for an analyst note article. Follow Benzinga style guidelines.

### HEADLINE REQUIREMENTS:

1. **Style:** Create a narrative, editorial headline that tells a story. Use quotes, conflict, or intrigue when possible. Include specific numbers/metrics when impactful.

2. **Format Examples:**
   - "BofA Says 'Ignore The Noise': Broadcom Poised For $500 As AI Backlog Swells To $73 Billion"
   - "[Firm] Sees [Company] Hitting $[Target] As [Key Metric] Surges"
   - "[Analyst] Boosts Price Target On [Stock] To $[Target], Cites [Key Reason]"

3. **Guidelines:**
   - Use company name without "Inc." in headline (just "Broadcom" not "Broadcom Inc.")
   - Create intrigue: "Mystery Customer", "Ignore The Noise", "Beat Goes On"
   - Include specific numbers when impactful: "$73 billion", "$500 target"
   - Keep under 100 characters when possible
   - **CRITICAL: If using quotation marks, use SINGLE QUOTES (') not double quotes ("). Example: 'Accelerating Momentum' not "Accelerating Momentum".**
   - **CRITICAL: If using quotation marks, the quoted text MUST be an exact word-for-word copy from the source analyst note. Do NOT invent quotes or paraphrase. If you cannot find an exact quote in the source, do not use quotation marks in the headline.**

4. **Different Angle:** ${existingHeadlinesText ? 'Create a headline with a DIFFERENT angle, focus, or narrative approach than the previous ones listed above.' : 'Create a compelling, unique headline.'}

### INPUT TEXT (Analyst Note):

${truncatedText}

### OUTPUT HEADLINE:`;

    const result = await aiProvider.generateCompletion(
      [
        {
          role: "system",
          content: "You are an editorial financial journalist writing headlines for Benzinga, a fast-paced trading news site. Create compelling, narrative-driven headlines that tell a story and create intrigue. Headlines should be under 100 characters when possible. Use single quotes (') for quoted phrases, not double quotes. If using quotes, they MUST be exact word-for-word copies from the source. Create unique headlines with different angles each time."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      {
        model: provider === 'gemini' ? 'gemini-3-pro-preview' : 'gpt-4-turbo',
        temperature: 0.8, // Higher temperature for more variety
        maxTokens: 150,
      },
      provider
    );

    let headline = result.content.trim();

    if (!headline) {
      return NextResponse.json({ error: 'Failed to generate headline' }, { status: 500 });
    }

    // Remove quotes that wrap the entire headline (common AI mistake)
    headline = headline.trim();
    if ((headline.startsWith("'") && headline.endsWith("'")) || 
        (headline.startsWith('"') && headline.endsWith('"'))) {
      headline = headline.slice(1, -1).trim();
    }

    // Convert double quotes to single quotes in headline (for quoted phrases within headline)
    headline = headline.replace(/"([^"]+)"/g, "'$1'");

    return NextResponse.json({ headline });

  } catch (error: any) {
    console.error('Error generating headline:', error);
    return NextResponse.json({ 
      error: error.message || 'Failed to generate headline' 
    }, { status: 500 });
  }
}
