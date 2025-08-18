import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(request: Request) {
  try {
    const { ticker, existingStory } = await request.json();
    
    if (!ticker || !existingStory) {
      return NextResponse.json({ error: 'Ticker and existing story are required.' }, { status: 400 });
    }

    // Extract the price action line from the story
    let tickerFromPrice: string;
    let priceDirection: string;
    let priceChangePercent: string;
    
    // Try the primary pattern first
    const priceActionMatch = existingStory.match(/([A-Z]+) Price Action:.*?([A-Z]+) shares were (up|down|fell|rose).*?(\d+\.?\d*)%/i);
    
    if (priceActionMatch) {
      [, tickerFromPrice, , priceDirection, priceChangePercent] = priceActionMatch;
    } else {
      // Try a more flexible pattern
      const flexibleMatch = existingStory.match(/([A-Z]+) Price Action:.*?(up|down|fell|rose).*?(\d+\.?\d*)%/i);
      
      if (!flexibleMatch) {
        console.error('Could not find price action in story. Story excerpt:', existingStory.substring(existingStory.length - 200));
        return NextResponse.json({ error: 'Could not find price action information in the story.' }, { status: 400 });
      }
      
      [, tickerFromPrice, priceDirection, priceChangePercent] = flexibleMatch;
    }
    
    // Determine if the stock went up or down
    const isUp = priceDirection === 'up' || priceDirection === 'rose';
    const isDown = priceDirection === 'down' || priceDirection === 'fell';
    
    if (!isUp && !isDown) {
      return NextResponse.json({ error: 'Could not determine price direction from price action.' }, { status: 400 });
    }

    // Get current day name
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const currentDay = days[new Date().getDay()];

    // Create a comprehensive prompt for finalizing the story
    const finalizePrompt = `
You are a senior financial editor reviewing and finalizing a news article. Your task is to create a polished, professional, and conversational financial news story while maintaining ALL essential content.

EXISTING STORY:
${existingStory}

PRICE ACTION INFORMATION:
- Stock direction: ${isUp ? 'UP' : 'DOWN'}
- Change: ${priceChangePercent}%
- Ticker: ${tickerFromPrice}
- Current day: ${currentDay}

EDITORIAL TASKS:
1. **Fix Market Day Issues**: If the story mentions Saturday or Sunday, change it to the most recent trading day (Friday) since markets are closed on weekends
2. **Streamline to 350-400 Words**: Reduce the story length while preserving ALL essential content
3. **Enhance Conversational Style**: Make the writing more engaging and conversational while maintaining journalistic standards
4. **Preserve ALL Hyperlinks**: Keep ALL existing <a href="...">text</a> tags exactly as they are - DO NOT REMOVE ANY
5. **Preserve Price Action Line**: Keep the price action line at the bottom of the story
6. **Preserve Analyst Ratings**: Keep all analyst ratings with firm names and dates
7. **Preserve Context Articles**: Keep all context article hyperlinks and references
8. **Improve Wording**: Enhance sentence structure, word choice, and readability
9. **Maintain Accuracy**: Ensure all facts, numbers, and technical details remain accurate
10. **Professional Tone**: Keep the tone professional but accessible to retail investors

SPECIFIC REQUIREMENTS:
- **Target Length**: 350-400 words total
- **Lead Paragraph**: Must match the price action direction and include the correct trading day
- **Weekend Fix**: Replace Saturday/Sunday with Friday (or the most recent trading day)
- **Hyperlink Preservation**: ALL existing hyperlinks must remain intact and functional
- **Price Action Line**: Must remain at the bottom of the story
- **Analyst Ratings**: Must remain with firm names and dates
- **Context Articles**: Must remain with hyperlinks
- **Story Flow**: Improve transitions between paragraphs and ideas
- **Clarity**: Make complex financial concepts more accessible
- **Conciseness**: Remove redundant phrases and unnecessary words, but keep all essential information

CRITICAL PRESERVATION RULES:
- PRESERVE ALL EXISTING HYPERLINKS - Do not remove, modify, or change any <a href="...">text</a> tags
- PRESERVE THE PRICE ACTION LINE - Keep it at the bottom of the story
- PRESERVE ALL ANALYST RATINGS - Keep firm names, ratings, price targets, and dates
- PRESERVE ALL CONTEXT ARTICLE REFERENCES - Keep hyperlinks to context articles
- Fix any Saturday/Sunday references to Friday (or most recent trading day)
- Match the lead paragraph to the price action direction
- Improve the overall writing quality and flow
- Keep all factual information accurate

EDITORIAL STYLE:
- Conversational but professional
- Clear and engaging for retail investors
- Avoid jargon when possible
- Smooth transitions between ideas
- Logical flow from lead to conclusion
- Active voice preferred
- Concise sentences (2 sentences max per paragraph)

LENGTH REDUCTION STRATEGY:
- Remove redundant phrases and unnecessary words
- Combine similar ideas into single sentences
- Eliminate repetitive information
- Streamline transitions
- Keep all essential facts, numbers, and data points
- Maintain all hyperlinks and references

Return the finalized, editorially improved story that is 350-400 words while preserving ALL essential content:`;

    const finalizeCompletion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: finalizePrompt }],
      max_tokens: 2500,
      temperature: 0.3,
    });

    const finalizedStory = finalizeCompletion.choices[0].message?.content?.trim() || existingStory;

    // Verify that essential content was preserved
    const originalHyperlinkCount = (existingStory.match(/<a href=/g) || []).length;
    const finalHyperlinkCount = (finalizedStory.match(/<a href=/g) || []).length;
    const hasPriceAction = finalizedStory.includes('Price Action:');
    const hasAnalystRatings = finalizedStory.includes('Analyst sentiment') || finalizedStory.includes('rating with $');
    
    console.log('Finalize verification:');
    console.log(`- Original hyperlinks: ${originalHyperlinkCount}`);
    console.log(`- Final hyperlinks: ${finalHyperlinkCount}`);
    console.log(`- Has price action line: ${hasPriceAction}`);
    console.log(`- Has analyst ratings: ${hasAnalystRatings}`);
    console.log(`- Final word count: ${finalizedStory.split(' ').length}`);
    
    // If essential content was lost, return the original story with a warning
    if (finalHyperlinkCount < originalHyperlinkCount || !hasPriceAction) {
      console.warn('Finalize: Essential content was lost, returning original story');
      return NextResponse.json({ 
        story: existingStory,
        originalStory: existingStory,
        priceDirection: isUp ? 'up' : 'down',
        priceChangePercent: priceChangePercent,
        warning: 'Finalization was skipped to preserve essential content'
      });
    }

    return NextResponse.json({ 
      story: finalizedStory,
      originalStory: existingStory,
      priceDirection: isUp ? 'up' : 'down',
      priceChangePercent: priceChangePercent
    });
  } catch (error: any) {
    console.error('Error finalizing story:', error);
    return NextResponse.json({ error: error.message || 'Failed to finalize story.' }, { status: 500 });
  }
} 