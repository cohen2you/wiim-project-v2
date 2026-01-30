import { NextResponse } from 'next/server';
import { aiProvider, AIProvider } from '@/lib/aiProvider';

const BENZINGA_API_KEY = process.env.BENZINGA_API_KEY;
const BZ_NEWS_URL = 'https://api.benzinga.com/api/v2/news';
const BZ_QUOTE_URL = 'https://api.benzinga.com/api/v2/quoteDelayed';

// Helper to scrape news URL
async function scrapeNewsUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) return null;

    const html = await response.text();
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return text.substring(0, 5000);
  } catch (error) {
    console.error('[QUICK STORY] Error scraping URL:', error);
    return null;
  }
}

// Story templates
const STORY_TEMPLATES = {
  'earnings-reaction': {
    name: 'Earnings Reaction',
    focus: 'Focus on earnings results, analyst reactions, and price movement following earnings.',
  },
  'price-movement': {
    name: 'Price Movement',
    focus: 'Focus on today\'s price movement, market context, and what\'s driving the stock.',
  },
  'sector-context': {
    name: 'Sector Context',
    focus: 'Focus on how the stock relates to its sector and related stocks, providing broader market context.',
  },
  'custom': {
    name: 'Custom',
    focus: 'Generate a story based on the custom focus provided.',
  },
};

// Fetch price data from Benzinga
async function fetchPriceData(ticker: string) {
  try {
    if (!BENZINGA_API_KEY) {
      console.log('[QUICK STORY] BENZINGA_API_KEY not configured');
      return null;
    }

    const url = `${BZ_QUOTE_URL}?token=${BENZINGA_API_KEY}&symbols=${encodeURIComponent(ticker)}`;
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      console.error(`[QUICK STORY] Failed to fetch price data for ${ticker}:`, response.status);
      return null;
    }

    const data = await response.json();
    if (data && data[ticker]) {
      const quote = data[ticker];
      // Calculate regular session change from close vs previousClose
      const regularClose = quote.close || quote.lastTradePrice || quote.last || null;
      const previousClose = quote.previousClosePrice || quote.previous_close || null;
      let regularChangePercent = quote.changePercent || quote.change_percent || null;
      
      // If we have close and previousClose, calculate regular session change
      if (regularClose && previousClose && previousClose > 0) {
        const closeNum = typeof regularClose === 'number' ? regularClose : parseFloat(regularClose);
        const prevCloseNum = typeof previousClose === 'number' ? previousClose : parseFloat(previousClose);
        if (!isNaN(closeNum) && !isNaN(prevCloseNum)) {
          regularChangePercent = ((closeNum - prevCloseNum) / prevCloseNum) * 100;
        }
      }
      
      // Extended hours data (multiple field name variations)
      const extendedHoursPrice = quote.ethPrice || quote.extendedHoursPrice || quote.afterHoursPrice || quote.ahPrice || quote.extendedPrice || null;
      const extendedHoursChangePercent = quote.ethChangePercent || quote.extendedHoursChangePercent || quote.afterHoursChangePercent || quote.ahChangePercent || quote.extendedChangePercent || null;
      
      return {
        symbol: quote.symbol || ticker,
        name: quote.name || ticker,
        lastTradePrice: quote.lastTradePrice || quote.last || null,
        changePercent: quote.changePercent || quote.change_percent || null,
        close: regularClose,
        previousClosePrice: previousClose,
        regularChangePercent: regularChangePercent,
        extendedHoursPrice: extendedHoursPrice,
        extendedHoursChangePercent: extendedHoursChangePercent,
      };
    }
    return null;
  } catch (error) {
    console.error(`[QUICK STORY] Error fetching price data for ${ticker}:`, error);
    return null;
  }
}

// Fetch recent Benzinga articles, filtered by price action date
async function fetchRecentArticles(ticker: string, count: number = 5, priceActionDate?: Date): Promise<any[]> {
  try {
    if (!BENZINGA_API_KEY) {
      return [];
    }

    // Use price action date if provided, otherwise use current date
    const targetDate = priceActionDate || new Date();
    
    // Fetch articles from the price action date and up to 5 days before (to ensure we have enough articles)
    const dateFrom = new Date(targetDate);
    dateFrom.setDate(dateFrom.getDate() - 5);
    const dateFromStr = dateFrom.toISOString().slice(0, 10);
    
    // Set dateTo to the day after price action date to include all articles from that day
    const dateTo = new Date(targetDate);
    dateTo.setDate(dateTo.getDate() + 1);
    const dateToStr = dateTo.toISOString().slice(0, 10);

    const url = `${BZ_NEWS_URL}?token=${BENZINGA_API_KEY}&tickers=${encodeURIComponent(ticker)}&items=${count * 5}&fields=headline,title,created,url,channels,teaser&accept=application/json&displayOutput=full&dateFrom=${dateFromStr}&dateTo=${dateToStr}`;

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      console.error('[QUICK STORY] Failed to fetch articles:', response.status);
      return [];
    }

    const data = await response.json();
    console.log(`[QUICK STORY] API response for ${ticker}:`, {
      isArray: Array.isArray(data),
      length: Array.isArray(data) ? data.length : 'N/A',
      dateRange: `${dateFromStr} to ${dateToStr}`,
    });
    
    if (!Array.isArray(data)) {
      console.warn(`[QUICK STORY] API returned non-array response for ${ticker}`);
      return [];
    }

    // Filter out press releases and filter by date relevance
    const prChannelNames = ['press releases', 'press-releases', 'pressrelease', 'pr'];
    const normalize = (str: string) => str.toLowerCase().replace(/[-_]/g, ' ');
    
    // Get the price action date as a string for comparison (YYYY-MM-DD)
    const priceActionDateStr = targetDate.toISOString().slice(0, 10);
    
    // Get dates for comparison
    const dayBefore = new Date(targetDate);
    dayBefore.setDate(dayBefore.getDate() - 1);
    const dayBeforeStr = dayBefore.toISOString().slice(0, 10);
    
    const twoDaysBefore = new Date(targetDate);
    twoDaysBefore.setDate(twoDaysBefore.getDate() - 2);
    const twoDaysBeforeStr = twoDaysBefore.toISOString().slice(0, 10);

    let filteredArticles = data
      .filter((item: any) => {
        // Filter out press releases
        if (Array.isArray(item.channels) && item.channels.some((ch: any) =>
          typeof ch.name === 'string' && prChannelNames.includes(normalize(ch.name))
        )) {
          return false;
        }
        
        // Filter out insight stories and opinion articles
        const articleUrl = item.url || '';
        if (articleUrl.startsWith('https://www.benzinga.com/insights/')) {
          return false;
        }
        if (articleUrl.startsWith('https://www.benzinga.com/Opinion/')) {
          return false;
        }
        
        return true; // Include all articles within the date range
      })
      .sort((a: any, b: any) => {
        // Sort by date: same day as price action first, then day before, then older
        const aDate = a.created ? new Date(a.created).toISOString().slice(0, 10) : '';
        const bDate = b.created ? new Date(b.created).toISOString().slice(0, 10) : '';
        
        // Priority: same day > day before > 2 days before > older
        const getPriority = (date: string) => {
          if (date === priceActionDateStr) return 1;
          if (date === dayBeforeStr) return 2;
          if (date === twoDaysBeforeStr) return 3;
          return 4;
        };
        
        const aPriority = getPriority(aDate);
        const bPriority = getPriority(bDate);
        
        if (aPriority !== bPriority) return aPriority - bPriority;
        
        // If same priority, sort by date descending (newest first)
        return new Date(b.created || 0).getTime() - new Date(a.created || 0).getTime();
      })
      .slice(0, count)
      .map((item: any) => ({
        headline: item.headline || item.title || 'No headline',
        url: item.url || '',
        date: item.created || '',
        teaser: item.teaser || null,
      }));

    console.log(`[QUICK STORY] Fetched ${filteredArticles.length} articles for ${ticker}, price action date: ${priceActionDateStr}`);
    if (filteredArticles.length > 0) {
      console.log(`[QUICK STORY] Article dates: ${filteredArticles.map((a: any) => new Date(a.date).toISOString().slice(0, 10)).join(', ')}`);
    } else if (data.length > 0) {
      console.warn(`[QUICK STORY] ${data.length} articles returned from API but all were filtered out (likely all press releases)`);
    } else {
      console.warn(`[QUICK STORY] No articles found for ${ticker} in date range ${dateFromStr} to ${dateToStr}`);
    }

    // Fallback: If no articles found in the date range, try a wider range (30 days)
    if (filteredArticles.length === 0) {
      console.log(`[QUICK STORY] No articles found in 5-day range, trying 30-day range for ${ticker}`);
      const fallbackDateFrom = new Date(targetDate);
      fallbackDateFrom.setDate(fallbackDateFrom.getDate() - 30);
      const fallbackDateFromStr = fallbackDateFrom.toISOString().slice(0, 10);
      
      const fallbackUrl = `${BZ_NEWS_URL}?token=${BENZINGA_API_KEY}&tickers=${encodeURIComponent(ticker)}&items=${count * 5}&fields=headline,title,created,url,channels,teaser&accept=application/json&displayOutput=full&dateFrom=${fallbackDateFromStr}&dateTo=${dateToStr}`;
      
      try {
        const fallbackResponse = await fetch(fallbackUrl, {
          headers: { Accept: 'application/json' },
        });
        
        if (fallbackResponse.ok) {
          const fallbackData = await fallbackResponse.json();
          if (Array.isArray(fallbackData) && fallbackData.length > 0) {
            console.log(`[QUICK STORY] Found ${fallbackData.length} articles in 30-day range`);
            
            filteredArticles = fallbackData
              .filter((item: any) => {
                // Filter out press releases
                if (Array.isArray(item.channels) && item.channels.some((ch: any) =>
                  typeof ch.name === 'string' && prChannelNames.includes(normalize(ch.name))
                )) {
                  return false;
                }
                
                // Filter out insight stories and opinion articles
                const articleUrl = item.url || '';
                if (articleUrl.startsWith('https://www.benzinga.com/insights/')) {
                  return false;
                }
                if (articleUrl.startsWith('https://www.benzinga.com/Opinion/')) {
                  return false;
                }
                
                return true;
              })
              .sort((a: any, b: any) => {
                // Sort by date descending (newest first)
                return new Date(b.created || 0).getTime() - new Date(a.created || 0).getTime();
              })
              .slice(0, count)
              .map((item: any) => ({
                headline: item.headline || item.title || 'No headline',
                url: item.url || '',
                date: item.created || '',
                teaser: item.teaser || null,
              }));
            
            console.log(`[QUICK STORY] Using ${filteredArticles.length} articles from fallback search`);
          }
        }
      } catch (fallbackError) {
        console.error(`[QUICK STORY] Fallback search failed for ${ticker}:`, fallbackError);
      }
    }

    return filteredArticles;
  } catch (error) {
    console.error('[QUICK STORY] Error fetching articles:', error);
    return [];
  }
}

