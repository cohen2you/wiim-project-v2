import { NextResponse } from 'next/server';
import { preserveHyperlinks, ensureProperPriceActionPlacement } from '../../../../lib/hyperlink-preservation';

// Helper function to fetch price data
async function fetchPriceData(ticker: string) {
  try {
    const response = await fetch(`https://api.benzinga.com/api/v2/quoteDelayed?token=${process.env.BENZINGA_API_KEY}&symbols=${encodeURIComponent(ticker)}`);
    
    if (!response.ok) {
      console.error('Failed to fetch price data');
      return null;
    }
    
    const data = await response.json();
    
    if (data && typeof data === 'object') {
      const quote = data[ticker.toUpperCase()];
      if (quote && typeof quote === 'object') {
        const priceData = {
          last: quote.lastTradePrice || 0,
          change: quote.change || 0,
          change_percent: quote.changePercent || 0,
          volume: quote.volume || 0,
          high: quote.high || 0,
          low: quote.low || 0,
          open: quote.open || 0,
          previousClose: quote.previousClose || 0,
          afterHours: quote.afterHours || 0,
          afterHoursChange: quote.afterHoursChange || 0,
          afterHoursChangePercent: quote.afterHoursChangePercent || 0
        };
        return priceData;
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error fetching price data:', error);
    return null;
  }
}

// Helper function to generate price action line
function generatePriceActionLine(ticker: string, priceData: any): string {
  if (!priceData) {
    return `${ticker} Price Action: Price data unavailable, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
  }

  const dayName = getLastTradingDayName();
  
  // Format regular session data
  const regularLast = priceData.last.toFixed(2);
  const regularChange = priceData.change.toFixed(2);
  const regularChangePercent = priceData.change_percent.toFixed(2);
  const regularDisplayChangePercent = regularChangePercent.startsWith('-') ? regularChangePercent.substring(1) : regularChangePercent;
  
  // Check if there's after-hours data
  if (priceData.afterHours && priceData.afterHours !== 0) {
    const afterHoursChange = priceData.afterHoursChange.toFixed(2);
    const afterHoursChangePercent = priceData.afterHoursChangePercent.toFixed(2);
    const afterHoursDisplayChangePercent = afterHoursChangePercent.startsWith('-') ? afterHoursChangePercent.substring(1) : afterHoursChangePercent;
    
    const afterHoursDirection = afterHoursChangePercent.startsWith('-') ? 'fell' : 'rose';
    const regularDirection = regularChangePercent.startsWith('-') ? 'fell' : 'rose';
    return `${ticker} Price Action: ${ticker} shares ${regularDirection} ${regularDisplayChangePercent}% to $${regularLast} during regular trading hours on ${dayName}. The stock ${afterHoursDirection} ${afterHoursDisplayChangePercent}% to $${priceData.afterHours.toFixed(2)} in after-hours trading, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
  } else {
    // Market is closed, use last regular session data
    return `${ticker} Price Action: ${ticker} shares ${regularChangePercent.startsWith('-') ? 'fell' : 'rose'} ${regularDisplayChangePercent}% to $${regularLast} during regular trading hours on ${dayName}, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
  }
}

// Helper function to get the last trading day name
function getLastTradingDayName() {
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
  
  return days[lastTradingDay];
}

// Helper function to remove existing Price Action lines
function removeExistingPriceAction(story: string): string {
  // Remove Price Action lines (usually at the end, format: "TICKER Price Action: ...")
  story = story.replace(/[A-Z]+ Price Action:.*?(?=\n\n|\n[A-Z]|$)/g, '');
  
  // Clean up any double line breaks that might be left
  story = story.replace(/\n\n\n+/g, '\n\n');
  
  return story.trim();
}

export async function POST(request: Request) {
  try {
    const { ticker, story } = await request.json();
    
    if (!ticker || !story) {
      return NextResponse.json({ error: 'Ticker and story are required.' }, { status: 400 });
    }

    // Get current price data for the price action line
    const priceData = await fetchPriceData(ticker);
    
    // Add price action line at the bottom
    const priceActionLine = generatePriceActionLine(ticker, priceData);
    
    // Combine story with price action line
    let completeStory = story;
    
    // Remove existing Price Action lines if they exist
    completeStory = removeExistingPriceAction(completeStory);
    
    // Ensure proper placement of price action (Read Next will be handled by other APIs)
    completeStory = ensureProperPriceActionPlacement(completeStory, priceActionLine, '');
    
    // Preserve existing hyperlinks
    const finalStory = preserveHyperlinks(story, completeStory);
    
    return NextResponse.json({ 
      story: finalStory,
      priceActionLine
    });
  } catch (error: any) {
    console.error('Error adding price action:', error);
    return NextResponse.json({ error: error.message || 'Failed to add price action.' }, { status: 500 });
  }
} 