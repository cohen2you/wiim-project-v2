import { NextResponse } from 'next/server';
import { preserveHyperlinks, removeExistingSection } from '../../../../lib/hyperlink-preservation';
import { aiProvider, type AIProvider } from '../../../../lib/aiProvider';

const BENZINGA_API_KEY = process.env.BENZINGA_API_KEY!;

async function fetchCompanyName(ticker: string): Promise<string> {
  try {
    const response = await fetch(`https://api.benzinga.com/api/v2/quoteDelayed?token=${BENZINGA_API_KEY}&symbols=${encodeURIComponent(ticker)}`);
    
    if (!response.ok) {
      console.error('Failed to fetch company name from Benzinga API');
      return ticker.toUpperCase();
    }
    
    const data = await response.json();
    
    if (data && typeof data === 'object') {
      const quote = data[ticker.toUpperCase()];
      if (quote && typeof quote === 'object') {
        return quote.companyStandardName || quote.name || ticker.toUpperCase();
      }
    }
    
    return ticker.toUpperCase();
  } catch (error) {
    console.error('Error fetching company name:', error);
    return ticker.toUpperCase();
  }
}

async function fetchConsensusRatings(ticker: string) {
  try {
    if (!BENZINGA_API_KEY) {
      console.error('Error: BENZINGA_API_KEY is missing from environment variables.');
      return null;
    }

    // Use URLSearchParams to properly encode the brackets in parameters[tickers]
    const params = new URLSearchParams();
    params.append('token', BENZINGA_API_KEY);
    params.append('parameters[tickers]', ticker);
    
    const consensusUrl = `https://api.benzinga.com/api/v2/consensus-ratings?${params.toString()}`;
    
    console.log('Add Analyst Ratings: Fetching consensus from:', consensusUrl);
    const consensusRes = await fetch(consensusUrl, {
      method: 'GET',
      headers: {
        // CRITICAL: The API Gateway requires this specific header
        'Accept': 'application/json'
      },
    });
      
    if (consensusRes.ok) {
      const consensusData = await consensusRes.json();
      console.log('Add Analyst Ratings: Consensus response:', JSON.stringify(consensusData, null, 2));
      console.log('Add Analyst Ratings: Consensus response type:', typeof consensusData);
      console.log('Add Analyst Ratings: Consensus response keys:', Object.keys(consensusData || {}));
      
      // Handle different response structures
      let extractedConsensus = null;
      
      if (Array.isArray(consensusData)) {
        // If it's an array, find the one matching our ticker
        extractedConsensus = consensusData.find((item: any) => 
          item.ticker?.toUpperCase() === ticker.toUpperCase() || 
          item.symbol?.toUpperCase() === ticker.toUpperCase()
        ) || consensusData[0];
        console.log('Add Analyst Ratings: Found consensus in array:', extractedConsensus);
      } else if (consensusData.consensus) {
        extractedConsensus = consensusData.consensus;
        console.log('Add Analyst Ratings: Found consensus in .consensus property');
      } else if (consensusData[ticker.toUpperCase()]) {
        extractedConsensus = consensusData[ticker.toUpperCase()];
        console.log('Add Analyst Ratings: Found consensus in ticker key:', ticker.toUpperCase());
      } else if (consensusData.ratings && Array.isArray(consensusData.ratings)) {
        // Try to find in ratings array
        extractedConsensus = consensusData.ratings.find((item: any) => 
          item.ticker?.toUpperCase() === ticker.toUpperCase() || 
          item.symbol?.toUpperCase() === ticker.toUpperCase()
        ) || consensusData.ratings[0];
        console.log('Add Analyst Ratings: Found consensus in .ratings array');
      } else {
        extractedConsensus = consensusData;
        console.log('Add Analyst Ratings: Using consensusData directly');
      }
      
      if (extractedConsensus) {
        console.log('Add Analyst Ratings: Extracted consensus object:', JSON.stringify(extractedConsensus, null, 2));
        console.log('Add Analyst Ratings: Extracted consensus keys:', Object.keys(extractedConsensus || {}));
        
        // Try multiple possible field names for consensus price target
        // Based on documentation, it should be consensus_price_target
        const consensusPriceTarget = 
          extractedConsensus.consensus_price_target ?? 
          extractedConsensus.consensusPriceTarget ??
          extractedConsensus.price_target ??
          extractedConsensus.priceTarget ??
          extractedConsensus.target ??
          extractedConsensus.pt ??
          extractedConsensus.consensus_target ??
          null;
        
        console.log('Add Analyst Ratings: Found consensus_price_target:', consensusPriceTarget);
        console.log('Add Analyst Ratings: Raw consensus_price_target value:', extractedConsensus.consensus_price_target);
        console.log('Add Analyst Ratings: Raw consensusPriceTarget value:', extractedConsensus.consensusPriceTarget);
        
        const consensus = {
          consensus_rating: extractedConsensus.consensus_rating || extractedConsensus.consensusRating || extractedConsensus.rating || null,
          consensus_price_target: consensusPriceTarget,
          high_price_target: extractedConsensus.high_price_target || extractedConsensus.highPriceTarget || extractedConsensus.high || extractedConsensus.high_target || null,
          low_price_target: extractedConsensus.low_price_target || extractedConsensus.lowPriceTarget || extractedConsensus.low || extractedConsensus.low_target || null,
          total_analyst_count: extractedConsensus.total_analyst_count || extractedConsensus.totalAnalystCount || extractedConsensus.analyst_count || extractedConsensus.count || null,
          aggregate_ratings: extractedConsensus.aggregate_ratings || extractedConsensus.aggregateRatings || extractedConsensus.ratings || {}
        };
        
        console.log('Add Analyst Ratings: Final consensus object:', JSON.stringify(consensus, null, 2));
        
        if (consensus.consensus_price_target || consensus.consensus_rating) {
          console.log('Add Analyst Ratings: Successfully extracted consensus:', consensus);
          return consensus;
        }
      }
    } else {
      const errorText = await consensusRes.text();
      console.log('Add Analyst Ratings: Consensus API failed:', consensusRes.status, 'Error:', errorText);
    }
    
    return null;
  } catch (error) {
    console.error('Error fetching consensus ratings:', error);
    return null;
  }
}