// Fetch consensus ratings from Benzinga
async function fetchConsensusRatings(ticker: string) {
  try {
    if (!BENZINGA_API_KEY) {
      return null;
    }

    const params = new URLSearchParams();
    params.append('token', BENZINGA_API_KEY);
    params.append('parameters[tickers]', ticker);
    
    const consensusUrl = `https://api.benzinga.com/api/v1/consensus-ratings?${params.toString()}`;
    
    const consensusRes = await fetch(consensusUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
    });
      
    if (consensusRes.ok) {
      const consensusData = await consensusRes.json();
      
      let extractedConsensus = null;
      
      if (Array.isArray(consensusData)) {
        extractedConsensus = consensusData.find((item: any) => 
          item.ticker?.toUpperCase() === ticker.toUpperCase() || 
          item.symbol?.toUpperCase() === ticker.toUpperCase()
        ) || consensusData[0];
      } else if (consensusData.consensus) {
        extractedConsensus = consensusData.consensus;
      } else if (consensusData[ticker.toUpperCase()]) {
        extractedConsensus = consensusData[ticker.toUpperCase()];
      } else if (consensusData.ratings && Array.isArray(consensusData.ratings)) {
        extractedConsensus = consensusData.ratings.find((item: any) => 
          item.ticker?.toUpperCase() === ticker.toUpperCase() || 
          item.symbol?.toUpperCase() === ticker.toUpperCase()
        ) || consensusData.ratings[0];
      } else {
        extractedConsensus = consensusData;
      }
      
      if (extractedConsensus) {
        const consensusPriceTarget = 
          extractedConsensus.consensus_price_target ?? 
          extractedConsensus.consensusPriceTarget ??
          extractedConsensus.price_target ??
          extractedConsensus.priceTarget ??
          extractedConsensus.target ??
          extractedConsensus.pt ??
          extractedConsensus.consensus_target ??
          null;
        
        return {
          consensus_rating: extractedConsensus.consensus_rating || extractedConsensus.consensusRating || extractedConsensus.rating || null,
          consensus_price_target: consensusPriceTarget,
          total_analyst_count: extractedConsensus.total_analyst_count || extractedConsensus.totalAnalystCount || extractedConsensus.analyst_count || extractedConsensus.count || null,
        };
      }
    }
    
    return null;
  } catch (error) {
    console.error(`[QUICK STORY] Error fetching consensus ratings for ${ticker}:`, error);
    return null;
  }
}

// Fetch most recent earnings results (with actuals) or upcoming earnings (with estimates)
async function fetchRecentEarningsResults(ticker: string) {
  try {
    if (!BENZINGA_API_KEY) {
      return null;
    }

    const today = new Date();
    const dateTo = today.toISOString().split('T')[0];
    const dateFrom = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // Last 90 days
    const dateToUpcoming = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // Next 90 days

    // Fetch both past and upcoming earnings
    const url = 'https://api.benzinga.com/api/v2/calendar/earnings' +
      `?token=${BENZINGA_API_KEY}` +
      `&parameters[tickers]=${encodeURIComponent(ticker)}` +
      `&parameters[date_from]=${dateFrom}` +
      `&parameters[date_to]=${dateToUpcoming}`;

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      console.error(`[QUICK STORY] Failed to fetch earnings for ${ticker}:`, response.status);
      return null;
    }

    const data = await response.json();
    if (!data || !data.earnings || !Array.isArray(data.earnings)) {
      return null;
    }

    // Find the most recent earnings with actual results (past earnings)
    const earningsWithActuals = data.earnings
      .filter((item: any) => {
        const earningsDate = item.date || item.earnings_date || item.earningsDate;
        if (!earningsDate) return false;
        
        // Check if this earnings report has actual results (not just estimates)
        const hasActuals = (item.eps || item.eps_actual || item.epsActual || item.eps_actual_reported) ||
                          (item.revenue || item.revenue_actual || item.revenueActual || item.revenue_actual_reported);
        
        if (!hasActuals) return false;
        
        // Only include past earnings (not future)
        const date = new Date(earningsDate);
        return date <= today;
      })
      .sort((a: any, b: any) => {
        const dateA = new Date(a.date || a.earnings_date || a.earningsDate || 0);
        const dateB = new Date(b.date || b.earnings_date || b.earningsDate || 0);
        return dateB.getTime() - dateA.getTime(); // Most recent first
      });

    // If we have recent earnings with actuals, use that
    if (earningsWithActuals.length > 0) {
      const mostRecent = earningsWithActuals[0];
      const earningsDate = mostRecent.date || mostRecent.earnings_date || mostRecent.earningsDate;
      
      // Extract EPS data
      const epsActual = mostRecent.eps || mostRecent.eps_actual || mostRecent.epsActual || 
                       mostRecent.eps_actual_reported || mostRecent.actual_eps || mostRecent.reported_eps || null;
      const epsEst = mostRecent.eps_est || mostRecent.epsEst || mostRecent.eps_estimate || 
                    mostRecent.epsEstimate || mostRecent.estimated_eps || mostRecent.eps_consensus || null;
      const epsPrior = mostRecent.eps_prior || mostRecent.epsPrior || mostRecent.eps_prev || 
                      mostRecent.previous_eps || null;
      
      // Extract Revenue data
      const revenueActual = mostRecent.revenue || mostRecent.revenue_actual || mostRecent.revenueActual || 
                           mostRecent.revenue_actual_reported || mostRecent.actual_revenue || mostRecent.reported_revenue || null;
      const revenueEst = mostRecent.revenue_est || mostRecent.revenueEst || mostRecent.revenue_estimate || 
                        mostRecent.revenueEstimate || mostRecent.estimated_revenue || mostRecent.revenue_consensus || null;
      const revenuePrior = mostRecent.revenue_prior || mostRecent.revenuePrior || mostRecent.rev_prev || 
                          mostRecent.previous_revenue || null;

      // Calculate beats/misses
      let epsBeatMiss = null;
      if (epsActual !== null && epsEst !== null) {
        const actual = typeof epsActual === 'string' ? parseFloat(epsActual) : epsActual;
        const estimate = typeof epsEst === 'string' ? parseFloat(epsEst) : epsEst;
        if (!isNaN(actual) && !isNaN(estimate)) {
          epsBeatMiss = actual > estimate ? 'Beat' : actual < estimate ? 'Miss' : 'Meet';
        }
      }

      let revenueBeatMiss = null;
      if (revenueActual !== null && revenueEst !== null) {
        const actual = typeof revenueActual === 'string' ? parseFloat(revenueActual) : revenueActual;
        const estimate = typeof revenueEst === 'string' ? parseFloat(revenueEst) : revenueEst;
        if (!isNaN(actual) && !isNaN(estimate)) {
          revenueBeatMiss = actual > estimate ? 'Beat' : actual < estimate ? 'Miss' : 'Meet';
        }
      }

      // Calculate surprise percentages
      let epsSurprisePct = null;
      if (epsActual !== null && epsEst !== null && epsEst !== 0) {
        const actual = typeof epsActual === 'string' ? parseFloat(epsActual) : epsActual;
        const estimate = typeof epsEst === 'string' ? parseFloat(epsEst) : epsEst;
        if (!isNaN(actual) && !isNaN(estimate) && estimate !== 0) {
          epsSurprisePct = ((actual - estimate) / Math.abs(estimate)) * 100;
        }
      }

      let revenueSurprisePct = null;
      if (revenueActual !== null && revenueEst !== null && revenueEst !== 0) {
        const actual = typeof revenueActual === 'string' ? parseFloat(revenueActual) : revenueActual;
        const estimate = typeof revenueEst === 'string' ? parseFloat(revenueEst) : revenueEst;
        if (!isNaN(actual) && !isNaN(estimate) && estimate !== 0) {
          revenueSurprisePct = ((actual - estimate) / Math.abs(estimate)) * 100;
        }
      }

      console.log(`[QUICK STORY] Found recent earnings with actuals for ${ticker}, date: ${earningsDate}`);
      
      return {
        type: 'recent',
        date: earningsDate,
        eps_actual: epsActual,
        eps_estimate: epsEst,
        eps_prior: epsPrior,
        eps_beat_miss: epsBeatMiss,
        eps_surprise_pct: epsSurprisePct,
        revenue_actual: revenueActual,
        revenue_estimate: revenueEst,
        revenue_prior: revenuePrior,
        revenue_beat_miss: revenueBeatMiss,
        revenue_surprise_pct: revenueSurprisePct,
      };
    }

    // If no recent earnings with actuals, look for upcoming earnings with estimates
    const upcomingEarnings = data.earnings
      .filter((item: any) => {
        const earningsDate = item.date || item.earnings_date || item.earningsDate;
        if (!earningsDate) return false;
        
        // Check if this earnings has estimates
        const hasEstimates = (item.eps_est || item.epsEst || item.eps_estimate || item.epsEstimate || item.estimated_eps) ||
                           (item.revenue_est || item.revenueEst || item.revenue_estimate || item.revenueEstimate || item.estimated_revenue);
        
        if (!hasEstimates) return false;
        
        // Only include future earnings
        const date = new Date(earningsDate);
        return date > today;
      })
      .sort((a: any, b: any) => {
        const dateA = new Date(a.date || a.earnings_date || a.earningsDate || 0);
        const dateB = new Date(b.date || b.earnings_date || b.earningsDate || 0);
        return dateA.getTime() - dateB.getTime(); // Earliest upcoming first
      });

    if (upcomingEarnings.length > 0) {
      const nextEarnings = upcomingEarnings[0];
      const earningsDate = nextEarnings.date || nextEarnings.earnings_date || nextEarnings.earningsDate;
      
      const epsEst = nextEarnings.eps_est || nextEarnings.epsEst || nextEarnings.eps_estimate || 
                    nextEarnings.epsEstimate || nextEarnings.estimated_eps || null;
      const epsPrior = nextEarnings.eps_prior || nextEarnings.epsPrior || nextEarnings.eps_prev || 
                      nextEarnings.previous_eps || null;
      
      const revenueEst = nextEarnings.revenue_est || nextEarnings.revenueEst || nextEarnings.revenue_estimate || 
                        nextEarnings.revenueEstimate || nextEarnings.estimated_revenue || null;
      const revenuePrior = nextEarnings.revenue_prior || nextEarnings.revenuePrior || nextEarnings.rev_prev || 
                          nextEarnings.previous_revenue || null;

      console.log(`[QUICK STORY] Found upcoming earnings with estimates for ${ticker}, date: ${earningsDate}`);
      
      return {
        type: 'upcoming',
        date: earningsDate,
        eps_estimate: epsEst,
        eps_prior: epsPrior,
        revenue_estimate: revenueEst,
        revenue_prior: revenuePrior,
      };
    }

    return null;
  } catch (error) {
    console.error(`[QUICK STORY] Error fetching earnings results for ${ticker}:`, error);
    return null;
  }
}

