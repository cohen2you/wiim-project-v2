import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { preserveHyperlinks } from '../../../../lib/hyperlink-preservation';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const {
      story, // The complete story with hyperlinks already added
    } = body;

    if (!story) {
      return NextResponse.json(
        { error: 'Missing required field: story.' },
        { status: 400 }
      );
    }

    // Create a comprehensive prompt for improving the story
    const improvePrompt = `
You are a senior financial editor improving a news article. Your task is to enhance the writing quality while preserving ALL essential content and hyperlinks.

EXISTING STORY:
${story}

IMPROVEMENT TASKS:
1. **Enhance Writing Quality**: Improve sentence structure, word choice, and readability
2. **Limit Paragraph Length**: Ensure no paragraph is longer than 2 sentences
3. **Improve Flow**: Create better transitions between paragraphs and ideas
4. **Enhance Clarity**: Make complex financial concepts more accessible
5. **Professional Tone**: Keep the tone professional but engaging for retail investors
6. **Remove Redundancy**: Eliminate repetitive phrases and unnecessary words
7. **Active Voice**: Use active voice where appropriate
8. **Conciseness**: Streamline sentences while keeping all essential information

CRITICAL PRESERVATION RULES:
- PRESERVE ALL EXISTING HYPERLINKS - Do not remove, modify, or change any <a href="...">text</a> tags
- PRESERVE THE PRICE ACTION LINE - Keep it at the bottom of the story
- PRESERVE ALL ANALYST RATINGS - Keep firm names, ratings, price targets, and dates
- PRESERVE ALL CONTEXT ARTICLE REFERENCES - Keep hyperlinks to context articles
- PRESERVE ALL FACTS - Keep all numbers, data points, and factual information unchanged
- PRESERVE STORY STRUCTURE - Keep the overall flow and organization

SPECIFIC IMPROVEMENTS:
- Break up long paragraphs into shorter ones (max 2 sentences per paragraph)
- Improve sentence variety and rhythm
- Enhance word choice for better impact
- Create smoother transitions between ideas
- Make technical analysis more accessible
- Improve the overall reading experience
- Keep all hyperlinks functional and in their original context

EDITORIAL STYLE:
- Conversational but professional
- Clear and engaging for retail investors
- Avoid jargon when possible
- Smooth transitions between ideas
- Logical flow from lead to conclusion
- Active voice preferred
- Concise sentences

Return the improved story with better writing quality while preserving ALL essential content:`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: improvePrompt }],
      max_tokens: 3000,
      temperature: 0.3,
    });

    const improvedStory = completion.choices[0].message?.content?.trim() || story;

    // Verify that essential content was preserved
    const originalHyperlinkCount = (story.match(/<a href=/g) || []).length;
    const improvedHyperlinkCount = (improvedStory.match(/<a href=/g) || []).length;
    const hasPriceAction = improvedStory.includes('Price Action:');
    const hasAnalystRatings = improvedStory.includes('Analyst sentiment') || improvedStory.includes('rating with $');
    
    console.log('Final improvement verification:');
    console.log(`- Original hyperlinks: ${originalHyperlinkCount}`);
    console.log(`- Improved hyperlinks: ${improvedHyperlinkCount}`);
    console.log(`- Has price action line: ${hasPriceAction}`);
    console.log(`- Has analyst ratings: ${hasAnalystRatings}`);
    console.log(`- Improved word count: ${improvedStory.split(' ').length}`);
    
    // If essential content was lost, return the original story
    if (improvedHyperlinkCount < originalHyperlinkCount || !hasPriceAction) {
      console.warn('Final: Essential content was lost, returning original story');
      return NextResponse.json({ result: story });
    }

    // Preserve existing hyperlinks
    const finalStory = preserveHyperlinks(story, improvedStory);

    return NextResponse.json({ result: finalStory });
  } catch (error: any) {
    console.error('Error improving story:', error);
    return NextResponse.json(
      { error: error.message || 'Unexpected error occurred' },
      { status: 500 }
    );
  }
}