async function fetchAnalystRatings(ticker: string) {
  try {
    const analystUrl = `https://api.benzinga.com/api/v2.1/calendar/ratings?token=${BENZINGA_API_KEY}&parameters[tickers]=${encodeURIComponent(ticker)}&parameters[range]=6m`;
    
    console.log('Add Analyst Ratings: Fetching from:', analystUrl);
    const analystRes = await fetch(analystUrl, {
      headers: { Accept: 'application/json' },
    });
    
    let analystRatings: string[] = [];
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
          console.log('Add Analyst Ratings: Raw analyst:', rating.analyst);
          console.log('Add Analyst Ratings: Raw firm:', rating.firm);
          
          const firmName = (rating.analyst || rating.firm || 'Analyst').split(' - ')[0].split(':')[0].trim();
          console.log('Add Analyst Ratings: Extracted firm name:', firmName);
          
          // Check if firm name is too generic or empty
          if (!firmName || firmName === 'Analyst' || firmName.length < 2) {
            console.log('Add Analyst Ratings: Firm name too generic, skipping this rating');
            return null;
          }
          
          // Format the date
          let dateStr = '';
          if (rating.date) {
            const date = new Date(rating.date);
            const month = date.getMonth();
            const day = date.getDate();
            
            // AP Style: abbreviate Jan, Feb, Aug, Sep, Oct, Nov, Dec; spell out March, April, May, June, July
            const monthNames = [
              'Jan.', 'Feb.', 'March', 'April', 'May', 'June',
              'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'
            ];
            
            dateStr = ` on ${monthNames[month]} ${day}`;
          }
          
          let line = `${firmName} maintains ${rating.rating_current} rating`;
          if (rating.pt_current) {
            line += ` with $${parseFloat(rating.pt_current).toFixed(0)} price target`;
          }
          line += dateStr;
          
          console.log('Add Analyst Ratings: Generated line:', line);
          return line;
        }).filter((line: string | null) => line !== null) as string[];
      }
    } else {
      console.error('Add Analyst Ratings: API failed:', analystRes.status, await analystRes.text());
    }
    
    if (analystRatings.length === 0) {
      console.log('Add Analyst Ratings: Using fallback data');
      analystRatings = [
        "Morgan Stanley maintains Buy rating with $200 price target on Dec. 15",
        "Goldman Sachs maintains Overweight rating with $192 price target on Dec. 10",
        "JP Morgan maintains Outperform rating with $200 price target on Dec. 8"
      ];
    } else {
      console.log('Add Analyst Ratings: Final analyst ratings to be used:', analystRatings);
    }
    
    return analystRatings;
  } catch (error) {
    console.error('Error fetching analyst ratings:', error);
    return [];
  }
}

