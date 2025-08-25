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
    
    // Debug: Log the raw API response
    console.log('Price Action Debug - Raw API Response:', JSON.stringify(data, null, 2));
    
    if (data && typeof data === 'object') {
      const quote = data[ticker.toUpperCase()];
      console.log('Price Action Debug - Quote Object:', JSON.stringify(quote, null, 2));
      if (quote && typeof quote === 'object') {
        const priceData = {
          last: quote.lastTradePrice || 0,
          change: quote.change || 0,
          change_percent: quote.changePercent || quote.change_percent || 0,
          volume: quote.volume || 0,
          high: quote.high || 0,
          low: quote.low || 0,
          open: quote.open || 0,
          close: quote.close || quote.lastTradePrice || 0,
          previousClose: quote.previousClose || 0,
          // Company name
          companyName: quote.companyStandardName || quote.name || ticker.toUpperCase(),
          // Extended hours data with multiple field name support
          extendedHoursPrice: quote.ethPrice || quote.extendedHoursPrice || quote.afterHoursPrice || quote.ahPrice || quote.extendedPrice || null,
          extendedHoursChange: quote.ethChange || quote.extendedHoursChange || quote.afterHoursChange || quote.ahChange || quote.extendedChange || null,
          extendedHoursChangePercent: quote.ethChangePercent || quote.extendedHoursChangePercent || quote.afterHoursChangePercent || quote.ahChangePercent || quote.extendedChangePercent || null,
          extendedHoursTime: quote.ethTime || quote.extendedHoursTime || quote.afterHoursTime || quote.ahTime || quote.extendedTime || null,
          extendedHoursVolume: quote.ethVolume || null
        };
        
        // Debug: Log the constructed price data
        console.log('Price Action Debug - Constructed Price Data:', JSON.stringify(priceData, null, 2));
        
        return priceData;
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error fetching price data:', error);
    return null;
  }
}

// Helper function to determine market session
function getMarketSession(): 'premarket' | 'regular' | 'afterhours' | 'closed' {
  const now = new Date();
  const nyTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour = nyTime.getHours();
  const minute = nyTime.getMinutes();
  const time = hour * 100 + minute;
  const day = nyTime.getDay();
  
  // Weekend
  if (day === 0 || day === 6) {
    return 'closed';
  }
  
  // Pre-market (4:00 AM - 9:30 AM ET)
  if (time >= 400 && time < 930) {
    return 'premarket';
  }
  
  // Regular trading (9:30 AM - 4:00 PM ET)
  if (time >= 930 && time < 1600) {
    return 'regular';
  }
  
  // After-hours (4:00 PM - 8:00 PM ET)
  if (time >= 1600 && time < 2000) {
    return 'afterhours';
  }
  
  // Closed (8:00 PM - 4:00 AM ET)
  return 'closed';
}

// Helper function to get current day name
function getCurrentDayName() {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[new Date().getDay()];
}

