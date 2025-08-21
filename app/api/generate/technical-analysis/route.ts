import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { preserveHyperlinks } from '../../../../lib/hyperlink-preservation';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const BENZINGA_API_KEY = process.env.BENZINGA_API_KEY!;

async function fetchPriceData(ticker: string) {
  try {
    const priceActionUrl = `https://api.benzinga.com/api/v2/quoteDelayed?token=${BENZINGA_API_KEY}&symbols=${encodeURIComponent(ticker)}`;
    const priceActionRes = await fetch(priceActionUrl);
    
    if (priceActionRes.ok) {
      const priceData = await priceActionRes.json();
      if (priceData && typeof priceData === 'object') {
        const quote = priceData[ticker.toUpperCase()];
        if (quote && typeof quote === 'object') {
          return {
            last: quote.lastTradePrice || 0,
            change: quote.change || 0,
            changePercent: quote.changePercent || 0,
            volume: quote.volume || 0,
            high: quote.high || 0,
            low: quote.low || 0,
            open: quote.open || 0,
            companyName: quote.companyStandardName || quote.name || ticker.toUpperCase()
          };
        }
      }
    }
    return null;
  } catch (error) {
    console.error('Error fetching price data:', error);
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const { ticker, existingStory } = await request.json();
    
    if (!ticker) {
      return NextResponse.json({ error: 'Ticker is required.' }, { status: 400 });
    }

    // Fetch price data for technical analysis
    const priceData = await fetchPriceData(ticker);
    
    const prompt = `
Generate ONLY a technical analysis section for ${ticker}.

Focus on:
- Specific price action and momentum with actual levels
- Detailed volume analysis with specific numbers
- Precise support and resistance levels
- Calculated technical indicators with specific values
- Market structure and trend analysis
- Specific chart patterns and formations

Rules:
- Keep paragraphs to 2 sentences maximum
- Include SPECIFIC price levels, volume data, and technical indicator values
- Use the actual price data provided below
- Focus on technical analysis with concrete data points
- Write in a direct, conversational tone - like a trader talking to another trader
- No analyst ratings or commentary
- DO NOT mention the ticker symbol (${ticker}) or company name in this section
- DO NOT repeat the company name - it should only appear once in the lead paragraph
- Use "the stock" or "shares" instead of the company name
- Start directly with technical analysis content
- CRITICAL: Format ALL prices to exactly 2 decimal places (e.g., $179.50, not $179.505)
- CRITICAL: Be aware that the market is currently open - use "trading at" or "currently at" instead of "closing at"
- Use present tense for current market conditions
- AVOID generic statements - use specific data points
- DO NOT repeat specific price changes or percentages that will be in the price action line
- DO NOT include current price action lines like "The stock is currently trading at $X.XX" - focus on technical analysis only
- ABSOLUTELY FORBIDDEN: Do NOT mention current price, current trading levels, or "currently trading at" - this information belongs in the price action line at the bottom
- ABSOLUTELY FORBIDDEN: Do NOT say "the stock exhibits a current price of" or similar phrases
- ABSOLUTELY FORBIDDEN: Do NOT describe what the stock is "currently" doing in terms of price - focus on technical patterns and indicators only
- WRITING STYLE: Use direct, punchy language - avoid flowery or academic language
- WRITING STYLE: Write like you're explaining to a colleague, not writing a research paper
- WRITING STYLE: Use active voice and short, clear sentences

TECHNICAL DATA TO USE:
${priceData ? `
Current Price: $${parseFloat(priceData.last || 0).toFixed(2)}
Change: $${parseFloat(priceData.change || 0).toFixed(2)}
Change Percent: ${parseFloat(priceData.changePercent || 0).toFixed(2)}%
Volume: ${priceData.volume ? priceData.volume.toLocaleString() : 'N/A'}
High: $${parseFloat(priceData.high || 0).toFixed(2)}
Low: $${parseFloat(priceData.low || 0).toFixed(2)}
Open: $${parseFloat(priceData.open || 0).toFixed(2)}

CALCULATE AND INCLUDE:
- RSI (Relative Strength Index) - calculate from price data
- Support levels (use recent lows and key price levels)
- Resistance levels (use recent highs and key price levels)
- Volume analysis (compare current vs average)
- Moving averages (if data available)
- MACD signals (if calculable from data)
- Specific chart patterns based on price action
` : 'No price data available'}

REQUIRED ELEMENTS:
1. **Technical Indicators**: Calculated values (RSI, MACD, etc.)
2. **Volume Analysis**: Actual volume numbers and significance
3. **Support/Resistance**: Specific price levels with context
4. **Chart Patterns**: Specific formations based on price action
5. **Market Structure**: Higher highs/lows, trend confirmation
6. **Momentum Analysis**: Technical momentum indicators and signals

AVOID:
- Current price action statements
- "The stock is currently trading at..." phrases
- "The stock exhibits a current price of..." phrases
- "Currently trading at..." phrases
- Simple price change descriptions
- Focus on technical analysis, not price reporting
- ANY mention of current price levels or current trading status
- Formal, academic language like "exhibits," "indicates," "suggests," "reflects"
- Flowery phrases like "notably above," "significantly," "particularly"
- Research paper tone - write like a trader, not a professor

Generate the technical analysis section with specific data points:

EXAMPLES OF WHAT NOT TO WRITE:
❌ "The stock exhibits a current price of $204.06, reflecting a slight upward movement."
❌ "Currently trading at $204.06, the stock shows..."
❌ "The stock is currently at $204.06 with..."

EXAMPLES OF WHAT TO WRITE:
✅ "The stock is testing resistance at $205.34 with solid support at $202.16."
✅ "Volume is running hot at 22.5 million shares - that's well above the 15 million average."
✅ "RSI at 62.45 shows we're getting close to overbought territory."
✅ "MACD is still bullish but the lines are tightening up."
✅ "We've got higher highs and higher lows - that's a solid uptrend."
✅ "This looks like an ascending triangle forming between $205.34 and the recent lows."`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 400,
      temperature: 0.3,
    });

    const technicalAnalysis = completion.choices[0].message?.content?.trim() || '';

    if (!technicalAnalysis) {
      return NextResponse.json({ error: 'Failed to generate technical analysis.' }, { status: 500 });
    }

    // If we have an existing story, preserve hyperlinks
    let finalTechnicalAnalysis = technicalAnalysis;
    if (existingStory) {
      // Create a combined story with the new technical analysis
      const combinedStory = existingStory + '\n\n' + technicalAnalysis;
      finalTechnicalAnalysis = preserveHyperlinks(existingStory, combinedStory);
    }

    console.log(`Generated technical analysis for ${ticker}: ${technicalAnalysis}`);

    return NextResponse.json({ 
      technicalAnalysis: finalTechnicalAnalysis,
      step: 3
    });
  } catch (error: any) {
    console.error('Error generating technical analysis:', error);
    return NextResponse.json({ error: error.message || 'Failed to generate technical analysis.' }, { status: 500 });
  }
} 