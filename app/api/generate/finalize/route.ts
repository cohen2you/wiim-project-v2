import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { ticker, existingStory } = await req.json();

    if (!ticker || !existingStory) {
      return NextResponse.json({ error: 'Ticker and existing story are required' }, { status: 400 });
    }

    const prompt = `You are a senior financial editor reviewing a news article about ${ticker}. Your task is to perform a comprehensive editorial review and finalization.

EXISTING STORY:
${existingStory}

EDITORIAL REVIEW TASKS:
1. Fix any market day inconsistencies (e.g., "Saturday" or "Sunday" should be changed to "Friday" since markets are closed on weekends)
2. Streamline the article to 350-400 words while preserving all essential content
3. Improve wording, flow, and conversational style while maintaining professional journalistic tone
4. Ensure all prices are formatted to exactly 2 decimal places
5. Preserve ALL existing hyperlinks - do not remove or modify any hyperlinks
6. Preserve the price action line (usually at the end starting with "[TICKER] Price Action:")
7. Preserve all analyst ratings with firm names and dates
8. Preserve all context article references and hyperlinks
9. Enhance readability and flow while maintaining accuracy

CRITICAL REQUIREMENTS:
- MUST preserve all existing hyperlinks exactly as they are
- MUST preserve the price action line
- MUST preserve analyst ratings with firm names and dates
- MUST preserve context article references
- Target word count: 350-400 words
- Fix any weekend day references to Friday
- Improve conversational flow and professional tone
- Format all prices to exactly 2 decimal places

Return the finalized story with all improvements applied while preserving all existing content and hyperlinks:`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are a senior financial editor with expertise in market timing, editorial review, and maintaining journalistic integrity while improving readability.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 4000,
    });

    const finalizedStory = completion.choices[0]?.message?.content?.trim();

    if (!finalizedStory) {
      throw new Error('Failed to finalize story');
    }

    // Verify that essential content was preserved
    const hasHyperlinks = (finalizedStory.match(/<a href=/g) || []).length > 0;
    const hasPriceAction = finalizedStory.includes('Price Action:');
    const hasAnalystRatings = finalizedStory.includes('Analyst sentiment') || finalizedStory.includes('rating');

    if (!hasHyperlinks || !hasPriceAction) {
      // If essential content was lost, return the original story with a warning
      return NextResponse.json({ 
        story: existingStory, 
        warning: 'Finalization may have removed essential content. Original story preserved.',
        originalStory: existingStory
      });
    }

    return NextResponse.json({ 
      story: finalizedStory, 
      originalStory: existingStory,
      wordCount: finalizedStory.split(/\s+/).length
    });
  } catch (error: any) {
    console.error('Error finalizing story:', error);
    return NextResponse.json({ error: error.message || 'Failed to finalize story' }, { status: 500 });
  }
} 