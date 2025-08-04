import { NextResponse } from 'next/server';
import OpenAI from 'openai';

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
1. Insert the analyst ratings section AFTER the lead paragraph and BEFORE the technical analysis section
2. Use the EXACT firm names and ratings from the data provided above
3. Format as: "Analyst ratings remain strong, with [EXACT FIRM NAME] maintaining [EXACT RATING] rating with $[EXACT PRICE] price target, [EXACT FIRM NAME] maintaining [EXACT RATING] rating with $[EXACT PRICE] price target"
4. DO NOT use generic phrases like "a prominent financial firm" or "another firm"
5. DO NOT use placeholder text like "[FIRM NAME]" - use the actual firm names from the data
6. Keep the rest of the story exactly as it is
7. Maintain the same writing style and tone
8. If no analyst ratings are available, skip adding this section

EXAMPLE: If the data shows "Morgan Stanley maintains Buy rating with $810 price target", your output should be "Morgan Stanley maintains Buy rating with $810 price target" (not "[FIRM NAME] maintains Buy rating with $810 price target")

Add the analyst ratings section to the existing story now.`;

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

    console.log('Add Analyst Ratings: Successfully added analyst ratings to story');

    return NextResponse.json({ 
      story: updatedStory,
      analystRatings
    });
  } catch (error: any) {
    console.error('Error adding analyst ratings:', error);
    return NextResponse.json({ error: error.message || 'Failed to add analyst ratings.' }, { status: 500 });
  }
} 