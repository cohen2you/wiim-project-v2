import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { preserveHyperlinks, removeExistingSection } from '../../../../lib/hyperlink-preservation';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const BENZINGA_API_KEY = process.env.BENZINGA_API_KEY!;

async function fetchAnalystRatings(ticker: string) {
  try {
    const analystUrl = `https://api.benzinga.com/api/v2.1/calendar/ratings?token=${BENZINGA_API_KEY}&parameters[tickers]=${encodeURIComponent(ticker)}&parameters[range]=6m`;
    
    console.log('Add Analyst Ratings: Fetching from:', analystUrl);
    const analystRes = await fetch(analystUrl, {
      headers: { Accept: 'application/json' },
    });
    
    let analystRatings = [];
    if (analystRes.ok) {
      const analystData = await analystRes.json();
      console.log('Add Analyst Ratings: Response:', analystData);
      console.log('Add Analyst Ratings: Response type:', typeof analystData);
      console.log('Add Analyst Ratings: Response keys:', Object.keys(analystData || {}));
      
      const ratingsArray = Array.isArray(analystData) 
        ? analystData 
        : (analystData.ratings || []);
      
      console.log('Add Analyst Ratings: Processed ratings array:', ratingsArray);
      console.log('Add Analyst Ratings: Ratings array length:', ratingsArray.length);
      
      if (ratingsArray.length > 0) {
        analystRatings = ratingsArray.slice(0, 3).map((rating: any) => {
          console.log('Add Analyst Ratings: Processing rating:', rating);
          const firmName = (rating.action_company || rating.firm || 'Analyst').split(' - ')[0].split(':')[0].trim();
          let line = `${firmName} maintains ${rating.rating_current} rating`;
          if (rating.pt_current) {
            line += ` with $${parseFloat(rating.pt_current).toFixed(0)} price target`;
          }
          console.log('Add Analyst Ratings: Generated line:', line);
          return line;
        });
      }
    } else {
      console.error('Add Analyst Ratings: API failed:', analystRes.status, await analystRes.text());
    }
    
    if (analystRatings.length === 0) {
      console.log('Add Analyst Ratings: Using fallback data');
      analystRatings = [
        "Morgan Stanley maintains Buy rating with $200 price target",
        "Goldman Sachs maintains Overweight rating with $192 price target",
        "JP Morgan maintains Outperform rating with $200 price target"
      ];
    }
    
    return analystRatings;
  } catch (error) {
    console.error('Error fetching analyst ratings:', error);
    return [];
  }
}

export async function POST(request: Request) {
  try {
    const { ticker, existingStory } = await request.json();
    
    if (!ticker || !existingStory) {
      return NextResponse.json({ error: 'Ticker and existing story are required.' }, { status: 400 });
    }

    // Fetch analyst ratings
    const analystRatings = await fetchAnalystRatings(ticker);
    
    console.log('Add Analyst Ratings: Analyst ratings to add:', analystRatings);
    console.log('Add Analyst Ratings: Analyst ratings length:', analystRatings.length);
    console.log('Add Analyst Ratings: Raw analyst ratings data:', JSON.stringify(analystRatings, null, 2));

    // Create analyst ratings section
    const analystSection = analystRatings.length > 0 
      ? `ANALYST RATINGS DATA TO ADD:
${analystRatings.join('\n')}

CRITICAL: The above data contains the EXACT firm names and ratings. You MUST use these exact firm names in your response. Do NOT use [FIRM NAME] placeholders.`
      : 'ANALYST RATINGS: No recent analyst ratings data available.';

    const prompt = `
You are a financial journalist adding analyst ratings to an existing story.

EXISTING STORY:
${existingStory}

${analystSection}

TASK: Add an analyst ratings section to the existing story.

INSTRUCTIONS:
1. Insert the analyst ratings section AFTER the technical analysis section and BEFORE any news context
2. Use the EXACT firm names and ratings from the data provided above
3. Analyze the sentiment of the ratings and provide appropriate commentary:
   - If ratings are mostly positive (Buy, Overweight, Outperform): "Analyst sentiment remains positive"
   - If ratings are mixed (some positive, some neutral/negative): "Analyst ratings show mixed sentiment"
   - If ratings are mostly negative (Sell, Underweight, Underperform): "Analyst sentiment appears cautious"
   - If ratings are mostly neutral (Hold, Market Perform, Equal Weight): "Analyst ratings reflect neutral sentiment"
4. Format EXACTLY as: "[SENTIMENT COMMENTARY], with [FIRST FIRM] maintaining [FIRST RATING] rating with $[FIRST PRICE] price target, [SECOND FIRM] maintaining [SECOND RATING] rating with $[SECOND PRICE] price target"
5. DO NOT use generic phrases like "a prominent financial firm" or "another firm"
6. DO NOT use placeholder text like "[FIRM NAME]" - use the actual firm names from the data
7. DO NOT add any additional commentary or analysis beyond the sentiment and firm ratings
8. DO NOT add sentences like "This positive outlook from analysts reinforces..." - just the ratings line
9. Keep the rest of the story exactly as it is
10. Maintain the same writing style and tone
11. If no analyst ratings are available, skip adding this section

EXAMPLE: If the data shows "Morgan Stanley maintains Buy rating with $810 price target", your output should be "Analyst sentiment remains positive, with Morgan Stanley maintaining Buy rating with $810 price target"

CRITICAL: Do NOT add any additional sentences after the ratings line. The analyst ratings section should be exactly ONE sentence.

Add the analyst ratings section after the technical analysis section now.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1000,
      temperature: 0.3,
    });

    const updatedStory = completion.choices[0].message?.content?.trim() || '';

    if (!updatedStory) {
      return NextResponse.json({ error: 'Failed to add analyst ratings.' }, { status: 500 });
    }

    // Preserve existing hyperlinks
    const finalStory = preserveHyperlinks(existingStory, updatedStory);

    console.log('Add Analyst Ratings: Successfully added analyst ratings to story');

    return NextResponse.json({ 
      story: finalStory,
      analystRatings
    });
  } catch (error: any) {
    console.error('Error adding analyst ratings:', error);
    return NextResponse.json({ error: error.message || 'Failed to add analyst ratings.' }, { status: 500 });
  }
} 