// Helper function to generate price action line
function generatePriceActionLine(ticker: string, priceData: any): string {
  if (!priceData) {
    return `<strong>${ticker} Price Action:</strong> Price data unavailable, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
  }

  const marketSession = getMarketSession();
  const dayName = getCurrentDayName();
  const companyName = priceData.companyName || ticker.toUpperCase();
  
  // Debug logging
  console.log('Price Action Debug - Market Session:', marketSession);
  console.log('Price Action Debug - Raw Price Data:', JSON.stringify(priceData, null, 2));
  
  // Regular session data
  const regularLast = parseFloat(priceData.close || priceData.last || 0).toFixed(2);
  const regularChangePercent = parseFloat(priceData.change_percent || 0).toFixed(2);
  const regularDisplayChangePercent = regularChangePercent.startsWith('-') ? regularChangePercent.substring(1) : regularChangePercent;
  
  // Extended hours data
  const hasExtendedHours = priceData.extendedHoursPrice;
  const extPrice = hasExtendedHours ? parseFloat(priceData.extendedHoursPrice || 0).toFixed(2) : null;
  const extChangePercent = priceData.extendedHoursChangePercent ? parseFloat(priceData.extendedHoursChangePercent || 0).toFixed(2) : null;
  const extDisplayChangePercent = extChangePercent && extChangePercent.startsWith('-') ? extChangePercent.substring(1) : extChangePercent;
  
  // Calculate extended hours change if we have the price but not the change percentage
  const regularClose = parseFloat(priceData.close || priceData.last || 0);
  const calculatedExtChangePercent = priceData.extendedHoursPrice && !priceData.extendedHoursChangePercent ? 
    ((parseFloat(priceData.extendedHoursPrice) - regularClose) / regularClose * 100).toFixed(2) : null;
  
  const finalExtChangePercent = extChangePercent || calculatedExtChangePercent;
  const finalHasExtendedHours = priceData.extendedHoursPrice && finalExtChangePercent;
  const finalExtDisplayChangePercent = finalExtChangePercent && finalExtChangePercent.startsWith('-') ? finalExtChangePercent.substring(1) : finalExtChangePercent;
  
  // Debug logging for extended hours data
  console.log('Price Action Debug - Extended Hours Price:', priceData.extendedHoursPrice);
  console.log('Price Action Debug - Extended Hours Change %:', extChangePercent);
  console.log('Price Action Debug - Calculated Change %:', calculatedExtChangePercent);
  console.log('Price Action Debug - Final Change %:', finalExtChangePercent);
  console.log('Price Action Debug - Regular Close:', regularClose);
  
  if (marketSession === 'regular') {
    return `<strong>${ticker} Price Action:</strong> ${companyName} shares were ${regularChangePercent.startsWith('-') ? 'down' : 'up'} ${regularDisplayChangePercent}% at $${regularLast} during regular trading hours on ${dayName}, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
  } else if (marketSession === 'premarket') {
    // For premarket, use the change_percent field directly if available
    if (priceData.change_percent && priceData.change_percent !== 0) {
      const premarketChangePercent = parseFloat(priceData.change_percent).toFixed(2);
      const premarketDisplayChangePercent = premarketChangePercent.startsWith('-') ? premarketChangePercent.substring(1) : premarketChangePercent;
      const premarketPrice = priceData.extendedHoursPrice ? parseFloat(priceData.extendedHoursPrice).toFixed(2) : parseFloat(priceData.last).toFixed(2);
      return `<strong>${ticker} Price Action:</strong> ${companyName} shares were ${premarketChangePercent.startsWith('-') ? 'down' : 'up'} ${premarketDisplayChangePercent}% at $${premarketPrice} during pre-market trading on ${dayName}, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
    } else if (finalHasExtendedHours && finalExtChangePercent && finalExtDisplayChangePercent) {
      return `<strong>${ticker} Price Action:</strong> ${companyName} shares were ${finalExtChangePercent.startsWith('-') ? 'down' : 'up'} ${finalExtDisplayChangePercent}% at $${extPrice} during pre-market trading on ${dayName}, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
    } else if (priceData.extendedHoursPrice) {
      // We have premarket price but no change percentage, calculate it manually
      const previousClose = parseFloat(priceData.previousClose || priceData.close || priceData.last || 0);
      const premarketPrice = parseFloat(priceData.extendedHoursPrice);
      if (previousClose > 0 && premarketPrice > 0) {
        const manualChangePercent = ((premarketPrice - previousClose) / previousClose * 100).toFixed(2);
        const manualDisplayChangePercent = manualChangePercent.startsWith('-') ? manualChangePercent.substring(1) : manualChangePercent;
        return `<strong>${ticker} Price Action:</strong> ${companyName} shares were ${manualChangePercent.startsWith('-') ? 'down' : 'up'} ${manualDisplayChangePercent}% at $${premarketPrice.toFixed(2)} during pre-market trading on ${dayName}, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
      }
    }
    return `<strong>${ticker} Price Action:</strong> ${companyName} shares were trading during pre-market hours on ${dayName}, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
  } else if (marketSession === 'afterhours') {
    if (finalHasExtendedHours && finalExtChangePercent && finalExtDisplayChangePercent) {
      // Show both regular session and after-hours changes
      const regularDirection = regularChangePercent.startsWith('-') ? 'fell' : 'rose';
      const extDirection = finalExtChangePercent.startsWith('-') ? 'down' : 'up';
      
      return `<strong>${ticker} Price Action:</strong> ${companyName} shares ${regularDirection} ${regularDisplayChangePercent}% to $${regularLast} during regular trading hours, and were ${extDirection} ${finalExtDisplayChangePercent}% at $${extPrice} during after-hours trading on ${dayName}, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
    } else {
      // Show regular session data with after-hours indication
      const regularDirection = regularChangePercent.startsWith('-') ? 'fell' : 'rose';
      return `<strong>${ticker} Price Action:</strong> ${companyName} shares ${regularDirection} ${regularDisplayChangePercent}% to $${regularLast} during regular trading hours on ${dayName}. The stock is currently trading in after-hours session, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
    }
  } else {
    // Market is closed, use last regular session data
    return `<strong>${ticker} Price Action:</strong> ${companyName} shares ${regularChangePercent.startsWith('-') ? 'fell' : 'rose'} ${regularDisplayChangePercent}% to $${regularLast} during regular trading hours on ${dayName}, according to <a href="https://pro.benzinga.com">Benzinga Pro</a>.`;
  }
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
    const { ticker, existingStory } = await request.json();
    
    if (!ticker || !existingStory) {
      return NextResponse.json({ error: 'Ticker and existing story are required.' }, { status: 400 });
    }

    // Get current price data for the price action line
    const priceData = await fetchPriceData(ticker);
    
    // Add price action line at the bottom
    const priceActionLine = generatePriceActionLine(ticker, priceData);
    
    // Combine story with price action line
    let completeStory = existingStory;
    
    // Remove existing Price Action lines if they exist
    completeStory = removeExistingPriceAction(completeStory);
    
    // Ensure proper placement of price action (Read Next will be handled by other APIs)
    completeStory = ensureProperPriceActionPlacement(completeStory, priceActionLine, '');
    
    // Preserve existing hyperlinks
    const finalStory = preserveHyperlinks(existingStory, completeStory);
    
    return NextResponse.json({ 
      story: finalStory,
      priceActionLine
    });
  } catch (error: any) {
    console.error('Error adding price action:', error);
    return NextResponse.json({ error: error.message || 'Failed to add price action.' }, { status: 500 });
  }
} 