// Fetch related stock data
async function fetchRelatedStockData(tickers: string[]): Promise<Record<string, any>> {
  if (!tickers || tickers.length === 0 || !BENZINGA_API_KEY) {
    return {};
  }

  try {
    const symbols = tickers.join(',');
    const url = `${BZ_QUOTE_URL}?token=${BENZINGA_API_KEY}&symbols=${encodeURIComponent(symbols)}`;
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      return {};
    }

    const data = await response.json();
    const result: Record<string, any> = {};

    tickers.forEach((ticker) => {
      if (data && data[ticker]) {
        const quote = data[ticker];
        result[ticker] = {
          name: quote.name || ticker,
          price: quote.lastTradePrice || quote.last || null,
          change: quote.changePercent || quote.change_percent || null,
          volume: quote.volume || quote.vol || null,
          previousClose: quote.previousClosePrice || quote.previous_close || null,
        };
      }
    });

    return result;
  } catch (error) {
    console.error('[QUICK STORY] Error fetching related stock data:', error);
    return {};
  }
}

// Helper function to determine market session
function getMarketSession(): 'premarket' | 'regular' | 'afterhours' | 'closed' {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  
  const parts = formatter.formatToParts(now);
  const dayName = parts.find(part => part.type === 'weekday')?.value ?? 'Sunday';
  const hourString = parts.find(part => part.type === 'hour')?.value ?? '00';
  const minuteString = parts.find(part => part.type === 'minute')?.value ?? '00';
  
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayIndex = dayNames.indexOf(dayName);
  const hour = parseInt(hourString, 10);
  const minute = parseInt(minuteString, 10);
  const time = hour * 100 + minute;
  
  if (dayIndex === 0 || dayIndex === 6) return 'closed';
  if (time >= 400 && time < 930) return 'premarket';
  if (time >= 930 && time < 1600) return 'regular';
  if (time >= 1600 && time < 2000) return 'afterhours';
  return 'closed';
}

// Format price action text
// Get the date when price action occurred (previous trading day if early morning)
function getPriceActionDate(): { date: Date; dayName: string; isToday: boolean; isYesterday: boolean; temporalContext: string } {
  const now = new Date();
  
  // Get ET time components
  const etFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    weekday: 'long',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour12: false,
  });
  
  const parts = etFormatter.formatToParts(now);
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  const dayOfWeek = parts.find(p => p.type === 'weekday')?.value || 'Monday';
  const day = parseInt(parts.find(p => p.type === 'day')?.value || '1', 10);
  const month = parseInt(parts.find(p => p.type === 'month')?.value || '1', 10);
  const year = parseInt(parts.find(p => p.type === 'year')?.value || '2024', 10);
  
  const time = hour * 100 + minute;
  
  // If it's before 9:30 AM ET, the price action is from the previous trading day
  let priceActionDate = new Date(year, month - 1, day);
  let isToday = true;
  let isYesterday = false;
  
  if (time < 930) {
    // Before market open, price action is from yesterday
    priceActionDate.setDate(priceActionDate.getDate() - 1);
    isToday = false;
    isYesterday = true;
    
    // If yesterday was Sunday, go back to Friday
    if (priceActionDate.getDay() === 0) {
      priceActionDate.setDate(priceActionDate.getDate() - 2);
    }
    // If yesterday was Saturday, go back to Friday
    if (priceActionDate.getDay() === 6) {
      priceActionDate.setDate(priceActionDate.getDate() - 1);
    }
  }
  
  const dayName = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
  }).format(priceActionDate);
  
  let temporalContext = '';
  if (isToday && time >= 930 && time < 1600) {
    temporalContext = 'earlier today during regular trading hours';
  } else if (isToday && time >= 1600) {
    temporalContext = 'today';
  } else if (isYesterday) {
    temporalContext = 'yesterday';
  } else {
    temporalContext = `on ${dayName}`;
  }
  
  return {
    date: priceActionDate,
    dayName,
    isToday,
    isYesterday,
    temporalContext,
  };
}

function formatPriceAction(quote: any, ticker: string): string {
  if (!quote || !quote.lastTradePrice) {
    return '';
  }

  const symbol = quote.symbol || ticker.toUpperCase();
  const companyName = quote.name || symbol;
  const marketSession = getMarketSession();
  const priceActionDate = getPriceActionDate();
  const dayOfWeek = priceActionDate.dayName;
  
  // Regular session data
  const regularClose = quote.close || quote.lastTradePrice || quote.last;
  const regularChange = quote.regularChangePercent !== null && quote.regularChangePercent !== undefined 
    ? quote.regularChangePercent 
    : (quote.changePercent || quote.change_percent || 0);
  const regularPrice = typeof regularClose === 'number' 
    ? regularClose.toFixed(2) 
    : parseFloat(regularClose).toFixed(2);
  const regularChangeAbs = Math.abs(regularChange).toFixed(2);
  const regularDirection = regularChange > 0 ? 'up' : regularChange < 0 ? 'down' : 'unchanged';
  
  // Extended hours data
  const hasExtendedHours = quote.extendedHoursPrice && quote.extendedHoursChangePercent !== null && quote.extendedHoursChangePercent !== undefined;
  const extPrice = hasExtendedHours 
    ? (typeof quote.extendedHoursPrice === 'number' ? quote.extendedHoursPrice.toFixed(2) : parseFloat(quote.extendedHoursPrice).toFixed(2))
    : null;
  const extChange = hasExtendedHours ? quote.extendedHoursChangePercent : null;
  const extChangeAbs = extChange !== null ? Math.abs(extChange).toFixed(2) : null;
  const extDirection = extChange !== null ? (extChange > 0 ? 'up' : 'down') : null;
  
  // Build price action text with temporal context
  if (marketSession === 'afterhours' && hasExtendedHours) {
    // Show both regular session and after-hours
    return `${symbol} was ${regularDirection} ${regularChangeAbs}% at $${regularPrice} during regular trading hours, and was ${extDirection} ${extChangeAbs}% at $${extPrice} in after-hours trading on ${dayOfWeek}`;
  } else if (marketSession === 'afterhours') {
    // After-hours but no extended hours data, just show regular session
    return `${symbol} was ${regularDirection} ${regularChangeAbs}% at $${regularPrice} during regular trading hours on ${dayOfWeek}`;
  } else {
    // Regular session or closed
    if (regularChange !== 0) {
      return `${symbol} was ${regularDirection} ${regularChangeAbs}% at $${regularPrice} on ${dayOfWeek}`;
    }
    return `${symbol} was trading at $${regularPrice} on ${dayOfWeek}`;
  }
}

// Get temporal context for prompt
function getTemporalContext(): string {
  const priceActionDate = getPriceActionDate();
  const now = new Date();
  const etTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour = etTime.getHours();
  const minute = etTime.getMinutes();
  const time = hour * 100 + minute;
  
  let context = '';
  if (priceActionDate.isToday && time >= 930 && time < 1600) {
    context = 'The price action occurred earlier today during regular trading hours.';
  } else if (priceActionDate.isToday && time >= 1600) {
    context = 'The price action occurred today.';
  } else if (priceActionDate.isYesterday) {
    context = 'The price action occurred yesterday (the previous trading day).';
  } else {
    context = `The price action occurred on ${priceActionDate.dayName} (the previous trading day).`;
  }
  
  return context;
}

