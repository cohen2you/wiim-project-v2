import { NextResponse } from 'next/server';
import OpenAI from 'openai';

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
            changePercent: quote.changePercent || 0,
            volume: quote.volume || 0,
            companyName: quote.companyStandardName || quote.name || ticker.toUpperCase(),
            exchange: quote.exchange || 'NASDAQ' // Default to NASDAQ if not specified
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

function getCompanyNameFormat(ticker: string, priceData: any) {
  // Common company name mappings
  const companyNames: { [key: string]: string } = {
    'NVDA': 'Nvidia Corp.',
    'META': 'Meta Platforms Inc.',
    'AAPL': 'Apple Inc.',
    'MSFT': 'Microsoft Corp.',
    'GOOGL': 'Alphabet Inc.',
    'AMZN': 'Amazon.com Inc.',
    'TSLA': 'Tesla Inc.',
    'NFLX': 'Netflix Inc.',
    'AMD': 'Advanced Micro Devices Inc.',
    'INTC': 'Intel Corp.'
  };
  
  // Exchange code mappings
  const exchangeNames: { [key: string]: string } = {
    'XNAS': 'NASDAQ',
    'XNYS': 'NYSE',
    'XASE': 'AMEX',
    'ARCX': 'NYSE ARCA',
    'BATS': 'BATS',
    'EDGX': 'EDGX',
    'EDGA': 'EDGA'
  };
  
  const companyName = companyNames[ticker.toUpperCase()] || priceData?.companyName || ticker.toUpperCase();
  const exchangeCode = priceData?.exchange || 'NASDAQ';
  const exchange = exchangeNames[exchangeCode] || exchangeCode;
  
  return `${companyName} (${exchange}: ${ticker.toUpperCase()})`;
}

export async function POST(request: Request) {
  try {
    const { ticker } = await request.json();
    
    if (!ticker) {
      return NextResponse.json({ error: 'Ticker is required.' }, { status: 400 });
    }

    // Fetch price data for context
    const priceData = await fetchPriceData(ticker);
    const companyNameFormatted = getCompanyNameFormat(ticker, priceData);
    
    // Get the last trading day name
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const today = new Date();
    const currentDay = today.getDay(); // 0 = Sunday, 6 = Saturday
    
    // If it's Saturday (6), go back to Friday (5)
    // If it's Sunday (0), go back to Friday (5)
    let lastTradingDay;
    if (currentDay === 0) { // Sunday
      lastTradingDay = 5; // Friday
    } else if (currentDay === 6) { // Saturday
      lastTradingDay = 5; // Friday
    } else {
      lastTradingDay = currentDay; // Weekday, use current day
    }
    
    const tradingDay = days[lastTradingDay];
    
    const prompt = `
Generate ONLY a 2-sentence lead paragraph for ${ticker}.

First sentence: ${companyNameFormatted} + general movement (up/down/unchanged) + time context + day of the week
Second sentence: What's driving momentum (technical factors only)

Rules:
- Use the exact company name format provided: "${companyNameFormatted}"
- INCLUDE the trading day (${tradingDay}) in the first sentence
- NO specific percentages
- NO exact prices
- Exactly 2 sentences
- Use general terms like "traded higher", "declined", "rose", "fell"
- Focus on technical factors like volume, momentum, sector trends
- DO NOT include quotes around the paragraph
- DO NOT use quotation marks at the beginning or end
- Return only the paragraph text, no formatting

Example format:
Nvidia Corp. (NASDAQ: NVDA) traded higher during regular trading hours on ${currentDay} as investors responded to strong technical indicators.

Price context: ${priceData ? `Change: ${priceData.changePercent}%, Volume: ${priceData.volume}` : 'No price data available'}

Generate the lead paragraph:`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0.3,
    });

    const lead = completion.choices[0].message?.content?.trim() || '';

    if (!lead) {
      return NextResponse.json({ error: 'Failed to generate lead paragraph.' }, { status: 500 });
    }

    console.log(`Generated lead paragraph for ${ticker}: ${lead}`);

    return NextResponse.json({ 
      lead,
      step: 2
    });
  } catch (error: any) {
    console.error('Error generating lead paragraph:', error);
    return NextResponse.json({ error: error.message || 'Failed to generate lead paragraph.' }, { status: 500 });
  }
} 