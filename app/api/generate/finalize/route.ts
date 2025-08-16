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

    // Create a prompt to adjust the lead paragraph
    const adjustmentPrompt = `
You are a professional financial journalist. The lead paragraph of this story contradicts the price action information at the bottom. 

EXISTING STORY:
${existingStory}

PRICE ACTION INFORMATION:
- Stock direction: ${isUp ? 'UP' : 'DOWN'}
- Change: ${priceChangePercent}%
- Ticker: ${tickerFromPrice}
- Current day: ${currentDay}

TASK: Adjust ONLY the lead paragraph to match the price action and include the day of the week while keeping everything else exactly the same.

RULES:
1. **ONLY modify the lead paragraph** - leave everything else unchanged
2. **Match the price direction**: If price action shows "down", the lead should say the stock "fell", "declined", "dropped", etc. If price action shows "up", the lead should say the stock "gained", "rose", "climbed", etc.
3. **Include the day**: Add the day of the week (${currentDay}) to the lead paragraph
4. **Preserve the structure**: Keep the same sentence structure and flow
5. **Keep the context**: Maintain any relevant market context or volume information
6. **Preserve all HTML hyperlinks**: Do not modify any <a href="...">text</a> tags
7. **Keep the same tone**: Maintain the professional journalistic tone
8. **Do not add specific price numbers**: The lead should focus on direction and context, not specific prices

EXAMPLES:
- If price action shows "down 0.17%" on Friday, the lead should say "saw declines on Friday", "fell on Friday", "declined on Friday", etc.
- If price action shows "up 2.5%" on Friday, the lead should say "saw gains on Friday", "rose on Friday", "climbed on Friday", etc.

CRITICAL: Only change the lead paragraph. Do not touch any other part of the story.

Return the corrected story with the adjusted lead paragraph:`;

    const adjustmentCompletion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: adjustmentPrompt }],
      max_tokens: 2000,
      temperature: 0.2,
    });

    const adjustedStory = adjustmentCompletion.choices[0].message?.content?.trim() || existingStory;

    return NextResponse.json({ 
      story: adjustedStory,
      priceDirection: isUp ? 'up' : 'down',
      priceChangePercent: priceChangePercent
    });
  } catch (error: any) {
    console.error('Error finalizing story:', error);
    return NextResponse.json({ error: error.message || 'Failed to finalize story.' }, { status: 500 });
  }
} 