// Format earnings data for prompt
function formatEarningsData(earnings: any, consensusRatings?: any): string {
  if (!earnings) return '';

  const formatRevenue = (val: number | string | null) => {
    if (val === null || val === undefined) return 'N/A';
    const num = typeof val === 'string' ? parseFloat(val) : val;
    if (isNaN(num)) return 'N/A';
    const millions = num / 1000000;
    if (millions >= 1000) {
      return `$${(millions / 1000).toFixed(2)}B`;
    }
    return `$${millions.toFixed(2)}M`;
  };

  // Format earnings date for display
  const formatEarningsDate = (dateStr: string | null | undefined): string => {
    if (!dateStr) return 'N/A';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  let text = '\n\nEARNINGS DATA:\n';
  
  if (earnings.type === 'recent') {
    // Recent earnings with actual results
    const formattedDate = formatEarningsDate(earnings.date);
    text += `Earnings Report Date: ${formattedDate}\n`;
    text += `Status: RECENT REPORT (Actual results available)\n`;
    text += `CRITICAL: You MUST use the exact date "${formattedDate}" in your first paragraph when mentioning the earnings report. DO NOT use "recently" or vague date references - use the actual date.\n\n`;

    if (earnings.eps_actual !== null && earnings.eps_estimate !== null) {
      const epsActual = typeof earnings.eps_actual === 'string' 
        ? parseFloat(earnings.eps_actual).toFixed(2) 
        : earnings.eps_actual.toFixed(2);
      const epsEst = typeof earnings.eps_estimate === 'string' 
        ? parseFloat(earnings.eps_estimate).toFixed(2) 
        : earnings.eps_estimate.toFixed(2);
      
      text += `EPS: Reported $${epsActual} vs. Estimate $${epsEst}`;
      if (earnings.eps_beat_miss) {
        text += ` (${earnings.eps_beat_miss})`;
      }
      if (earnings.eps_surprise_pct !== null) {
        const surprise = earnings.eps_surprise_pct > 0 ? '+' : '';
        text += ` - ${surprise}${earnings.eps_surprise_pct.toFixed(1)}% surprise`;
      }
      if (earnings.eps_prior !== null) {
        const prior = typeof earnings.eps_prior === 'string' 
          ? parseFloat(earnings.eps_prior).toFixed(2) 
          : earnings.eps_prior.toFixed(2);
        text += ` (Prior Period: $${prior})`;
      }
      text += '\n';
    }

    if (earnings.revenue_actual !== null && earnings.revenue_estimate !== null) {
      text += `Revenue: Reported ${formatRevenue(earnings.revenue_actual)} vs. Estimate ${formatRevenue(earnings.revenue_estimate)}`;
      if (earnings.revenue_beat_miss) {
        text += ` (${earnings.revenue_beat_miss})`;
      }
      if (earnings.revenue_surprise_pct !== null) {
        const surprise = earnings.revenue_surprise_pct > 0 ? '+' : '';
        text += ` - ${surprise}${earnings.revenue_surprise_pct.toFixed(1)}% surprise`;
      }
      if (earnings.revenue_prior !== null) {
        text += ` (Prior Period: ${formatRevenue(earnings.revenue_prior)})`;
      }
      text += '\n';
    }
  } else if (earnings.type === 'upcoming') {
    // Upcoming earnings with estimates
    const formattedDate = formatEarningsDate(earnings.date);
    text += `Upcoming Earnings Date: ${formattedDate}\n`;
    text += `Status: UPCOMING REPORT (Estimates only)\n`;
    text += `CRITICAL: You MUST use the exact date "${formattedDate}" in your first paragraph when mentioning the upcoming earnings report. DO NOT use "recently" or vague date references - use the actual date.\n\n`;

    if (earnings.eps_estimate !== null) {
      const epsEst = typeof earnings.eps_estimate === 'string' 
        ? parseFloat(earnings.eps_estimate).toFixed(2) 
        : earnings.eps_estimate.toFixed(2);
      
      text += `EPS Estimate: $${epsEst}`;
      if (earnings.eps_prior !== null) {
        const prior = typeof earnings.eps_prior === 'string' 
          ? parseFloat(earnings.eps_prior).toFixed(2) 
          : earnings.eps_prior.toFixed(2);
        const change = parseFloat(epsEst) - parseFloat(prior);
        const changePct = prior != 0 ? ((change / Math.abs(parseFloat(prior))) * 100) : 0;
        const changeText = change > 0 ? `up ${changePct.toFixed(1)}%` : change < 0 ? `down ${Math.abs(changePct).toFixed(1)}%` : 'unchanged';
        text += ` (${changeText} from prior period: $${prior})`;
      }
      text += '\n';
    }

    if (earnings.revenue_estimate !== null) {
      text += `Revenue Estimate: ${formatRevenue(earnings.revenue_estimate)}`;
      if (earnings.revenue_prior !== null) {
        const priorNum = typeof earnings.revenue_prior === 'string' ? parseFloat(earnings.revenue_prior) : earnings.revenue_prior;
        const estNum = typeof earnings.revenue_estimate === 'string' ? parseFloat(earnings.revenue_estimate) : earnings.revenue_estimate;
        const change = estNum - priorNum;
        const changePct = priorNum != 0 ? ((change / Math.abs(priorNum)) * 100) : 0;
        const changeText = change > 0 ? `up ${changePct.toFixed(1)}%` : change < 0 ? `down ${Math.abs(changePct).toFixed(1)}%` : 'unchanged';
        text += ` (${changeText} from prior period: ${formatRevenue(earnings.revenue_prior)})`;
      }
      text += '\n';
    }

    // Add analyst consensus if available
    if (consensusRatings) {
      text += '\nAnalyst Consensus:\n';
      if (consensusRatings.consensus_rating) {
        text += `Consensus Rating: ${consensusRatings.consensus_rating}\n`;
      }
      if (consensusRatings.consensus_price_target) {
        const target = typeof consensusRatings.consensus_price_target === 'string' 
          ? parseFloat(consensusRatings.consensus_price_target).toFixed(2)
          : consensusRatings.consensus_price_target.toFixed(2);
        text += `Consensus Price Target: $${target}\n`;
      }
      if (consensusRatings.total_analyst_count) {
        text += `Analyst Coverage: ${consensusRatings.total_analyst_count} analysts\n`;
      }
    }
  }

  return text;
}

// Build prompt based on template and parameters
function buildPrompt(
  ticker: string,
  companyName: string,
  priceAction: string,
  articles: any[],
  relatedStocks: Record<string, any>,
  template: string,
  wordCount: number,
  customFocus?: string,
  earningsData?: any,
  priceData?: any,
  consensusRatings?: any,
  customSourceUrls?: string[],
  customSourceContent?: Record<string, string>
): string {
  const templateInfo = STORY_TEMPLATES[template as keyof typeof STORY_TEMPLATES] || STORY_TEMPLATES['price-movement'];
  const focus = template === 'custom' && customFocus ? customFocus : templateInfo.focus;

  // Build custom source verification section if custom template
  let customSourceVerification = '';
  if (template === 'custom') {
    if (customSourceUrls && customSourceUrls.length > 0) {
      customSourceVerification = `\n\nCUSTOM SOURCE URLS FOR VERIFICATION:\n`;
      customSourceUrls.forEach((url, index) => {
        customSourceVerification += `${index + 1}. ${url}\n`;
        if (customSourceContent && customSourceContent[url]) {
          const content = customSourceContent[url].substring(0, 2000);
          customSourceVerification += `   Content: ${content}...\n`;
        }
      });
    }
    customSourceVerification += `\n\nCRITICAL VERIFICATION REQUIREMENTS FOR CUSTOM TEMPLATE:\n`;
    customSourceVerification += `- Before using ANY information from custom focus, you MUST verify it matches information in:\n`;
    customSourceVerification += `  1. Articles listed below (MOST AUTHORITATIVE - use these as primary source)\n`;
    customSourceVerification += `  2. API data provided above (price, earnings, consensus)\n`;
    if (customSourceUrls && customSourceUrls.length > 0) {
      customSourceVerification += `  3. Scraped source content above (if URLs provided)\n`;
    }
    customSourceVerification += `- If custom focus contains information that CANNOT be verified from these sources:\n`;
    customSourceVerification += `  * DO NOT use it, OR\n`;
    if (customSourceUrls && customSourceUrls.length > 0) {
      customSourceVerification += `  * If a source URL is provided, use it but note: "according to [source]"\n`;
    } else {
      customSourceVerification += `  * Mark it as unverified or omit it\n`;
    }
    customSourceVerification += `- If information in custom focus CONFLICTS with articles/API data, use the articles/API data (they are authoritative)\n`;
    customSourceVerification += `- Example: If custom focus says "Project Marcus" but articles say "Project Genie", use "Project Genie" from articles\n`;
    customSourceVerification += `- Information Hierarchy (most authoritative first):\n`;
    customSourceVerification += `  1. API data (price, earnings, consensus) - ALWAYS use this\n`;
    customSourceVerification += `  2. Articles listed below - ALWAYS use this\n`;
    if (customSourceUrls && customSourceUrls.length > 0) {
      customSourceVerification += `  3. Scraped source content (if URLs provided) - Use this\n`;
      customSourceVerification += `  4. Custom focus text - ONLY use if verified by sources above\n`;
    } else {
      customSourceVerification += `  3. Custom focus text - ONLY use if verified by sources above\n`;
    }
    customSourceVerification += `\n`;
  }

  let articlesText = '';
  if (articles.length > 0) {
    const priceActionDate = getPriceActionDate();
    const priceActionDateStr = priceActionDate.date.toISOString().slice(0, 10);
    
    articlesText = `\n\nRECENT ARTICLES (MANDATORY: You MUST create a hyperlink for ALL ${articles.length} articles below - include each one in your story):\n`;
    articlesText += `IMPORTANT: The price action occurred on ${priceActionDate.dayName}. Articles are listed below with their publication dates.\n`;
    articlesText += `CRITICAL TEMPORAL CONTEXT RULES:\n`;
    articlesText += `- Articles marked "[SAME DAY AS PRICE ACTION]" are reporting on events from ${priceActionDate.dayName} - you can reference the day if relevant\n`;
    articlesText += `- Articles marked "[X DAYS BEFORE PRICE ACTION]" are providing context about events that happened BEFORE the article was published - use vague temporal references like "recently", "earlier this week", "in recent days", "earlier" - DO NOT use the article's publication day name (e.g., "on Monday") as that refers to when the article was published, not when the event happened\n\n`;
    
    articles.forEach((article, index) => {
      const articleDate = article.date ? new Date(article.date) : null;
      const articleDateStr = articleDate ? articleDate.toISOString().slice(0, 10) : '';
      const articleDayName = articleDate ? new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(articleDate) : 'Unknown date';
      
      // Determine if article is from same day, day before, or older
      let dateContext = '';
      if (articleDateStr === priceActionDateStr) {
        dateContext = `[SAME DAY AS PRICE ACTION - ${priceActionDate.dayName}]`;
      } else {
        const daysDiff = Math.floor((priceActionDate.date.getTime() - (articleDate?.getTime() || 0)) / (1000 * 60 * 60 * 24));
        if (daysDiff === 1) {
          dateContext = `[1 DAY BEFORE PRICE ACTION]`;
        } else if (daysDiff > 1) {
          dateContext = `[${daysDiff} DAYS BEFORE PRICE ACTION - MUST PROVIDE TEMPORAL CONTEXT]`;
        }
      }
      
      articlesText += `${index + 1}. ${article.headline}: ${article.url}\n   Published: ${articleDayName} ${dateContext}`;
      if (article.teaser) {
        // Truncate teaser to first 200 characters to keep it concise
        const teaser = article.teaser.length > 200 
          ? article.teaser.substring(0, 200) + '...' 
          : article.teaser;
        articlesText += `\n   Excerpt: ${teaser}`;
      }
      articlesText += '\n';
    });
    articlesText += `\n\nCRITICAL HYPERLINK REQUIREMENTS:
- You MUST create a hyperlink for ALL ${articles.length} articles listed above
- At least ONE hyperlink MUST appear in your FIRST paragraph (the lead paragraph)
- Each hyperlink should use three sequential words from the article headline, BUT:
  * DO NOT use the exact headline text as your hyperlink (e.g., if headline is "Can You Buy NASA Stock?", don't hyperlink "Can You Buy NASA Stock?")
  * DO NOT use generic phrases like "recent reports", "according to reports", "recent news", etc. as hyperlink text
  * Instead, use three sequential words that naturally fit into your sentence context
  * The hyperlink text should read as part of your narrative, not as a headline or reference
- Embed hyperlinks naturally throughout the article - distribute them across different paragraphs
- Count your hyperlinks before submitting: you need exactly ${articles.length} hyperlinks total
- CRITICAL: Write naturally as a journalist - DO NOT explicitly reference articles or reports
- DO NOT use phrases like "as reported", "as discussed", "according to a report", "as covered in an article", "this article", "the report", "in a report", "recent reports", "according to reports", "recent news", etc.
- Simply write the narrative and embed hyperlinks seamlessly within the text - the hyperlink text should flow naturally as part of the sentence
- For older articles (marked "[X DAYS BEFORE PRICE ACTION]"): These articles provide context about events that happened earlier. Use vague temporal references like "recently", "earlier this week", "in recent days", "earlier", etc. - DO NOT use the specific day name (e.g., "on Monday") as the article is reporting on events that occurred before its publication date. The day name refers to when the article was published, not when the event happened.
- Example of GOOD hyperlink embedding: "The company's stock rebounded following a major hardware delivery for its upcoming Neutron rocket."
- Example of BAD hyperlink embedding: "This development was covered in a Rocket Lab Stock Rebounds article."
- Example of BAD hyperlink embedding: "Recent reports indicate the company is expanding."
- Example of BAD hyperlink embedding: "Can You Buy NASA Stock? explores investment options."\n`;
  }

  let relatedStocksText = '';
  if (Object.keys(relatedStocks).length > 0) {
    relatedStocksText = '\n\nRELATED STOCKS (provide market context - emphasize percentage moves and technical context, not just prices):\n';
    Object.entries(relatedStocks).forEach(([ticker, data]) => {
      const changeText = data.change !== null 
        ? `${data.change > 0 ? '+' : ''}${data.change.toFixed(2)}%`
        : 'N/A';
      const volumeText = data.volume ? ` (Volume: ${typeof data.volume === 'number' ? data.volume.toLocaleString() : data.volume})` : '';
      // Determine exchange from ticker format or default to NASDAQ
      const exchange = ticker.includes(':') ? ticker.split(':')[0] : 'NASDAQ';
      const tickerOnly = ticker.includes(':') ? ticker.split(':')[1] : ticker;
      relatedStocksText += `- ${data.name} (${exchange}: ${tickerOnly}): ${changeText}${volumeText}\n`;
    });
    relatedStocksText += '\nIMPORTANT: When mentioning related stocks, focus on their percentage moves and market context rather than absolute stock prices. Use phrases like "up X%", "down Y%", "trading higher/lower", "gaining/losing momentum" rather than stating specific prices.\n';
    relatedStocksText += 'CRITICAL: On the FIRST mention of each related stock, you MUST use the FULL company name with ticker: <strong>Company Name</strong> (NASDAQ: TICKER) or <strong>Company Name</strong> (NYSE: TICKER). Example: <strong>Microsoft Corporation</strong> (NASDAQ: MSFT).\n';
  }

  let earningsText = '';
  if (template === 'earnings-reaction' && earningsData) {
    earningsText = formatEarningsData(earningsData, consensusRatings);
  }

  const temporalContext = getTemporalContext();
  const priceActionDate = getPriceActionDate();
  
  return `You are a financial journalist writing a ${wordCount}-word article about ${companyName} (${ticker}).

${focus}
${customSourceVerification}
CURRENT PRICE ACTION:
${priceAction || 'Price data not available'}
${temporalContext}
IMPORTANT: The price action occurred on ${priceActionDate.dayName}. Always refer to this day by name (e.g., "on ${priceActionDate.dayName}") rather than using relative terms like "yesterday" or "today".
${priceData && priceData.extendedHoursPrice && priceData.extendedHoursChangePercent !== null ? `\nNOTE: The stock closed ${priceData.regularChangePercent > 0 ? 'up' : 'down'} ${Math.abs(priceData.regularChangePercent || 0).toFixed(2)}% during regular trading hours, but is ${priceData.extendedHoursChangePercent > 0 ? 'up' : 'down'} ${Math.abs(priceData.extendedHoursChangePercent).toFixed(2)}% in after-hours trading. When describing the stock movement, mention both the regular session performance and after-hours movement if they differ significantly.` : ''}
${earningsText}
${articlesText}

${relatedStocksText}

REQUIREMENTS:
${template === 'earnings-reaction' && earningsData ? `
EARNINGS REACTION TEMPLATE - CRITICAL INSTRUCTIONS:
- This is an EARNINGS REACTION story - the earnings data provided above MUST be prominently featured
- CRITICAL: You MUST include the exact earnings date (e.g., "on November 10" or "on November 10, 2025") in your FIRST paragraph - DO NOT use "recently" or vague date references
- If earnings data shows "RECENT REPORT": Lead with the actual EPS and revenue results, beats/misses, and surprise percentages, and include the exact report date
- If earnings data shows "UPCOMING REPORT": Lead with the estimates, analyst expectations, and comparisons to prior periods, and include the exact earnings date
- Include specific numbers: EPS ($X.XX), Revenue ($X.XXB or $X.XXM), beat/miss status, surprise percentages
- Compare to estimates and prior periods when available
- Analyst consensus data (if provided) should be mentioned to provide context
- The earnings data is the PRIMARY focus of this story - make it the centerpiece, not just a mention
- REQUIRED: At least ONE hyperlink MUST appear in the FIRST paragraph alongside the earnings information

` : ''}
1. CRITICAL HYPERLINK REQUIREMENT (HIGHEST PRIORITY):
   - You MUST create a hyperlink for EVERY article provided above - no exceptions
   - If ${articles.length} articles are provided, you must include ${articles.length} hyperlinks in your story
   - REQUIRED: At least ONE hyperlink MUST appear in the FIRST paragraph (lead paragraph) - this is MANDATORY, not optional
   - For earnings reaction stories: The first paragraph must include BOTH the earnings date AND at least one hyperlink
   - For each article, create a hyperlink using THREE SEQUENTIAL WORDS from the article headline, BUT:
     * DO NOT use the exact headline text as your hyperlink (e.g., if headline is "Can You Buy NASA Stock?", don't hyperlink "Can You Buy NASA Stock?")
     * DO NOT use generic phrases like "recent reports", "according to reports", "recent news", etc. as hyperlink text
     * Instead, use three sequential words that naturally fit into your sentence context
     * The hyperlink text should read as part of your narrative, not as a headline or reference
   - Format: <a href="URL">three sequential words</a> (use HTML format, NOT markdown)
   - Do NOT mention "Benzinga" or any source name when linking
   - Embed each hyperlink naturally within your sentences throughout the article
   - Distribute the hyperlinks throughout the article - don't cluster them all in one paragraph
   - Before submitting, count your hyperlinks: you need exactly ${articles.length} hyperlinks total
   - CRITICAL WRITING STYLE: Write as a normal journalist - DO NOT explicitly reference articles, reports, or sources
   - DO NOT use phrases like: "as reported", "as discussed", "according to a report", "as covered in an article", "this article", "the report", "in a report", "as noted in", "which was discussed in", "this development was covered in", "recent reports", "according to reports", "recent news", etc.
   - DO NOT use the exact headline text as hyperlink text - extract three sequential words that fit naturally into your sentence
   - Simply write the narrative naturally and embed hyperlinks seamlessly - the hyperlink text should flow as part of the sentence, not be called out as a reference or headline
   - For older articles (marked "[X DAYS BEFORE PRICE ACTION]"): These articles provide context about events that happened earlier. Use vague temporal references like "recently", "earlier this week", "in recent days", "earlier", etc. - DO NOT use the specific day name (e.g., "on Monday") as the article is reporting on events that occurred before its publication date. The day name refers to when the article was published, not when the event happened.
   - Example of GOOD: "The company's stock rebounded following a major hardware delivery for its upcoming Neutron rocket."
   - Example of BAD: "This development was covered in a Rocket Lab Stock Rebounds article."
   - Example of BAD: "Recent reports indicate the company is expanding."
   - Example of BAD: "Can You Buy NASA Stock? explores investment options."
2. Word count: Aim for ${wordCount} words, but prioritize DATA DENSITY over hitting the exact count.
   - If you've covered all the key information and there's nothing new to add, it's acceptable to fall short (minimum ${Math.floor(wordCount * 0.8)} words)
   - DO NOT add fluff, repetition, or filler content just to reach the word count
   - Every sentence must provide NEW information or context - avoid repeating facts already stated
   - If a section would just repeat information from earlier paragraphs, either skip it or provide genuinely new data
3. Start with the company name and ticker: <strong>${companyName}</strong> (${ticker.includes(':') ? ticker : `NASDAQ: ${ticker}`})
   - Use HTML <strong> tags to bold ONLY the company name, NOT the ticker
   - CRITICAL: On the FIRST mention of ANY company (main company or related stocks), you MUST include:
     * The FULL company name (e.g., "Microsoft Corporation", "NVIDIA Corporation", not just "Microsoft" or "NVIDIA")
     * The ticker in parentheses (e.g., "(NASDAQ: MSFT)", "(NASDAQ: NVDA)")
     * Bold the company name: <strong>Microsoft Corporation</strong> (NASDAQ: MSFT)
   - After the first mention, use the shortened company name without bolding or ticker (e.g., "Microsoft", "NVIDIA")
   - This applies to ALL companies mentioned in the article (main company and related stocks)
4. COMPANY NAME FORMATTING: 
   - FIRST MENTION: Use HTML <strong> tags to bold ONLY the company name, NOT the ticker. CRITICAL RULES:
     * Use the FULL company name (e.g., "Microsoft Corporation", "NVIDIA Corporation", "Apple Inc.", "Meta Platforms, Inc.")
     * ALWAYS include the ticker in parentheses: (NASDAQ: XXX) or (NYSE: XXX)
     * Examples:
       - <strong>Microsoft Corporation</strong> (NASDAQ: MSFT)
       - <strong>NVIDIA Corporation</strong> (NASDAQ: NVDA)
       - <strong>Apple Inc.</strong> (NASDAQ: AAPL)
       - <strong>Meta Platforms, Inc.</strong> (NASDAQ: META)
   - SUBSEQUENT MENTIONS: After the first mention, use the shortened company name without bolding or ticker (e.g., "Microsoft", "NVIDIA", "Apple", "Meta Platforms")
   - Do NOT use markdown ** syntax - always use HTML <strong> tags
   - Apply this rule to ALL companies mentioned in the article (main company and related stocks)
   - If you're unsure of the full company name, use the name provided in the related stocks data or make a reasonable assumption (e.g., add "Corporation", "Inc.", "Ltd." as appropriate)
5. PROMINENT PEOPLE FORMATTING:
   - FIRST MENTION: Use HTML <strong> tags to bold the full name of prominent people (CEOs, executives, investors, analysts, etc.) on their first mention
   - Examples: <strong>Mark Zuckerberg</strong>, <strong>Satya Nadella</strong>, <strong>Jensen Huang</strong>, <strong>Dan Loeb</strong>
   - SUBSEQUENT MENTIONS: After the first mention, use the name without bolding (e.g., "Zuckerberg", "Nadella", "Huang")
   - Do NOT use markdown ** syntax - always use HTML <strong> tags
6. STRUCTURE AND FORMATTING:
   - Break up long sections with subhead placeholders using this format: ## Section: [Subhead Title]
   - Use 2-3 subhead placeholders throughout the article to improve readability and SEO
   - Use bullet points (<ul> and <li> tags) for lists, key points, or comparisons when appropriate
   - Example bullet format: <ul><li>First point</li><li>Second point</li></ul>
   - Balance paragraphs with subheads and bullet points - don't make it all one format
7. RELATED STOCKS CONTEXT (if provided):
   - Focus on percentage moves and market momentum, NOT absolute stock prices
   - Use phrases like "Microsoft's stock is up 0.59%" or "NVIDIA is trading lower, down 0.30%"
   - Provide technical context: "gaining momentum", "trading higher", "under pressure", etc.
   - Avoid stating specific prices like "$436.12" - instead emphasize the movement and percentage change
   - Use the percentage data to show market trends and sector performance
8. PRICE MOVEMENT REPORTING:
   - If the stock had different performance during regular trading hours vs after-hours trading, mention BOTH
   - Example: "Meta Platforms was up 2.5% during regular trading hours, but declined 0.50% in after-hours trading"
   - Always distinguish between regular session performance and after-hours movement when they differ significantly
   - Use the price action data provided to accurately report both regular session and after-hours performance
9. TEMPORAL ACCURACY - CRITICAL:
   - The price action occurred ${temporalContext.toLowerCase()}
   - When describing the stock movement, ALWAYS use the day of the week name instead of relative terms like "yesterday" or "today"
   - Use the format: "on [DayName]" (e.g., "on Thursday", "on Friday", "on Monday")
   - The price action day is: ${priceActionDate.dayName}
   - Examples:
     * "surged on ${priceActionDate.dayName}", "climbed on ${priceActionDate.dayName}", "was up on ${priceActionDate.dayName}"
     * "experienced a significant surge on ${priceActionDate.dayName}"
     * "gained momentum on ${priceActionDate.dayName}"
   - DO NOT use: "yesterday", "today", "earlier today" - always use the specific day name: "${priceActionDate.dayName}"
   - Always match the temporal language to when the price action actually occurred, using the day name provided above
10. Use professional, journalistic tone suitable for financial news.
11. Focus on current events and recent developments.
12. PRICE ACTION SECTION:
   - If you include a "## Section: Price Action" placeholder, provide ONLY new information not already covered
   - DO NOT repeat the price movement that was already mentioned in the lead paragraph
   - If the price action was already fully described earlier, you can skip adding content to this section or provide only the section marker
   - The price action line at the end is sufficient - don't repeat it in the section content
13. End with a price action line: "${priceAction || `${ticker} price data not available`}, according to Benzinga Pro data."
14. Format the article with proper paragraph breaks using <p> tags.
15. Do NOT include "Also Read" or "Read Next" sections.
16. Do NOT mention "Benzinga" or any source name when referencing the articles - just embed the links naturally.
17. CRITICAL: Write naturally as a journalist - DO NOT explicitly mention that you're referencing articles or reports. Simply write the story and embed hyperlinks seamlessly within the narrative. Avoid phrases like "as reported", "as discussed", "according to a report", "this article", "the report", etc.
17. DATA DENSITY RULE: Every paragraph must introduce NEW information. If you find yourself repeating facts, data points, or analysis already mentioned, either:
    - Skip that content entirely
    - Or provide a different angle/context that adds value
    - Avoid phrases like "underscores", "highlights", "reflects" when they're just restating what was already said
    - DO NOT add filler sentences just to reach word count - quality over quantity
    - If you've covered all key information and there's nothing new to add, it's better to end the article than add repetitive fluff

Generate the article now:`;
}

// Multi-factor analysis generation (4-pass iterative method)
async function generateMultiFactorStory(
  ticker: string,
  companyName: string,
  priceAction: string,
  articles: any[],
  relatedStockData: Record<string, any>,
  wordCount: number,
  priceData: any,
  provider: AIProvider
): Promise<string> {
  console.log(`[QUICK STORY] Multi-factor analysis mode enabled for ${ticker}`);
  
  const relatedStocksList = Object.keys(relatedStockData);
  const priceActionDate = getPriceActionDate();
  const temporalContext = getTemporalContext();
  
  // Fetch earnings/events data for related stocks
  console.log(`[QUICK STORY] Fetching earnings/events data for ${relatedStocksList.length} related stocks...`);
  const relatedStocksEarningsData: Record<string, any> = {};
  const relatedStocksConsensus: Record<string, any> = {};
  
  for (const relatedTicker of relatedStocksList) {
    try {
      const [earnings, consensus] = await Promise.all([
        fetchRecentEarningsResults(relatedTicker),
        fetchConsensusRatings(relatedTicker),
      ]);
      if (earnings) relatedStocksEarningsData[relatedTicker] = earnings;
      if (consensus) relatedStocksConsensus[relatedTicker] = consensus;
    } catch (error) {
      console.error(`[QUICK STORY] Error fetching data for ${relatedTicker}:`, error);
    }
  }
  
  // Pass 1: Generate initial draft with primary factor
  console.log(`[QUICK STORY] Pass 1/4: Generating initial structure...`);
  const primaryFactor = relatedStocksList.length > 0 ? relatedStocksList[0] : null;
  const primaryData = primaryFactor ? relatedStockData[primaryFactor] : null;
  const primaryEarnings = primaryFactor ? relatedStocksEarningsData[primaryFactor] : null;
  
  let primaryFactorText = '';
  if (primaryFactor && primaryData) {
    primaryFactorText = `\nPRIMARY FACTOR:\n`;
    primaryFactorText += `${primaryData.name || primaryFactor} (${primaryFactor}): ${primaryData.change !== null ? `${primaryData.change > 0 ? '+' : ''}${primaryData.change.toFixed(2)}%` : 'N/A'}\n`;
    if (primaryEarnings) {
      if (primaryEarnings.type === 'recent') {
        primaryFactorText += `Recent Earnings: EPS ${primaryEarnings.eps_actual !== null ? `$${typeof primaryEarnings.eps_actual === 'string' ? parseFloat(primaryEarnings.eps_actual).toFixed(2) : primaryEarnings.eps_actual.toFixed(2)}` : 'N/A'} vs Estimate ${primaryEarnings.eps_estimate !== null ? `$${typeof primaryEarnings.eps_estimate === 'string' ? parseFloat(primaryEarnings.eps_estimate).toFixed(2) : primaryEarnings.eps_estimate.toFixed(2)}` : 'N/A'} (${primaryEarnings.eps_beat_miss || 'N/A'})\n`;
      } else if (primaryEarnings.type === 'upcoming') {
        primaryFactorText += `Upcoming Earnings: EPS Estimate ${primaryEarnings.eps_estimate !== null ? `$${typeof primaryEarnings.eps_estimate === 'string' ? parseFloat(primaryEarnings.eps_estimate).toFixed(2) : primaryEarnings.eps_estimate.toFixed(2)}` : 'N/A'}\n`;
      }
    }
  }
  
  let initialPrompt = `You are a financial journalist writing a ${wordCount}-word article about ${companyName} (${ticker}).

CURRENT PRICE ACTION:
${priceAction || 'Price data not available'}
${temporalContext}
IMPORTANT: The price action occurred on ${priceActionDate.dayName}. Always refer to this day by name (e.g., "on ${priceActionDate.dayName}") rather than using relative terms like "yesterday" or "today".
${primaryFactorText}
REQUIREMENTS:
1. Write a concise article explaining why ${ticker} is moving based on the price action${primaryFactor ? ` and how ${primaryData?.name || primaryFactor}'s performance relates` : ''}.
2. Use SEO subheadings: ## Section: [Subhead Title]
3. Start with: <strong>${companyName}</strong> (${ticker.includes(':') ? ticker : `NASDAQ: ${ticker}`})
4. Use HTML <strong> tags for company names on first mention
5. End with price action line: "${priceAction || `${ticker} price data not available`}, according to Benzinga Pro data."
6. Use <p> tags for paragraphs
7. Aim for ${wordCount} words but prioritize data density

Generate the initial article:`;

  const initialResult = await aiProvider.generateCompletion(
    [
      {
        role: 'system',
        content: 'You are a professional financial journalist writing concise, data-dense articles for a financial news website.',
      },
      {
        role: 'user',
        content: initialPrompt,
      },
    ],
    {
      model: provider === 'gemini' ? 'gemini-3-pro-preview' : 'gpt-4o',
      temperature: 0.3,
      maxTokens: Math.max(wordCount * 2, 1500),
    },
    provider
  );

  let draft = initialResult.content.trim().replace(/^```(?:markdown|html)?\s*/i, '').replace(/\s*```$/i, '');

  // Pass 2: Integrate all related factors with earnings/events data
  if (relatedStocksList.length > 0) {
    console.log(`[QUICK STORY] Pass 2/4: Integrating all ${relatedStocksList.length} related factors with earnings data...`);
    
    const formatEarningsForPrompt = (ticker: string, earnings: any): string => {
      if (!earnings) return '';
      let text = '';
      if (earnings.type === 'recent') {
        text += `Recent Earnings Report (${earnings.date || 'N/A'}):\n`;
        if (earnings.eps_actual !== null && earnings.eps_estimate !== null) {
          const epsActual = typeof earnings.eps_actual === 'string' ? parseFloat(earnings.eps_actual).toFixed(2) : earnings.eps_actual.toFixed(2);
          const epsEst = typeof earnings.eps_estimate === 'string' ? parseFloat(earnings.eps_estimate).toFixed(2) : earnings.eps_estimate.toFixed(2);
          text += `  EPS: $${epsActual} vs Estimate $${epsEst} (${earnings.eps_beat_miss || 'N/A'})`;
          if (earnings.eps_surprise_pct !== null) {
            text += ` - ${earnings.eps_surprise_pct > 0 ? '+' : ''}${earnings.eps_surprise_pct.toFixed(1)}% surprise`;
          }
          text += '\n';
        }
        if (earnings.revenue_actual !== null && earnings.revenue_estimate !== null) {
          const formatRev = (val: number | string) => {
            const num = typeof val === 'string' ? parseFloat(val) : val;
            const millions = num / 1000000;
            return millions >= 1000 ? `$${(millions / 1000).toFixed(2)}B` : `$${millions.toFixed(2)}M`;
          };
          text += `  Revenue: ${formatRev(earnings.revenue_actual)} vs Estimate ${formatRev(earnings.revenue_estimate)} (${earnings.revenue_beat_miss || 'N/A'})\n`;
        }
      } else if (earnings.type === 'upcoming') {
        text += `Upcoming Earnings (${earnings.date || 'N/A'}):\n`;
        if (earnings.eps_estimate !== null) {
          text += `  EPS Estimate: $${typeof earnings.eps_estimate === 'string' ? parseFloat(earnings.eps_estimate).toFixed(2) : earnings.eps_estimate.toFixed(2)}\n`;
        }
      }
      return text;
    };

    const relatedStocksText = relatedStocksList.map((relatedTicker) => {
      const data = relatedStockData[relatedTicker];
      const earnings = relatedStocksEarningsData[relatedTicker];
      const consensus = relatedStocksConsensus[relatedTicker];
      const changeText = data.change !== null 
        ? `${data.change > 0 ? '+' : ''}${data.change.toFixed(2)}%`
        : 'N/A';
      
      let stockInfo = `${data.name || relatedTicker} (${relatedTicker}): ${changeText}\n`;
      if (earnings) {
        stockInfo += formatEarningsForPrompt(relatedTicker, earnings);
      }
      if (consensus && consensus.consensus_rating) {
        stockInfo += `Analyst Consensus: ${consensus.consensus_rating}`;
        if (consensus.consensus_price_target) {
          stockInfo += `, Price Target: $${typeof consensus.consensus_price_target === 'string' ? parseFloat(consensus.consensus_price_target).toFixed(2) : consensus.consensus_price_target.toFixed(2)}`;
        }
        stockInfo += '\n';
      }
      return stockInfo;
    }).join('\n');

    const refinePrompt = `You are refining a financial news article. Below is the current draft, followed by detailed data for ALL related companies that need to be integrated.

CURRENT DRAFT:
${draft}

ALL RELATED COMPANIES DATA TO INTEGRATE:
${relatedStocksText}

CRITICAL INSTRUCTIONS:
1. Integrate ALL the related companies above into your article with their earnings/consensus data
2. Each related company should get its own dedicated section explaining their results
3. Include specific metrics: earnings beats/misses, revenue numbers, analyst ratings
4. Show how each company's performance relates to ${ticker}
5. Maintain the existing structure but expand with detailed analysis
6. Keep SEO subheadings: ## Section: [Subhead Title]
7. Use specific numbers and data points from the earnings/consensus information
8. Aim for ${wordCount} words but prioritize depth and data density
9. End with: "${priceAction || `${ticker} price data not available`}, according to Benzinga Pro data."

Refine the article to integrate all factors with detailed data:`;

    const refineResult = await aiProvider.generateCompletion(
      [
        {
          role: 'system',
          content: 'You are a professional financial journalist refining an article to integrate multiple companies with their earnings and analyst data. Focus on including specific metrics and data points.',
        },
        {
          role: 'user',
          content: refinePrompt,
        },
      ],
      {
        model: provider === 'gemini' ? 'gemini-3-pro-preview' : 'gpt-4o',
        temperature: 0.3,
        maxTokens: Math.max(wordCount * 3, 2000),
      },
      provider
    );

    draft = refineResult.content.trim().replace(/^```(?:markdown|html)?\s*/i, '').replace(/\s*```$/i, '');
  }

  // Pass 3: Deep causal analysis - build read-through logic
  console.log(`[QUICK STORY] Pass 3/4: Building deep causal analysis and read-through logic...`);
  
  const causalAnalysisPrompt = `You are performing a deep causal analysis on a financial news article. The current article includes multiple related companies, but it needs STRONGER causal connections explaining HOW each factor affects ${ticker}.

CURRENT ARTICLE:
${draft}

RELATED COMPANIES AFFECTING ${ticker}:
${relatedStocksList.map((ticker) => relatedStockData[ticker]?.name || ticker).join(', ')}

CRITICAL CAUSAL ANALYSIS REQUIREMENTS:
1. For EACH related company, you MUST explain the SPECIFIC read-through effect on ${ticker}
2. Build explicit causal chains using this format:
   - "[Related Company] result → sector impact → ${ticker} effect"
   - Example: "Microsoft's AI capex acceleration creates read-through pressure on Meta because..."
3. Use specific causal language:
   - "creates read-through pressure"
   - "signals sector weakness/strength"
   - "spills into [sector/stock]"
   - "converges to create"
   - "ripples through"
   - "amplifies concerns about"
4. Show CONVERGENCE: Explain how these factors COMBINE to create sector pressure/momentum
5. Each related company section should start with HOW their results affect ${ticker}, not just what happened
6. Add a section explaining the convergence: "## Section: How Factors Converge" or similar
7. Prohibit generic statements - every connection must be specific and causal
8. Maintain all existing data and metrics
9. Keep SEO subheadings: ## Section: [Subhead Title]
10. End with: "${priceAction || `${ticker} price data not available`}, according to Benzinga Pro data."

Rewrite the article with deep causal analysis and explicit read-through logic:`;

  const causalResult = await aiProvider.generateCompletion(
    [
      {
        role: 'system',
        content: 'You are a senior financial analyst performing deep causal analysis. You must build explicit read-through logic showing how each factor creates specific effects on the primary stock. Use causal language and show convergence of factors.',
      },
      {
        role: 'user',
        content: causalAnalysisPrompt,
      },
    ],
    {
      model: provider === 'gemini' ? 'gemini-3-pro-preview' : 'gpt-4o',
      temperature: 0.3,
      maxTokens: Math.max(wordCount * 3, 2500),
    },
    provider
  );

  draft = causalResult.content.trim().replace(/^```(?:markdown|html)?\s*/i, '').replace(/\s*```$/i, '');

  // Pass 4: Final refinement - lead paragraph and overall polish
  console.log(`[QUICK STORY] Pass 4/4: Final refinement of lead and overall polish...`);
  
  const finalRefinePrompt = `You are performing final refinement on a multi-factor financial news article. The article has good causal analysis, but the lead paragraph needs to synthesize ALL factors and the overall article needs polish.

CURRENT ARTICLE:
${draft}

RELATED COMPANIES:
${relatedStocksList.map((ticker) => relatedStockData[ticker]?.name || ticker).join(', ')}

FINAL REFINEMENT REQUIREMENTS:
1. Rewrite the FIRST paragraph (lead) to:
   - Mention ALL related companies that affect ${ticker}
   - Explain how their results CONVERGE to create sector pressure/momentum
   - Use specific language: "cascade of read-throughs", "convergence of signals", "risk-off shift", "sector-wide pressure"
   - Show the causal chain in the lead: how factors combine to affect ${ticker}
   - Be 3-4 sentences, data-dense
   - Start with: <strong>${companyName}</strong> (${ticker.includes(':') ? ticker : `NASDAQ: ${ticker}`})
2. Review the body sections:
   - Ensure each section has strong causal language
   - Verify read-through logic is explicit
   - Check that convergence is explained
3. Maintain all specific metrics and data points
4. Keep SEO subheadings: ## Section: [Subhead Title]
5. Ensure smooth flow between sections
6. End with: "${priceAction || `${ticker} price data not available`}, according to Benzinga Pro data."

Provide the fully refined article:`;

  const finalRefineResult = await aiProvider.generateCompletion(
    [
      {
        role: 'system',
        content: 'You are a professional financial journalist performing final refinement on a multi-factor analysis article. Focus on synthesizing all factors in the lead and ensuring strong causal connections throughout.',
      },
      {
        role: 'user',
        content: finalRefinePrompt,
      },
    ],
    {
      model: provider === 'gemini' ? 'gemini-3-pro-preview' : 'gpt-4o',
      temperature: 0.3,
      maxTokens: Math.max(wordCount * 3, 2500),
    },
    provider
  );

  const finalStory = finalRefineResult.content.trim().replace(/^```(?:markdown|html)?\s*/i, '').replace(/\s*```$/i, '');
  
  console.log(`[QUICK STORY] Multi-factor analysis complete (4 passes)`);
  return finalStory;
}

export async function POST(req: Request) {
  try {
    const {
      ticker,
      wordCount = 400,
      template = 'price-movement',
      relatedStocks = [],
      customFocus,
      customSourceUrls,
      multiFactorMode = false,
      aiProvider: providerOverride,
    } = await req.json();

    if (!ticker || !ticker.trim()) {
      return NextResponse.json({ error: 'Ticker is required' }, { status: 400 });
    }

    const tickerUpper = ticker.toUpperCase().trim();
    const provider: AIProvider = (providerOverride as AIProvider) || 'openai';

    console.log(`[QUICK STORY] Generating story for ${tickerUpper}, template: ${template}, word count: ${wordCount}`);

    // Get price action date to filter articles
    const priceActionDate = getPriceActionDate();
    
    // Fetch data in parallel
    const [priceData, articles, earningsData] = await Promise.all([
      fetchPriceData(tickerUpper),
      fetchRecentArticles(tickerUpper, 5, priceActionDate.date),
      template === 'earnings-reaction' ? fetchRecentEarningsResults(tickerUpper) : Promise.resolve(null),
    ]);

    // Fetch related stock data if provided
    let relatedStockData: Record<string, any> = {};
    if (relatedStocks && Array.isArray(relatedStocks) && relatedStocks.length > 0) {
      relatedStockData = await fetchRelatedStockData(relatedStocks);
    }

    // Fetch consensus ratings for earnings reaction template
    let consensusRatings: any = null;
    if (template === 'earnings-reaction') {
      consensusRatings = await fetchConsensusRatings(tickerUpper);
    }

    // Format price action
    const companyName = priceData?.name || tickerUpper;
    const priceAction = formatPriceAction(priceData, tickerUpper);

    // Scrape custom source URLs if provided (for custom template)
    let customSourceContent: Record<string, string> = {};
    if (template === 'custom' && customSourceUrls) {
      const urlArray = typeof customSourceUrls === 'string' 
        ? customSourceUrls.split(',').map(url => url.trim()).filter(url => url)
        : Array.isArray(customSourceUrls) ? customSourceUrls : [];
      
      if (urlArray.length > 0) {
        console.log(`[QUICK STORY] Scraping ${urlArray.length} custom source URLs...`);
        const scrapePromises = urlArray.map(async (url: string) => {
          try {
            const content = await scrapeNewsUrl(url);
            if (content) {
              customSourceContent[url] = content;
              console.log(`[QUICK STORY] Successfully scraped ${url}, content length: ${content.length}`);
            } else {
              console.warn(`[QUICK STORY] Failed to scrape ${url}`);
            }
          } catch (error) {
            console.error(`[QUICK STORY] Error scraping ${url}:`, error);
          }
        });
        await Promise.all(scrapePromises);
      }
    }

    // Use multi-factor analysis if enabled for sector-context template
    let story: string;
    if (template === 'sector-context' && multiFactorMode && Object.keys(relatedStockData).length > 0) {
      console.log(`[QUICK STORY] Using multi-factor analysis mode`);
      story = await generateMultiFactorStory(
        tickerUpper,
        companyName,
        priceAction,
        articles,
        relatedStockData,
        wordCount,
        priceData || undefined,
        provider
      );
    } else {
      // Standard single-pass generation
      const customUrlsArray = template === 'custom' && customSourceUrls
        ? (typeof customSourceUrls === 'string' 
            ? customSourceUrls.split(',').map(url => url.trim()).filter(url => url)
            : Array.isArray(customSourceUrls) ? customSourceUrls : [])
        : undefined;
      
      const prompt = buildPrompt(
        tickerUpper,
        companyName,
        priceAction,
        articles,
        relatedStockData,
        template,
        wordCount,
        customFocus,
        earningsData || undefined,
        priceData || undefined,
        consensusRatings || undefined,
        customUrlsArray,
        Object.keys(customSourceContent).length > 0 ? customSourceContent : undefined
      );

      // Generate story
      const result = await aiProvider.generateCompletion(
      [
        {
          role: 'system',
          content: 'You are a professional financial journalist writing concise, data-dense articles for a financial news website. HIGHEST PRIORITY: You must hyperlink EVERY article provided - if 5 articles are given, include exactly 5 hyperlinks distributed throughout the story. At least ONE hyperlink MUST appear in the first paragraph. Use HTML format: <a href="URL">text</a> NOT markdown format. Always use HTML <strong> tags to bold company names (not tickers) and prominent people\'s names on their first mention. CRITICAL: On the FIRST mention of ANY company (main or related), you MUST use the FULL company name (e.g., "Microsoft Corporation", "NVIDIA Corporation") with the ticker in parentheses. Use subhead placeholders (## Section:) and bullet points (<ul>/<li>) to break up content and improve readability. Prioritize data density - avoid fluff and repetition.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      {
        model: provider === 'gemini' ? 'gemini-3-pro-preview' : 'gpt-4o',
        temperature: 0.3, // Lower temperature for more consistent instruction following
        maxTokens: Math.max(wordCount * 3, 2000), // Increased to prevent truncation
      },
      provider
      );

      story = result.content.trim();
    }

    // Clean up any markdown wrappers
    story = story.replace(/^```(?:markdown|html)?\s*/i, '').replace(/\s*```$/i, '');

    // Validate hyperlinks: Count how many article URLs are actually hyperlinked
    // Check for both HTML format <a href="url">text</a> and markdown format [text](url)
    const htmlLinks = (story.match(/<a\s+href=["']https?:\/\/[^"']+["'][^>]*>/gi) || []).length;
    const markdownLinks = (story.match(/\[([^\]]+)\]\(https?:\/\/[^\)]+\)/gi) || []).length;
    const hyperlinkCount = htmlLinks + markdownLinks;
    const expectedHyperlinks = articles.length;
    
    console.log(`[QUICK STORY] Hyperlink detection: ${htmlLinks} HTML links, ${markdownLinks} markdown links, total: ${hyperlinkCount}`);
    
    console.log(`[QUICK STORY] Hyperlink validation: Found ${hyperlinkCount} hyperlinks, expected ${expectedHyperlinks}`);
    
    // If hyperlinks are missing, retry with stronger instructions (max 2 retries)
    let retryCount = 0;
    const maxRetries = 2;
    let currentHyperlinkCount = hyperlinkCount;
    
    while (currentHyperlinkCount < expectedHyperlinks && retryCount < maxRetries) {
      console.log(`[QUICK STORY] Missing hyperlinks detected. Retry ${retryCount + 1}/${maxRetries}...`);
      console.log(`[QUICK STORY] Current hyperlink count: ${currentHyperlinkCount}, expected: ${expectedHyperlinks}`);
      
      // Build a more explicit prompt with hyperlink requirements
      const customUrlsArrayRetry = template === 'custom' && customSourceUrls
        ? (typeof customSourceUrls === 'string' 
            ? customSourceUrls.split(',').map(url => url.trim()).filter(url => url)
            : Array.isArray(customSourceUrls) ? customSourceUrls : [])
        : undefined;
      
      const retryPrompt = buildPrompt(
        tickerUpper,
        companyName,
        priceAction,
        articles,
        relatedStockData,
        template,
        wordCount,
        customFocus,
        earningsData || undefined,
        priceData || undefined,
        consensusRatings || undefined,
        customUrlsArrayRetry,
        Object.keys(customSourceContent).length > 0 ? customSourceContent : undefined
      ) + `\n\nCRITICAL VALIDATION REQUIRED BEFORE SUBMITTING:
CRITICAL WRITING STYLE REMINDER:
- Write naturally as a journalist - DO NOT explicitly reference articles or reports
- DO NOT use phrases like "as reported", "as discussed", "according to a report", "as covered in an article", "this article", "the report", "in a report", "as noted in", "which was discussed in", "this development was covered in", "recent reports", "according to reports", "recent news", etc.
- DO NOT use the exact headline text as hyperlink text - extract three sequential words that fit naturally into your sentence
- Simply write the narrative and embed hyperlinks seamlessly - the hyperlink text should flow naturally as part of the sentence, not as a headline or reference
- Example of GOOD: "The company's stock rebounded following a major hardware delivery for its upcoming Neutron rocket."
- Example of BAD: "This development was covered in a Rocket Lab Stock Rebounds article."
- Example of BAD: "Recent reports indicate the company is expanding."
- Example of BAD: "Can You Buy NASA Stock? explores investment options."

CRITICAL VALIDATION REQUIRED BEFORE SUBMITTING:
- You MUST have exactly ${expectedHyperlinks} hyperlinks in your story (one for each article)
- Current count: ${currentHyperlinkCount} hyperlinks found
- You are MISSING ${expectedHyperlinks - currentHyperlinkCount} hyperlink(s)
- Go through each article listed above and ensure you've created a hyperlink for it
- Each hyperlink must use three sequential words from the article headline
- Format: <a href="URL">three sequential words</a> (use HTML format, NOT markdown)
- After adding the missing hyperlink(s), count again to verify you have exactly ${expectedHyperlinks} hyperlinks
- DO NOT submit until you have exactly ${expectedHyperlinks} hyperlinks`;

      const retryResult = await aiProvider.generateCompletion(
        [
          {
            role: 'system',
            content: 'You are a professional financial journalist writing concise, data-dense articles for a financial news website. CRITICAL HYPERLINK RULE: You must hyperlink EVERY article provided - if 5 articles are given, include exactly 5 hyperlinks distributed throughout the story. At least ONE hyperlink MUST appear in the first paragraph. Use HTML format: <a href="URL">text</a> NOT markdown format. Always use HTML <strong> tags to bold company names (not tickers) and prominent people\'s names on their first mention. CRITICAL: On the FIRST mention of ANY company (main or related), you MUST use the FULL company name (e.g., "Microsoft Corporation", "NVIDIA Corporation") with the ticker in parentheses. Use subhead placeholders (## Section:) and bullet points (<ul>/<li>) to break up content and improve readability.',
          },
          {
            role: 'user',
            content: retryPrompt,
          },
        ],
        {
          model: provider === 'gemini' ? 'gemini-3-pro-preview' : 'gpt-4o',
          temperature: 0.3, // Lower temperature for more consistent instruction following
          maxTokens: Math.max(wordCount * 3, 2000), // Increased to prevent truncation
        },
        provider
      );

      story = retryResult.content.trim();
      story = story.replace(/^```(?:markdown|html)?\s*/i, '').replace(/\s*```$/i, '');
      
      // Re-count hyperlinks (both HTML and markdown)
      const newHtmlLinks = (story.match(/<a\s+href=["']https?:\/\/[^"']+["'][^>]*>/gi) || []).length;
      const newMarkdownLinks = (story.match(/\[([^\]]+)\]\(https?:\/\/[^\)]+\)/gi) || []).length;
      const newHyperlinkCount = newHtmlLinks + newMarkdownLinks;
      console.log(`[QUICK STORY] After retry ${retryCount + 1}: Found ${newHtmlLinks} HTML links, ${newMarkdownLinks} markdown links, total: ${newHyperlinkCount}`);
      
      // Update current count for next iteration
      currentHyperlinkCount = newHyperlinkCount;
      
      if (newHyperlinkCount >= expectedHyperlinks) {
        console.log(`[QUICK STORY] ✅ Successfully added missing hyperlinks after retry ${retryCount + 1}`);
        break;
      }
      
      retryCount++;
    }

    // Final validation warning if still missing hyperlinks
    const finalHtmlLinks = (story.match(/<a\s+href=["']https?:\/\/[^"']+["'][^>]*>/gi) || []).length;
    const finalMarkdownLinks = (story.match(/\[([^\]]+)\]\(https?:\/\/[^\)]+\)/gi) || []).length;
    const finalHyperlinkCount = finalHtmlLinks + finalMarkdownLinks;
    
    if (finalHyperlinkCount < expectedHyperlinks) {
      console.warn(`[QUICK STORY] ⚠️ WARNING: Only ${finalHyperlinkCount} of ${expectedHyperlinks} hyperlinks found after ${maxRetries} retries (${finalHtmlLinks} HTML, ${finalMarkdownLinks} markdown)`);
    }
    
    // Convert any markdown links to HTML format for consistency
    if (finalMarkdownLinks > 0) {
      story = story.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/gi, '<a href="$2">$1</a>');
      console.log(`[QUICK STORY] Converted ${finalMarkdownLinks} markdown links to HTML format`);
    }

    // Ensure price action line is at the end
    if (!story.includes(priceAction) && priceAction) {
      story += `\n\n<p><strong>${tickerUpper} Price Action:</strong> ${priceAction}, according to <a href="https://pro.benzinga.com/dashboard">Benzinga Pro data</a>.</p>`;
    }

    return NextResponse.json({
      story,
      priceAction,
      articlesUsed: articles.length,
      relatedStocksUsed: Object.keys(relatedStockData).length,
      hyperlinksFound: finalHyperlinkCount,
      hyperlinksExpected: expectedHyperlinks,
      hyperlinkWarning: finalHyperlinkCount < expectedHyperlinks ? `Warning: Only ${finalHyperlinkCount} of ${expectedHyperlinks} hyperlinks were found in the story.` : null,
    });
  } catch (error: any) {
    console.error('[QUICK STORY] Error generating story:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to generate story' },
      { status: 500 }
    );
  }
}