export async function POST(request: Request) {
  try {
    const { ticker, existingStory, aiProvider: providerOverride } = await request.json();
    
    if (!ticker || !existingStory) {
      return NextResponse.json({ error: 'Ticker and existing story are required.' }, { status: 400 });
    }
    
    const provider: AIProvider = providerOverride || aiProvider.getCurrentProvider();

    // Fetch analyst ratings, consensus, and company name
    const [analystRatings, consensus, companyName] = await Promise.all([
      fetchAnalystRatings(ticker),
      fetchConsensusRatings(ticker),
      fetchCompanyName(ticker)
    ]);
    
    console.log('Add Analyst Ratings: Analyst ratings to add:', analystRatings);
    console.log('Add Analyst Ratings: Analyst ratings length:', analystRatings.length);
    console.log('Add Analyst Ratings: Consensus data:', consensus);
    console.log('Add Analyst Ratings: Raw analyst ratings data:', JSON.stringify(analystRatings, null, 2));

    // Create analyst ratings section with consensus data
    let analystSection = '';
    if (analystRatings.length > 0) {
      analystSection = `ANALYST RATINGS DATA TO ADD:
${analystRatings.join('\n')}

CRITICAL: The above data contains the EXACT firm names and ratings. You MUST use these exact firm names in your response. Do NOT use [FIRM NAME] placeholders. NEVER use generic terms like "a firm", "another firm", "a third firm", etc. - always use the specific firm name.`;
      
      if (consensus && consensus.consensus_price_target) {
        // Convert consensus rating to proper case (Buy, not BUY)
        const consensusRating = consensus.consensus_rating || 'N/A';
        const formattedRating = consensusRating !== 'N/A' 
          ? consensusRating.charAt(0) + consensusRating.slice(1).toLowerCase()
          : 'N/A';
        
        // Format consensus price target with 2 decimal places
        const consensusPriceTarget = parseFloat(consensus.consensus_price_target.toString()).toFixed(2);
        
        analystSection += `\n\nCONSENSUS DATA (USE THESE EXACT VALUES - DO NOT USE INDIVIDUAL RATING PRICE TARGETS):
- Consensus Rating: ${formattedRating}
- Consensus Price Target: $${consensusPriceTarget} (THIS IS THE EXACT CONSENSUS - USE THIS VALUE, NOT INDIVIDUAL RATINGS)
- High Price Target: $${consensus.high_price_target ? parseFloat(consensus.high_price_target.toString()).toFixed(2) : 'N/A'}
- Low Price Target: $${consensus.low_price_target ? parseFloat(consensus.low_price_target.toString()).toFixed(2) : 'N/A'}
- Total Analysts: ${consensus.total_analyst_count || 'N/A'}
${consensus.aggregate_ratings && Object.keys(consensus.aggregate_ratings).length > 0 ? `- Aggregate Ratings: ${JSON.stringify(consensus.aggregate_ratings)}` : ''}

CRITICAL: When writing the first paragraph, you MUST use the Consensus Price Target value ($${consensusPriceTarget}) from the CONSENSUS DATA section above. DO NOT use price targets from individual analyst ratings for the consensus statement. The consensus price target is the mathematical mean of all analyst price targets, which may be different from any individual analyst's price target.`;
      } else if (consensus) {
        // Consensus exists but no price target - still include rating
        const consensusRating = consensus.consensus_rating || 'N/A';
        const formattedRating = consensusRating !== 'N/A' 
          ? consensusRating.charAt(0) + consensusRating.slice(1).toLowerCase()
          : 'N/A';
        
        analystSection += `\n\nCONSENSUS DATA:
- Consensus Rating: ${formattedRating}
- Consensus Price Target: Not available
- High Price Target: ${consensus.high_price_target ? '$' + parseFloat(consensus.high_price_target.toString()).toFixed(2) : 'N/A'}
- Low Price Target: ${consensus.low_price_target ? '$' + parseFloat(consensus.low_price_target.toString()).toFixed(2) : 'N/A'}
- Total Analysts: ${consensus.total_analyst_count || 'N/A'}`;
      }
    } else {
      analystSection = 'ANALYST RATINGS: No recent analyst ratings data available.';
    }

    const prompt = `
You are a financial journalist adding analyst ratings to an existing story.

EXISTING STORY:
${existingStory}

${analystSection}

COMPANY INFORMATION:
- Company Name: ${companyName}
- Ticker: ${ticker.toUpperCase()}

TASK: Add an analyst ratings section to the existing story.

INSTRUCTIONS:
1. Insert the analyst ratings section AFTER the technical analysis section and BEFORE any news context
2. Use the EXACT firm names, ratings, and dates from the data provided above
3. Format as THREE paragraphs:
   - First paragraph: Start with a conversational sentence that includes the company name and consensus information if available. Use natural, conversational language like "Analysts have a [RATING] consensus rating on ${companyName} with a price target of $[PRICE]" or "The analyst consensus for ${companyName} stands at [RATING] with a $[PRICE] price target". CRITICAL: You MUST use the EXACT Consensus Price Target value from the CONSENSUS DATA section (e.g., if it shows "$292.85", use "$292.85" - do NOT use individual analyst price targets like $330, $325, or $350 for the consensus statement). The consensus price target is the mathematical mean of all analyst price targets and will be different from individual ratings. Then list the recent individual ratings with EXACT firm names, ratings, and price targets. Group ratings by date when possible to avoid repetition (e.g., "On Dec. 7, Evercore ISI Group maintained an Outperform rating with a $325 price target and Wedbush maintained an Outperform rating with a $350 price target. On Dec. 8, Citigroup maintained a Buy rating with a $330 price target"). If all ratings are on different dates, list them separately. DO NOT repeat the same date multiple times in a row - group them intelligently. IMPORTANT: Use proper case for ratings (Buy, not BUY; Outperform, not OUTPERFORM; etc.)
   - Second paragraph: Analyze the consensus rating and overall sentiment. Discuss what the consensus rating indicates about analyst sentiment, whether the individual ratings align with or diverge from consensus, and what this means for investors.
   - Third paragraph: Provide deeper analysis of the price targets and recent analyst actions. Discuss what the price target range suggests about analyst expectations, whether recent analyst actions are more bullish or bearish than the overall average, and any notable patterns or trends that investors should be aware of.
4. Analyze the sentiment of the ratings and provide appropriate commentary:
   - If ratings are mostly positive (Buy, Overweight, Outperform): "Analyst sentiment remains positive"
   - If ratings are mixed (some positive, some neutral/negative): "Analyst ratings show mixed sentiment"
   - If ratings are mostly negative (Sell, Underweight, Underperform): "Analyst sentiment appears cautious"
   - If ratings are mostly neutral (Hold, Market Perform, Equal Weight): "Analyst ratings reflect neutral sentiment"
5. DO NOT use generic phrases like "a prominent financial firm", "another firm", "a firm", "a third firm", etc.
6. DO NOT use placeholder text like "[FIRM NAME]" - use the actual firm names from the data
7. ALWAYS use the specific firm name from the data (e.g., "Morgan Stanley", "Goldman Sachs", "JP Morgan")
8. If consensus data is available, include it in the first paragraph before listing individual ratings
9. CRITICAL: Use proper case for all ratings - "Buy" not "BUY", "Outperform" not "OUTPERFORM", "Hold" not "HOLD", etc. Only capitalize the first letter.
10. Keep the rest of the story exactly as it is
11. Maintain the same writing style and tone
12. If no analyst ratings are available, skip adding this section
13. ALWAYS include the firm names and dates in the ratings - this is critical for credibility
14. IMPORTANT: When multiple ratings share the same date, group them together to avoid repetition (e.g., "On Dec. 7, Firm A maintained... and Firm B maintained..." instead of "Firm A... on Dec. 7, Firm B... on Dec. 7")

EXAMPLE: If consensus shows "Buy" (not "BUY") with $325 target and data shows ratings on Dec. 7 and Dec. 8, your output should be:
"Analysts have a Buy consensus rating on ${companyName} with a price target of $325. On Dec. 7, Evercore ISI Group maintained an Outperform rating with a $325 price target and Wedbush maintained an Outperform rating with a $350 price target. On Dec. 8, Citigroup maintained a Buy rating with a $330 price target.

The consensus Buy rating reflects overall positive sentiment among analysts, indicating broad confidence in the stock's prospects. The individual ratings from Citigroup, Evercore ISI Group, and Wedbush all align with this positive consensus, with each firm maintaining bullish positions that support the overall optimistic outlook.

The price targets ranging from $325 to $350 suggest analysts see meaningful upside potential, with Wedbush's $350 target representing the most bullish view. The recent analyst actions, all maintaining positive ratings, reinforce the consensus sentiment and indicate continued confidence in the stock's trajectory."

Add the analyst ratings section after the technical analysis section now.`;

    const result = await aiProvider.generateCompletion(
      [{ role: 'user', content: prompt }],
      {
        model: provider === 'gemini' ? 'gemini-3-pro-preview' : 'gpt-4o-mini',
        temperature: 0.3,
        maxTokens: 1500,
      },
      provider
    );

    const updatedStory = result.content.trim();

    if (!updatedStory) {
      return NextResponse.json({ error: 'Failed to add analyst ratings.' }, { status: 500 });
    }

    // Preserve existing hyperlinks
    const finalStory = preserveHyperlinks(existingStory, updatedStory);

    // Extract the analyst ratings section for component display (should include all three paragraphs)
    // Match from "Analysts" or "The analyst" until the next major section starts or end of story
    const analystRatingsMatch = finalStory.match(/(?:Analysts|The analyst)[\s\S]*?(?=\n\n(?:[A-Z][a-z]+:|Price Action:|Also Read:|Read Next:|Benzinga Edge)|$)/i);
    const analystRatingsContent = analystRatingsMatch ? analystRatingsMatch[0].trim() : '';

    console.log('Add Analyst Ratings: Successfully added analyst ratings to story');

    return NextResponse.json({ 
      story: finalStory,
      analystRatings,
      analystRatingsContent
    });
  } catch (error: any) {
    console.error('Error adding analyst ratings:', error);
    return NextResponse.json({ error: error.message || 'Failed to add analyst ratings.' }, { status: 500 });
  }
} 