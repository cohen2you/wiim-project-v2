import { NextResponse } from 'next/server';
import { aiProvider, AIProvider } from '@/lib/aiProvider';
import { fetchETFs, formatETFInfo } from '@/lib/etf-utils';

const BZ_NEWS_URL = 'https://api.benzinga.com/api/v2/news';

// Helper function to normalize company name capitalization
function normalizeCompanyName(name: string): string {
  if (!name) return name;
  if (name === name.toUpperCase() && name.length > 1) {
    return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  }
  return name;
}

// Helper to get market status using proper timezone handling
function getMarketStatusTimeBased(): 'open' | 'premarket' | 'afterhours' | 'closed' {
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
  if (time >= 930 && time < 1600) return 'open';
  if (time >= 1600 && time < 2000) return 'afterhours';
  return 'closed';
}

// Helper function to format date string without timezone issues
function formatEarningsDate(dateString: string | null | undefined): string {
  if (!dateString) return 'a date to be announced';
  try {
    const parts = dateString.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const date = new Date(year, month, day);
      return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    }
    return new Date(dateString).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  } catch (error) {
    console.error('Error formatting earnings date:', error);
    return dateString;
  }
}

// Helper function to format revenue (converts to billions if >= 1000 million, otherwise millions)
function formatRevenue(revenue: number | string | null | undefined): string {
  if (revenue === null || revenue === undefined) return '';
  try {
    const numRevenue = typeof revenue === 'string' ? parseFloat(revenue) : revenue;
    if (isNaN(numRevenue) || !isFinite(numRevenue)) return '';
    
    const millions = numRevenue / 1000000;
    
    if (millions >= 1000) {
      const billions = millions / 1000;
      return `$${billions.toFixed(2)} billion`;
    } else {
      return `$${millions.toFixed(2)} million`;
    }
  } catch (error) {
    console.error('Error formatting revenue:', error);
    return '';
  }
}

// Fetch next earnings date from Benzinga calendar
async function fetchNextEarningsDate(ticker: string) {
  try {
    const BENZINGA_API_KEY = process.env.BENZINGA_API_KEY;
    if (!BENZINGA_API_KEY) {
      return null;
    }

    const today = new Date();
    const dateFrom = today.toISOString().split('T')[0];
    const dateTo = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const url = 'https://api.benzinga.com/api/v2/calendar/earnings' +
      `?token=${BENZINGA_API_KEY}` +
      `&parameters[tickers]=${encodeURIComponent(ticker)}` +
      `&parameters[date_from]=${dateFrom}` +
      `&parameters[date_to]=${dateTo}` +
      `&pagesize=20`;
    
    const earningsRes = await fetch(url, {
      headers: { accept: 'application/json' }
    });
      
    if (earningsRes.ok) {
      const raw = await earningsRes.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.trim());
      } catch {
        console.log('Earnings calendar: Invalid JSON response');
        return null;
      }
      
      interface EarningsResponse {
        earnings?: unknown[];
        results?: unknown[];
        data?: unknown[];
      }
      
      const results: unknown[] = Array.isArray(parsed)
        ? parsed
        : ((parsed as EarningsResponse).earnings 
          || (parsed as EarningsResponse).results 
          || (parsed as EarningsResponse).data 
          || []);
      
      interface EarningsItem {
        date?: string;
        earnings_date?: string;
        earningsDate?: string;
        [key: string]: unknown;
      }
      
      const upcomingEarnings = results
        .filter((item: unknown): item is EarningsItem => {
          const earningsItem = item as EarningsItem;
          const earningsDate = earningsItem.date || earningsItem.earnings_date || earningsItem.earningsDate;
          if (!earningsDate) return false;
          const date = new Date(earningsDate);
          return date >= today;
        })
        .sort((a: EarningsItem, b: EarningsItem) => {
          const dateA = new Date(a.date || a.earnings_date || a.earningsDate || 0);
          const dateB = new Date(b.date || b.earnings_date || b.earningsDate || 0);
          return dateA.getTime() - dateB.getTime();
        });
      
      if (upcomingEarnings.length > 0) {
        const nextEarnings = upcomingEarnings[0];
        const earningsDate = nextEarnings.date || nextEarnings.earnings_date || nextEarnings.earningsDate;
        if (earningsDate) {
          // Log available fields for debugging (first time only, to see what data is available)
          const earningsKeys = Object.keys(nextEarnings);
          if (!earningsKeys.includes('volatility') && !earningsKeys.includes('implied_volatility') && !earningsKeys.includes('iv')) {
            console.log(`[EARNINGS DEBUG] Available fields in earnings response for ${ticker}:`, earningsKeys.slice(0, 20).join(', '));
          }
          
          // Extract implied volatility data (check multiple possible field names)
          const impliedVolatility = nextEarnings.implied_volatility || 
                                   nextEarnings.impliedVolatility || 
                                   nextEarnings.iv || 
                                   nextEarnings.volatility ||
                                   nextEarnings.vol ||
                                   nextEarnings.atm_iv ||
                                   nextEarnings.atmIV ||
                                   null;
          
          // Extract IV rank/percentile if available
          const ivRank = nextEarnings.iv_rank || 
                        nextEarnings.ivRank || 
                        nextEarnings.iv_percentile || 
                        nextEarnings.ivPercentile ||
                        null;
          
          return {
            date: earningsDate,
            eps_estimate: nextEarnings.eps_est || nextEarnings.epsEst || nextEarnings.eps_estimate || nextEarnings.epsEstimate || nextEarnings.estimated_eps || null,
            eps_prior: nextEarnings.eps_prior || nextEarnings.epsPrior || nextEarnings.eps_prev || nextEarnings.previous_eps || null,
            revenue_estimate: nextEarnings.revenue_est || nextEarnings.revenueEst || nextEarnings.revenue_estimate || nextEarnings.revenueEstimate || nextEarnings.estimated_revenue || null,
            revenue_prior: nextEarnings.revenue_prior || nextEarnings.revenuePrior || nextEarnings.rev_prev || nextEarnings.previous_revenue || null,
            implied_volatility: impliedVolatility ? (typeof impliedVolatility === 'number' ? impliedVolatility : (typeof impliedVolatility === 'string' ? parseFloat(impliedVolatility) : null)) : null,
            iv_rank: ivRank ? (typeof ivRank === 'number' ? ivRank : (typeof ivRank === 'string' ? parseFloat(ivRank) : null)) : null,
          };
        }
      }
    } else {
      const errorText = await earningsRes.text().catch(() => '');
      console.log('Earnings calendar error:', errorText.substring(0, 300));
    }
    
    return null;
  } catch (error) {
    console.error('Error fetching next earnings date:', error);
    return null;
  }
}

// Fetch historical earnings data (past quarters)
async function fetchHistoricalEarnings(ticker: string, quarters: number = 4) {
  try {
    const BENZINGA_API_KEY = process.env.BENZINGA_API_KEY;
    if (!BENZINGA_API_KEY) {
      console.log(`[HISTORICAL EARNINGS] ${ticker}: No API key available`);
      return null;
    }

    const today = new Date();
    // Look back 2 years to get enough quarters
    const dateFrom = new Date(today.getFullYear() - 2, today.getMonth(), today.getDate());
    const dateTo = today.toISOString().split('T')[0];
    const dateFromStr = dateFrom.toISOString().split('T')[0];
    
    const url = 'https://api.benzinga.com/api/v2/calendar/earnings' +
      `?token=${BENZINGA_API_KEY}` +
      `&parameters[tickers]=${encodeURIComponent(ticker)}` +
      `&parameters[date_from]=${dateFromStr}` +
      `&parameters[date_to]=${dateTo}` +
      `&pagesize=50`;
    
    console.log(`[HISTORICAL EARNINGS] ${ticker}: Fetching from ${dateFromStr} to ${dateTo}`);
    console.log(`[HISTORICAL EARNINGS] ${ticker}: URL: ${url.replace(BENZINGA_API_KEY, 'REDACTED')}`);
    
    const earningsRes = await fetch(url, {
      headers: { accept: 'application/json' }
    });
      
    console.log(`[HISTORICAL EARNINGS] ${ticker}: Response status: ${earningsRes.status}`);
    
    if (earningsRes.ok) {
      const raw = await earningsRes.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.trim());
        console.log(`[HISTORICAL EARNINGS] ${ticker}: Successfully parsed JSON, type: ${Array.isArray(parsed) ? 'array' : typeof parsed}`);
      } catch (parseError) {
        console.error(`[HISTORICAL EARNINGS] ${ticker}: JSON parse error:`, parseError);
        console.log(`[HISTORICAL EARNINGS] ${ticker}: Raw response (first 500 chars):`, raw.substring(0, 500));
        return null;
      }
      
      interface EarningsResponse {
        earnings?: unknown[];
        results?: unknown[];
        data?: unknown[];
      }
      
      const results: unknown[] = Array.isArray(parsed)
        ? parsed
        : ((parsed as EarningsResponse).earnings 
          || (parsed as EarningsResponse).results 
          || (parsed as EarningsResponse).data 
          || []);
      
      interface EarningsItem {
        date?: string;
        earnings_date?: string;
        earningsDate?: string;
        // API returns 'eps' for actual EPS, 'eps_est' for estimate
        eps?: number | string; // Actual EPS (most common field name)
        eps_actual?: number | string;
        epsActual?: number | string;
        eps_actual_reported?: number | string;
        actual_eps?: number | string;
        reported_eps?: number | string;
        eps_est?: number | string;
        epsEst?: number | string;
        eps_estimate?: number | string;
        epsEstimate?: number | string;
        estimated_eps?: number | string;
        eps_consensus?: number | string;
        eps_surprise?: number | string;
        eps_surprise_percent?: number | string;
        // API returns 'revenue' for actual revenue, 'revenue_est' for estimate
        revenue?: number | string; // Actual revenue (most common field name)
        revenue_actual?: number | string;
        revenueActual?: number | string;
        revenue_actual_reported?: number | string;
        actual_revenue?: number | string;
        reported_revenue?: number | string;
        revenue_est?: number | string;
        revenueEst?: number | string;
        revenue_estimate?: number | string;
        revenueEstimate?: number | string;
        estimated_revenue?: number | string;
        revenue_consensus?: number | string;
        revenue_surprise?: number | string;
        revenue_surprise_percent?: number | string;
        [key: string]: unknown;
      }
      
      console.log(`[HISTORICAL EARNINGS] ${ticker}: Total results found: ${results.length}`);
      
      // Get past earnings (before today)
      const pastEarnings = results
        .filter((item: unknown): item is EarningsItem => {
          const earningsItem = item as EarningsItem;
          const earningsDate = earningsItem.date || earningsItem.earnings_date || earningsItem.earningsDate;
          if (!earningsDate) return false;
          const date = new Date(earningsDate);
          return date < today;
        })
        .sort((a: EarningsItem, b: EarningsItem) => {
          const dateA = new Date(a.date || a.earnings_date || a.earningsDate || 0);
          const dateB = new Date(b.date || b.earnings_date || b.earningsDate || 0);
          return dateB.getTime() - dateA.getTime(); // Sort descending (most recent first)
        })
        .slice(0, quarters)
        .map((item: EarningsItem) => {
          const earningsDate = item.date || item.earnings_date || item.earningsDate;
          // API uses 'eps' for actual and 'eps_est' for estimate (based on logs)
          const epsActual = item.eps || item.eps_actual || item.epsActual || item.eps_actual_reported || item.actual_eps || item.reported_eps || null;
          const epsEst = item.eps_est || item.epsEst || item.eps_estimate || item.epsEstimate || item.estimated_eps || item.eps_consensus || null;
          // API uses 'revenue' for actual and 'revenue_est' for estimate (based on logs)
          const revenueActual = item.revenue || item.revenue_actual || item.revenueActual || item.revenue_actual_reported || item.actual_revenue || item.reported_revenue || null;
          const revenueEst = item.revenue_est || item.revenueEst || item.revenue_estimate || item.revenueEstimate || item.estimated_revenue || item.revenue_consensus || null;
          // API also provides surprise percentage directly
          const epsSurprisePct = item.eps_surprise_percent !== null && item.eps_surprise_percent !== undefined 
            ? (typeof item.eps_surprise_percent === 'string' ? parseFloat(item.eps_surprise_percent) : item.eps_surprise_percent)
            : null;
          const revenueSurprisePct = item.revenue_surprise_percent !== null && item.revenue_surprise_percent !== undefined
            ? (typeof item.revenue_surprise_percent === 'string' ? parseFloat(item.revenue_surprise_percent.toString()) : item.revenue_surprise_percent)
            : null;
          
          console.log(`[HISTORICAL EARNINGS] ${ticker}: Processing item:`, {
            date: earningsDate,
            eps: item.eps,
            eps_actual: epsActual,
            eps_est: epsEst,
            revenue: item.revenue,
            revenue_actual: revenueActual,
            revenue_est: revenueEst,
            eps_surprise_percent: epsSurprisePct,
            revenue_surprise_percent: revenueSurprisePct,
            allKeys: Object.keys(item).filter(k => k.toLowerCase().includes('eps') || k.toLowerCase().includes('revenue') || k.toLowerCase().includes('actual'))
          });
          
          let epsSurprise = epsSurprisePct;
          let revenueSurprise = revenueSurprisePct;
          let beatMiss = null;
          
          // Calculate surprise if not provided but we have actual and estimate
          if (epsSurprise === null && epsActual !== null && epsEst !== null) {
            const actualNum = typeof epsActual === 'string' ? parseFloat(epsActual) : epsActual;
            const estNum = typeof epsEst === 'string' ? parseFloat(epsEst) : epsEst;
            if (!isNaN(actualNum) && !isNaN(estNum) && estNum !== 0) {
              epsSurprise = ((actualNum - estNum) / Math.abs(estNum)) * 100;
              beatMiss = actualNum >= estNum ? 'Beat' : 'Miss';
            }
          } else if (epsSurprise !== null) {
            // Use surprise percentage to determine beat/miss
            beatMiss = epsSurprise > 0 ? 'Beat' : epsSurprise < 0 ? 'Miss' : null;
          }
          
          // Calculate revenue surprise if not provided
          if (revenueSurprise === null && revenueActual !== null && revenueEst !== null) {
            const actualNum = typeof revenueActual === 'string' ? parseFloat(revenueActual.toString()) : revenueActual;
            const estNum = typeof revenueEst === 'string' ? parseFloat(revenueEst.toString()) : revenueEst;
            if (!isNaN(actualNum) && !isNaN(estNum) && estNum !== 0) {
              revenueSurprise = ((actualNum - estNum) / Math.abs(estNum)) * 100;
            }
          }
          
          return {
            date: earningsDate,
            eps_actual: epsActual,
            eps_estimate: epsEst,
            eps_surprise: epsSurprise,
            revenue_actual: revenueActual,
            revenue_estimate: revenueEst,
            revenue_surprise: revenueSurprise,
            beat_miss: beatMiss,
          };
        });
      
      if (pastEarnings.length > 0) {
        // Calculate statistics
        const beats = pastEarnings.filter(e => e.beat_miss === 'Beat').length;
        const misses = pastEarnings.filter(e => e.beat_miss === 'Miss').length;
        const epsSurprises = pastEarnings.filter(e => e.eps_surprise !== null && e.eps_surprise !== undefined).map(e => e.eps_surprise as number);
        // Only calculate average if we have meaningful surprises (not all zeros or very close to zero)
        const avgEpsSurprise = epsSurprises.length > 0 
          ? (() => {
              const avg = epsSurprises.reduce((sum, val) => sum + val, 0) / epsSurprises.length;
              // Round to 1 decimal place, and if it's effectively zero, return null
              const rounded = Math.round(avg * 10) / 10;
              return Math.abs(rounded) < 0.1 ? null : rounded;
            })()
          : null;
        
        return {
          quarters: pastEarnings,
          beats,
          misses,
          beat_rate: pastEarnings.length > 0 ? (beats / pastEarnings.length) * 100 : 0,
          avg_eps_surprise: avgEpsSurprise,
        };
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error fetching historical earnings:', error);
    return null;
  }
}

// Fetch consensus ratings from Benzinga
async function fetchConsensusRatings(ticker: string) {
  try {
    const BENZINGA_API_KEY = process.env.BENZINGA_API_KEY;
    if (!BENZINGA_API_KEY) {
      console.error('Error: BENZINGA_API_KEY is missing from environment variables.');
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
        
        const consensus = {
          consensus_rating: extractedConsensus.consensus_rating || extractedConsensus.consensusRating || extractedConsensus.rating || null,
          consensus_price_target: consensusPriceTarget,
          high_price_target: extractedConsensus.high_price_target || extractedConsensus.highPriceTarget || extractedConsensus.high || extractedConsensus.high_target || null,
          low_price_target: extractedConsensus.low_price_target || extractedConsensus.lowPriceTarget || extractedConsensus.low || extractedConsensus.low_target || null,
          total_analyst_count: extractedConsensus.total_analyst_count || extractedConsensus.totalAnalystCount || extractedConsensus.analyst_count || extractedConsensus.count || null,
          buy_percentage: extractedConsensus.buy_percentage || extractedConsensus.buyPercentage || extractedConsensus.buy || null,
          hold_percentage: extractedConsensus.hold_percentage || extractedConsensus.holdPercentage || extractedConsensus.hold || null,
          sell_percentage: extractedConsensus.sell_percentage || extractedConsensus.sellPercentage || extractedConsensus.sell || null,
        };
        
        if (consensus.consensus_price_target || consensus.consensus_rating) {
          return consensus;
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error fetching consensus ratings:', error);
    return null;
  }
}

// Fetch recent analyst actions (upgrades, downgrades, initiations) from Benzinga
async function fetchRecentAnalystActions(ticker: string, limit: number = 3) {
  try {
    const BENZINGA_API_KEY = process.env.BENZINGA_API_KEY;
    if (!BENZINGA_API_KEY) {
      console.log(`[ANALYST ACTIONS] ${ticker}: No API key available`);
      return [];
    }

    const analystUrl = `https://api.benzinga.com/api/v2.1/calendar/ratings?token=${BENZINGA_API_KEY}&parameters[tickers]=${encodeURIComponent(ticker)}&parameters[range]=3m`;
    console.log(`[ANALYST ACTIONS] ${ticker}: Fetching from last 3 months`);
    console.log(`[ANALYST ACTIONS] ${ticker}: URL: ${analystUrl.replace(BENZINGA_API_KEY, 'REDACTED')}`);
    
    const analystRes = await fetch(analystUrl, {
      headers: { Accept: 'application/json' },
    });
    
    console.log(`[ANALYST ACTIONS] ${ticker}: Response status: ${analystRes.status}`);
    
    if (analystRes.ok) {
      const analystData = await analystRes.json();
      const ratingsArray = Array.isArray(analystData) ? analystData : (analystData.ratings || []);
      
      console.log(`[ANALYST ACTIONS] ${ticker}: Total ratings found: ${ratingsArray.length}`);
      
      // Filter to only include actions from the past 3 months (client-side filter as API range parameter may not work correctly)
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      const threeMonthsAgoTime = threeMonthsAgo.getTime();
      
      const filteredRatings = ratingsArray.filter((rating: any) => {
        const ratingDate = rating.date || rating.created;
        if (!ratingDate) return false;
        const dateTime = new Date(ratingDate).getTime();
        return dateTime >= threeMonthsAgoTime;
      });
      
      console.log(`[ANALYST ACTIONS] ${ticker}: Ratings after 3-month filter: ${filteredRatings.length} (from ${ratingsArray.length} total)`);
      
      // Sort by date (most recent first) and format recent actions
      const sortedActions = filteredRatings
        .sort((a: any, b: any) => {
          const dateA = new Date(a.date || a.created || 0).getTime();
          const dateB = new Date(b.date || b.created || 0).getTime();
          return dateB - dateA; // Most recent first
        })
        .map((rating: any) => {
          // Use API field names: analyst, action_company, rating_current, rating_prior, pt_current, pt_prior
          const firm = rating.analyst || rating.firm || rating.analyst_firm || rating.firm_name || 'Unknown Firm';
          const actionCompany = rating.action_company || rating.action || rating.rating_action || '';
          const currentRating = rating.rating_current || rating.rating || rating.new_rating || '';
          const priorRating = rating.rating_prior || '';
          const priceTarget = rating.pt_current || rating.pt || rating.price_target || rating.target || null;
          const priorTarget = rating.pt_prior || rating.price_target_prior || null;
          const actionDate = rating.date || rating.created || null;
          
          console.log(`[ANALYST ACTIONS] ${ticker}: Processing rating:`, {
            firm,
            actionCompany,
            currentRating,
            priceTarget,
            date: actionDate
          });
          
          // Format the action description based on action_company and rating changes
          let actionText = '';
          const actionLower = actionCompany.toLowerCase();
          
          if (actionLower.includes('upgrade') || (priorRating && currentRating && currentRating !== priorRating)) {
            actionText = `Upgraded to ${currentRating}`;
          } else if (actionLower.includes('downgrade')) {
            actionText = `Downgraded to ${currentRating}`;
          } else if (actionLower.includes('initiate') || actionLower.includes('reinstated')) {
            actionText = `Initiated with ${currentRating}`;
          } else if (currentRating) {
            actionText = `${currentRating}`;
          }
          
          // Add price target info with change indication (show from X to Y)
          if (priceTarget && priorTarget && priceTarget !== priorTarget) {
            const direction = parseFloat(priceTarget.toString()) > parseFloat(priorTarget.toString()) ? 'Raised' : 'Lowered';
            actionText += ` (${direction} Target from $${parseFloat(priorTarget.toString()).toFixed(2)} to $${parseFloat(priceTarget.toString()).toFixed(2)})`;
          } else if (priceTarget) {
            actionText += ` (Target $${parseFloat(priceTarget.toString()).toFixed(2)})`;
          }
          
          return {
            firm,
            action: actionText,
            date: actionDate,
            priceTarget: priceTarget ? parseFloat(priceTarget.toString()) : null,
            priorTarget: priorTarget ? parseFloat(priorTarget.toString()) : null
          };
        });
      
      // Deduplicate by firm name, keeping only the most recent action for each firm
      const firmMap = new Map<string, typeof sortedActions[0]>();
      for (const action of sortedActions) {
        if (!firmMap.has(action.firm)) {
          firmMap.set(action.firm, action);
        }
      }
      
      // Convert map back to array (already sorted by most recent)
      let recentActions = Array.from(firmMap.values());
      
      // Limit to last 5-7 actions OR actions within the last 30-45 days (whichever is more restrictive)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 45); // Use 45 days as the cutoff
      const thirtyDaysAgoTime = thirtyDaysAgo.getTime();
      
      // First filter by date (last 45 days)
      const actionsWithin45Days = recentActions.filter((action: any) => {
        if (!action.date) return false;
        const dateTime = new Date(action.date).getTime();
        return dateTime >= thirtyDaysAgoTime;
      });
      
      // Take the first 7 actions (most recent) from either the 45-day filtered list or all actions
      // Prefer 45-day filtered if it has at least 5 actions, otherwise use all actions but limit to 7
      if (actionsWithin45Days.length >= 5) {
        recentActions = actionsWithin45Days.slice(0, 7);
      } else {
        recentActions = recentActions.slice(0, 7);
      }
      
      console.log(`[ANALYST ACTIONS] ${ticker}: Returning ${recentActions.length} limited actions (from ${firmMap.size} deduplicated, ${actionsWithin45Days.length} within 45 days)`);
      return recentActions;
    } else {
      const errorText = await analystRes.text().catch(() => '');
      console.error(`[ANALYST ACTIONS] ${ticker}: API error - status ${analystRes.status}, text:`, errorText.substring(0, 300));
    }
    
    return [];
  } catch (error) {
    console.error('Error fetching recent analyst actions:', error);
    return [];
  }
}

// Fetch basic stock data for company name and current price
async function fetchBasicStockData(ticker: string) {
  try {
    const url = `https://api.benzinga.com/api/v2/quoteDelayed?token=${process.env.BENZINGA_API_KEY}&symbols=${ticker}`;
    const res = await fetch(url);
    
    if (!res.ok) {
      return null;
    }
    
    const data = await res.json();
    if (!data || typeof data !== 'object') {
      return null;
    }
    
    const quote = data[ticker.toUpperCase()];
    if (!quote || typeof quote !== 'object') {
      return null;
    }
    
    return {
      companyName: normalizeCompanyName(quote.name || ticker),
      currentPrice: typeof quote.lastTradePrice === 'number' ? quote.lastTradePrice : parseFloat(quote.lastTradePrice || '0'),
      symbol: quote.symbol || ticker.toUpperCase(),
    };
  } catch (error) {
    console.error('Error fetching basic stock data:', error);
    return null;
  }
}

// Fetch P/E ratio from Benzinga
async function fetchPERatio(ticker: string) {
  try {
    const BENZINGA_API_KEY = process.env.BENZINGA_API_KEY;
    if (!BENZINGA_API_KEY) {
      return null;
    }
    
    const benzingaRes = await fetch(`https://api.benzinga.com/api/v2/quoteDelayed?token=${BENZINGA_API_KEY}&symbols=${ticker}`);
    if (benzingaRes.ok) {
      const benzingaData = await benzingaRes.json();
      if (benzingaData && benzingaData[ticker]) {
        const quote = benzingaData[ticker];
        return quote.pe || quote.priceEarnings || quote.pe_ratio || null;
      }
    }
    return null;
  } catch (error) {
    console.error('Error fetching P/E ratio:', error);
    return null;
  }
}

// Generate price action line (matching price-action route logic)
async function generatePriceAction(ticker: string, companyName: string): Promise<string> {
  try {
    const url = `https://api.benzinga.com/api/v2/quoteDelayed?token=${process.env.BENZINGA_API_KEY}&symbols=${ticker}`;
    const res = await fetch(url);
    
    if (!res.ok) {
      console.error(`Failed to fetch price action for ${ticker}:`, res.statusText);
      return '';
    }
    
    const data = await res.json();
    if (!data || typeof data !== 'object') {
      return '';
    }
    
    const quote = data[ticker.toUpperCase()];
    if (!quote || typeof quote !== 'object') {
      return '';
    }
    
    const symbol = quote.symbol ?? ticker.toUpperCase();
    
    if (!symbol || !quote.lastTradePrice) {
      return '';
    }
    
    const marketStatus = getMarketStatusTimeBased();
    
    // Get current day name in Eastern Time (not the close date, which might be previous day)
    // Markets are closed on weekends, so return Friday for Saturday/Sunday
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'long',
    });
    const currentDayName = formatter.format(now);
    // If it's a weekend, return Friday as the last trading day
    const dayOfWeek = (currentDayName === 'Sunday' || currentDayName === 'Saturday') ? 'Friday' : currentDayName;
    const isWeekend = currentDayName === 'Sunday' || currentDayName === 'Saturday';
    
    const changePercent = typeof quote.changePercent === 'number' ? quote.changePercent : 0;
    
    // Calculate regular session and after-hours changes separately
    let regularSessionChange = 0;
    let afterHoursChange = 0;
    let regularUpDown = '';
    let afterHoursUpDown = '';
    
    if (marketStatus === 'afterhours' && quote.close && quote.lastTradePrice && quote.previousClosePrice) {
      // Regular session change: (regular_close - previous_close) / previous_close * 100
      regularSessionChange = ((quote.close - quote.previousClosePrice) / quote.previousClosePrice) * 100;
      regularUpDown = regularSessionChange > 0 ? 'up' : regularSessionChange < 0 ? 'down' : 'unchanged';
      
      // After-hours change: (current - regular_close) / regular_close * 100
      afterHoursChange = ((quote.lastTradePrice - quote.close) / quote.close) * 100;
      afterHoursUpDown = afterHoursChange > 0 ? 'up' : afterHoursChange < 0 ? 'down' : 'unchanged';
    }
    
    // Format price to ensure exactly 2 decimal places
    const lastPrice = typeof quote.lastTradePrice === 'number' ? quote.lastTradePrice : parseFloat(quote.lastTradePrice);
    const formattedPrice = lastPrice.toFixed(2);
    const priceString = String(formattedPrice);
    
    const upDown = changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : 'unchanged';
    const absChange = Math.abs(changePercent).toFixed(2);
    
    // Build price action text with explicit string concatenation
    let priceActionText = '';
    
    if (marketStatus === 'open') {
      priceActionText = `${symbol} Price Action: ${companyName} shares were ${upDown} ${absChange}% at $${priceString} at the time of publication on ${dayOfWeek}`;
    } else if (marketStatus === 'afterhours' && quote.close && quote.lastTradePrice && quote.previousClosePrice) {
      // Show both regular session and after-hours moves when we have the necessary data
      const absRegularChange = Math.abs(regularSessionChange).toFixed(2);
      const absAfterHoursChange = Math.abs(afterHoursChange).toFixed(2);
      priceActionText = `${symbol} Price Action: ${companyName} shares were ${regularUpDown} ${absRegularChange}% during regular trading and ${afterHoursUpDown} ${absAfterHoursChange}% in after-hours trading on ${dayOfWeek}, last trading at $${priceString}`;
    } else {
      // For premarket/closed, use standard format
      let marketStatusPhrase = '';
      if (marketStatus === 'premarket') {
        marketStatusPhrase = ' during premarket trading';
      } else if (marketStatus === 'afterhours') {
        marketStatusPhrase = ' during after-hours trading';
      } else if (marketStatus === 'closed') {
        marketStatusPhrase = isWeekend ? '' : ' while the market was closed';
      }
      const timePhrase = (marketStatus === 'closed' && !isWeekend) ? ' at the time of publication' : '';
      priceActionText = `${symbol} Price Action: ${companyName} shares were ${upDown} ${absChange}% at $${priceString}${marketStatusPhrase}${timePhrase} on ${dayOfWeek}`;
    }
    
    return `<strong>${priceActionText}</strong>, according to <a href="https://pro.benzinga.com/dashboard">Benzinga Pro data</a>.`;
  } catch (error) {
    console.error(`Error generating price action for ${ticker}:`, error);
    return '';
  }
}

// Function to fetch related articles from Benzinga
async function fetchRelatedArticles(ticker: string, excludeUrl?: string): Promise<any[]> {
  try {
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - 7);
    const dateFromStr = dateFrom.toISOString().slice(0, 10);
    
    let url: string;
    
    if (ticker && ticker.trim() !== '') {
      url = `${BZ_NEWS_URL}?token=${process.env.BENZINGA_API_KEY}&tickers=${encodeURIComponent(ticker)}&items=20&fields=headline,title,created,url,channels&accept=application/json&displayOutput=full&dateFrom=${dateFromStr}`;
    } else {
      url = `${BZ_NEWS_URL}?token=${process.env.BENZINGA_API_KEY}&items=20&fields=headline,title,created,url,channels&accept=application/json&displayOutput=full&dateFrom=${dateFromStr}`;
    }
    
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    
    if (!res.ok) {
      return [];
    }
    
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    
    const prChannelNames = ['press releases', 'press-releases', 'pressrelease', 'pr'];
    const normalize = (str: string) => str.toLowerCase().replace(/[-_]/g, ' ');
    
    const filteredArticles = data.filter(item => {
      if (Array.isArray(item.channels) && item.channels.some((ch: any) => 
        typeof ch.name === 'string' && prChannelNames.includes(normalize(ch.name))
      )) {
        return false;
      }
      
      if (excludeUrl && item.url === excludeUrl) {
        return false;
      }
      
      return true;
    });
    
    const relatedArticles = filteredArticles
      .map((item: any) => ({
        headline: item.headline || item.title || '',
        url: item.url || '',
        created: item.created || '',
      }))
      .filter((item: any) => item.headline && item.url);
    
    return relatedArticles.slice(0, 5);
  } catch (error) {
    console.error('Error fetching related articles:', error);
    return [];
  }
}

// Inject SEO subheads using news-agent-project
async function injectSEOSubheads(articleText: string, backendUrl?: string): Promise<string | null> {
  if (!backendUrl) {
    console.log('⚠️ NEWS_AGENT_BACKEND_URL not configured, skipping SEO subhead injection');
    return null;
  }

  try {
    const apiUrl = `${backendUrl}/api/seo/generate`;
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ articleText }),
    });

    if (!response.ok) {
      console.error(`⚠️ SEO subhead API returned ${response.status}`);
      return null;
    }

    const data = await response.json();
    
    if (data.optimizedText) {
      // Clean up the optimized text: remove markdown wrappers, convert markdown headings to HTML
      let cleanedText = data.optimizedText;
      
      // Remove markdown code block wrapper
      cleanedText = cleanedText.replace(/^```markdown\s*/i, '').replace(/\s*```$/i, '');
      cleanedText = cleanedText.replace(/^```\s*/, '').replace(/\s*```$/, '');
      
      // Convert markdown H2 (## Heading) to HTML H2 (<h2>Heading</h2>)
      cleanedText = cleanedText.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
      
      // Convert markdown H3 (### Heading) to HTML H3 (<h3>Heading</h3>)
      cleanedText = cleanedText.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
      
      // Remove trailing "..." if it exists at the very end
      cleanedText = cleanedText.replace(/\s*\.{3,}\s*$/, '').trim();
      
      return cleanedText;
    }
    
    return null;
  } catch (error) {
    console.error('Error calling SEO subhead injection API:', error);
    return null;
  }
}

// Fetch context brief from external news agent
async function fetchContextBrief(ticker: string, backendUrl?: string): Promise<any | null> {
  if (!backendUrl) {
    console.log(`⚠️ [CONTEXT BRIEF] ${ticker}: NEWS_AGENT_BACKEND_URL not configured, skipping context brief fetch`);
    return null;
  }

  try {
    const apiUrl = `${backendUrl}/api/enrichment/context-brief`;
    
    console.log(`[CONTEXT BRIEF] ${ticker}: Fetching context brief from ${apiUrl}`);
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ticker: ticker.toUpperCase(),
      }),
    });

    if (!response.ok) {
      console.error(`⚠️ [CONTEXT BRIEF] ${ticker}: API returned ${response.status}`);
      return null;
    }

    const data = await response.json();
    
    console.log(`[CONTEXT BRIEF] ${ticker}: Received context brief:`, {
      hasData: !!data,
      majorEventDetected: data?.major_event_detected || false,
      sentiment: data?.sentiment || null
    });
    
    return data;
  } catch (error) {
    console.error(`[CONTEXT BRIEF] ${ticker}: Error fetching context brief:`, error);
    return null;
  }
}

// Fetch news section from add-news enrichment endpoint
async function fetchNewsSection(ticker: string, articleText: string, backendUrl?: string): Promise<string | null> {
  if (!backendUrl) {
    console.log(`⚠️ [ADD NEWS] ${ticker}: NEWS_AGENT_BACKEND_URL not configured, skipping news section fetch`);
    return null;
  }

  try {
    const apiUrl = `${backendUrl}/api/enrichment/add-news`;
    
    console.log(`[ADD NEWS] ${ticker}: Fetching news section from ${apiUrl}`);
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ticker: ticker.toUpperCase(),
        articleText: articleText,
        storyType: 'earnings-preview'
      }),
    });

    if (!response.ok) {
      console.error(`⚠️ [ADD NEWS] ${ticker}: API returned ${response.status}`);
      return null;
    }

    const data = await response.json();
    
    if (data.success && data.newsSection) {
      // Ensure the section has the correct header
      let newsSection = data.newsSection.trim();
      
      // Replace existing headers with our desired header
      newsSection = newsSection.replace(
        /##\s*(Section:\s*)?(Latest News on Stock|Recent Developments & Catalysts)/gi,
        '## Recent Developments & Catalysts'
      );
      
      // If the header doesn't exist at the start, add it
      if (!newsSection.startsWith('## Recent Developments & Catalysts')) {
        newsSection = newsSection.replace(/^##\s*(Section:\s*)?.+\n?/m, '');
        newsSection = '## Recent Developments & Catalysts\n\n' + newsSection.trim();
      }
      
      console.log(`✅ [ADD NEWS] ${ticker}: Received news section`);
      return newsSection;
    }
    
    return null;
  } catch (error) {
    console.error(`[ADD NEWS] ${ticker}: Error fetching news section:`, error);
    return null;
  }
}

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
    console.error('Error scraping URL:', error);
    return null;
  }
}

// Generate earnings preview article
async function generateEarningsPreview(
  ticker: string,
  companyName: string,
  nextEarnings: any,
  consensusRatings: any,
  recentAnalystActions: any[],
  peRatio: number | null,
  currentPrice: number,
  historicalEarnings: any,
  contextBrief: any | null,
  provider?: AIProvider,
  sourceUrl?: string,
  sourceContent?: string
): Promise<string> {
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const today = new Date();
  const dayOfWeek = dayNames[today.getDay()];
  const marketStatus = getMarketStatusTimeBased();
  
  const earningsDate = typeof nextEarnings === 'object' && nextEarnings.date ? formatEarningsDate(nextEarnings.date) : 'a date to be announced';
  const epsEstimate = typeof nextEarnings === 'object' && nextEarnings.eps_estimate ? parseFloat(nextEarnings.eps_estimate.toString()) : null;
  const epsPrior = typeof nextEarnings === 'object' && nextEarnings.eps_prior ? parseFloat(nextEarnings.eps_prior.toString()) : null;
  const revenueEstimate = typeof nextEarnings === 'object' && nextEarnings.revenue_estimate ? nextEarnings.revenue_estimate : null;
  const revenuePrior = typeof nextEarnings === 'object' && nextEarnings.revenue_prior ? nextEarnings.revenue_prior : null;
  const impliedVolatility = typeof nextEarnings === 'object' && nextEarnings.implied_volatility !== null && nextEarnings.implied_volatility !== undefined ? parseFloat(nextEarnings.implied_volatility.toString()) : null;
  const ivRank = typeof nextEarnings === 'object' && nextEarnings.iv_rank !== null && nextEarnings.iv_rank !== undefined ? parseFloat(nextEarnings.iv_rank.toString()) : null;
  
  // Debug logging for revenue values
  console.log(`[EARNINGS PREVIEW] ${ticker}: Revenue values before formatting:`, {
    revenueEstimate_raw: revenueEstimate,
    revenueEstimate_type: typeof revenueEstimate,
    revenuePrior_raw: revenuePrior,
    revenuePrior_type: typeof revenuePrior,
    revenueEstimate_formatted: revenueEstimate ? formatRevenue(revenueEstimate) : null,
    revenuePrior_formatted: revenuePrior ? formatRevenue(revenuePrior) : null
  });
  
  // Determine Forward P/E vs P/E Ratio
  let useForwardPE = false;
  if (epsPrior !== null && epsEstimate !== null) {
    useForwardPE = epsPrior < 0 && epsEstimate > 0;
  }
  
  // Set provider if specified
  if (provider && (provider === 'openai' || provider === 'gemini')) {
    try {
      aiProvider.setProvider(provider);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`Provider ${provider} not available, using default:`, errorMessage);
    }
  }

  // Use provider-specific model and token limits
  const currentProvider = aiProvider.getCurrentProvider();
  const model = currentProvider === 'gemini' ? 'gemini-2.5-flash' : 'gpt-4o-mini';
  // Increased token limits for high-quality, comprehensive articles
  const maxTokens = currentProvider === 'gemini' ? 16384 : 8000; // GPT-4o-mini supports up to 16K, using 8K for quality
  const providerOverride = (provider && provider === currentProvider) ? provider : undefined;
  
  // Build lead paragraph instructions - focus on Growth Story and Execution Risk
  let leadInstructions = '';
  
  // Calculate key metrics for the lead
  const revenueGrowth = revenueEstimate && revenuePrior ? 
    Math.round(((parseFloat(revenueEstimate.toString()) - parseFloat(revenuePrior.toString())) / parseFloat(revenuePrior.toString())) * 100) : null;
  const priceTarget = consensusRatings && consensusRatings.consensus_price_target ? 
    parseFloat(consensusRatings.consensus_price_target.toString()) : null;
  const priceVsTarget = priceTarget && currentPrice ? (currentPrice > priceTarget ? 'above' : 'below') : null;
  const beats = historicalEarnings && historicalEarnings.beats ? historicalEarnings.beats : 0;
  const quarters = historicalEarnings && historicalEarnings.quarters ? historicalEarnings.quarters.length : 0;
  const beatRate = quarters > 0 ? Math.round((beats / quarters) * 100) : null;
  const trackRecord = beatRate !== null && beatRate < 50 ? 'mixed' : beatRate !== null && beatRate >= 75 ? 'strong' : 'mixed';
  
  // Check for major events from context brief
  const majorEventDetected = contextBrief?.major_event_detected === true;
  const contextSentiment = contextBrief?.sentiment || null;
  
  // NARRATIVE-FIRST PROMPT: Only apply when contextBrief is provided (Enrich First mode)
  if (contextBrief) {
    // NARRATIVE-FIRST APPROACH: Use context as the "Main Character" to frame the earnings story
    if (majorEventDetected) {
      // Major event detected - frame earnings as the "verdict" on the event
      leadInstructions = `**ACT AS:** A senior market analyst writing for high-net-worth traders.

**TASK:** Write a compelling 2-3 sentence Lead Paragraph that frames the upcoming earnings report as a "verdict" on the major event or challenge facing ${companyName}.

**CRITICAL NARRATIVE RULE - START WITH THE CONFLICT:**
Do NOT start with "Company X is scheduled to report earnings on [date]." Instead, START WITH THE CONFLICT from the Context Dossier. Frame the earnings report as the test/verdict on that challenge.

**INSTRUCTIONS:**
1. **Sentence 1 (The Thesis/Conflict):** Open with the single biggest challenge, opportunity, or event from the Context Dossier (e.g., "As the AI war with Google intensifies..." or "Facing mounting pressure from [event]..."). Use company name with exchange (e.g., "${companyName} (NASDAQ:${ticker})"). Frame the earnings date as a "prove-it moment," "critical test," or "verdict" on this challenge. Include the earnings date naturally within this narrative frame.

2. **Sentence 2-3 (The Stakes):** Synthesize the financial data into the narrative. Do NOT just list numbers. Instead, connect them to the conflict. ${revenueEstimate && revenueGrowth ? `Rather than saying "Revenue is expected to be ${formatRevenue(revenueEstimate)}," frame it as: "To justify its premium ${peRatio ? `${peRatio.toFixed(1)}x ` : ''}valuation, ${companyName} must clear the high bar of ${formatRevenue(revenueEstimate)} in revenue${revenueGrowth > 0 ? `, a ${revenueGrowth}% surge that depends on [context-specific driver from Context Dossier]` : ''}."` : revenueEstimate ? `Frame revenue expectations (${formatRevenue(revenueEstimate)}) in context of the major event - what does this number mean given the current challenge?` : `Connect EPS expectations to the event - how will this metric validate or challenge the narrative?`} ${currentPrice && priceTarget ? `With shares trading at $${currentPrice.toFixed(0)}${priceVsTarget === 'below' ? `, significantly below the $${priceTarget.toFixed(0)} analyst target` : priceVsTarget === 'above' ? `, well above the $${priceTarget.toFixed(0)} analyst target` : ''}, the report becomes crucial for ${priceVsTarget === 'below' ? 'closing the valuation gap' : 'validating the premium valuation'}.` : ''}

**TONE:** Write like you're explaining a high-stakes situation to a sophisticated trader. Use phrases like "faces a critical test," "prove-it moment," "the verdict on," "must clear the high bar." Create intrigue and urgency. Do NOT minimize or bury the major event - it is the central narrative.`;
    } else {
      // No major event, but context exists - use it to create narrative tension
      leadInstructions = `**ACT AS:** A senior market analyst writing for high-net-worth traders.

**TASK:** Write a compelling 2-3 sentence Lead Paragraph that uses the Context Dossier to frame the earnings story around the single biggest challenge or opportunity facing ${companyName}.

**CRITICAL NARRATIVE RULE - START WITH THE THESIS:**
Do NOT start with "Company X is scheduled to report earnings on [date]." Instead, START WITH THE CHALLENGE or OPPORTUNITY from the Context Dossier. Frame the earnings report as the test/verdict on that issue.

**INSTRUCTIONS:**
1. **Sentence 1 (The Thesis):** Open with the single biggest challenge, opportunity, or competitive dynamic from the Context Dossier (e.g., "As ${companyName} battles for AI dominance..." or "With investors demanding proof that [strategy] is yielding results..."). Use company name with exchange (e.g., "${companyName} (NASDAQ:${ticker})"). Frame the earnings date (${earningsDate}) as a "prove-it moment," "critical test," or "validation point" on this challenge/opportunity.

2. **Sentence 2-3 (The Stakes):** Synthesize the financial data into the narrative. Do NOT just list numbers. Instead, connect them to the thesis. ${revenueEstimate && revenueGrowth && revenueGrowth > 0 ? `Rather than saying "Revenue is expected to grow ${revenueGrowth}% to ${formatRevenue(revenueEstimate)}," frame it as: "The real story isn't the ${revenueGrowth}% revenue surge to ${formatRevenue(revenueEstimate)} - it's whether the company's [context-specific strategy from Context Dossier] is finally translating into profitable growth."` : revenueEstimate ? `Frame revenue expectations (${formatRevenue(revenueEstimate)}) in context of the challenge/opportunity - what does this number mean for the narrative?` : `Connect EPS expectations to the narrative - how does this metric validate or challenge the thesis?`} ${peRatio ? `With a ${peRatio.toFixed(1)}x P/E ratio${peRatio > 25 ? ` signaling premium valuation` : peRatio < 15 ? ` suggesting value opportunity` : ''}, investors are scrutinizing not just for a "beat," but for signs that ${companyName} is [winning/executing on the challenge from Context Dossier].` : ''} ${currentPrice && priceTarget && priceVsTarget === 'below' ? `Shares trading at $${currentPrice.toFixed(0)} - well below the $${priceTarget.toFixed(0)} analyst target - signal skepticism that needs to be addressed.` : ''}

**TONE:** Write like you're explaining a high-stakes situation to a sophisticated trader. Use phrases like "faces a prove-it moment," "the real story isn't X, it's Y," "scrutinizing not just for a beat, but for signs that..." Create narrative tension around the challenge/opportunity.`;
    }
  } else {
    // STANDARD FLOW: No context brief provided (regular "Generate Earnings Preview" button)
    // Keep existing logic for non-enriched articles
    leadInstructions = `**ACT AS:** A Senior Financial News Editor.
**TASK:** Write a 2-sentence Lead Paragraph for a ${companyName} earnings preview.
**GOAL:** Focus on the "Growth Story" and the pressure to deliver results.

**INSTRUCTIONS:**
1. **Sentence 1 (The Growth Story):** Open with the earnings date and the headline expectation. ${revenueGrowth && revenueGrowth > 0 ? `Highlight the ${revenueGrowth}% year-over-year revenue surge (to ${formatRevenue(revenueEstimate)}) as validation of the company's expansion strategy.` : revenueEstimate ? `Reference the revenue expectations (${formatRevenue(revenueEstimate)}) as a key metric investors are watching.` : `Mention what investors are looking for in the upcoming report.`} Use company name with exchange (e.g., "${companyName} (NASDAQ:${ticker})" or similar format based on the company's exchange).
2. **Sentence 2 (The Execution Risk):** Pivot to the "Execution Risk" and pressure to deliver. ${currentPrice && priceTarget && priceVsTarget ? `Mention that with shares trading ${priceVsTarget} the average analyst target (current price ~$${currentPrice.toFixed(0)} vs target $${priceTarget.toFixed(0)})` : currentPrice ? `With shares trading near $${currentPrice.toFixed(0)}` : `With current market positioning`}, ${trackRecord === 'mixed' && quarters > 0 ? `the company faces ${beats === 1 && quarters === 4 ? 'significant' : 'high'} pressure to deliver given its mixed track record of ${beats} beat${beats !== 1 ? 's' : ''} in the last ${quarters} quarters` : trackRecord === 'strong' ? `the company needs to maintain its strong track record` : `the company faces pressure to deliver`}. ${epsEstimate !== null && epsPrior !== null ? epsEstimate > epsPrior && epsEstimate < 0 ? `Focus on the need to narrow losses to the expected $${Math.abs(epsEstimate).toFixed(2)} per share` : epsEstimate > 0 && epsPrior < 0 ? `The company must demonstrate profitability with EPS of $${epsEstimate.toFixed(2)}` : `EPS expectations are $${epsEstimate.toFixed(2)} per share` : epsEstimate !== null ? `EPS expectations are $${epsEstimate.toFixed(2)} per share` : ''}${priceVsTarget === 'above' && priceTarget ? ` and bridge the gap between its stock price and analyst targets` : ''}.

**TONE:** Write in a journalistic, editorial style. Use strong, engaging language (e.g., "banking on", "faces pressure", "validate", "deliver a clean beat"). Avoid generic phrases like "investors are watching" or "analysts expect".`;
  }
  
  const prompt = `You are a professional financial journalist writing an earnings preview article for ${companyName} (${ticker}). Today is ${dayOfWeek}.

${contextBrief ? `CONTEXT BRIEF (Recent News & Events):
${JSON.stringify(contextBrief, null, 2)}

CRITICAL CONTEXT INSTRUCTION: Review the context_brief data above. If major_event_detected is TRUE (e.g., a lawsuit, recall, crash, or significant negative news), you MUST mention this event in the first paragraph as a counter-weight to the financial expectations. Do not bury this news. If major_event_detected is FALSE, focus the lead paragraph purely on the financial growth/decline metrics.

` : ''}${sourceContent ? `═══════════════════════════════════════════════════════════════
SOURCE ARTICLE CONTENT (MANDATORY TO REFERENCE - DO NOT IGNORE):
═══════════════════════════════════════════════════════════════
${sourceContent.substring(0, 3000)}${sourceContent.length > 3000 ? '...' : ''}

⚠️ CRITICAL SOURCE ARTICLE REQUIREMENTS - THIS IS MANDATORY:
1. **YOU MUST MENTION THE SOURCE ARTICLE'S MAIN TOPIC IN THE LEAD PARAGRAPH**: The source article above contains information that MUST be referenced. This is NOT optional. If you ignore this requirement, the article will be incomplete.
2. **For M&A/Strategic News**: If the source discusses acquisitions (e.g., "$82.7 billion all-cash offer"), partnerships, strategic moves, or major business developments, you MUST:
   - Mention the specific deal/event in the lead paragraph (e.g., "Netflix's $82.7 billion all-cash offer for Warner Bros Discovery")
   - Include specific numbers and company names from the source
   - Connect it to earnings expectations or investor sentiment
3. **For Benzinga URLs**: The source URL will be hyperlinked in the lead paragraph - you MUST mention the key development so the hyperlink has meaningful context. The hyperlink text should reference the main topic (e.g., "acquisition deal", "$82.7 billion offer", "strategic move").
4. **Use Specific Details**: Include specific facts, numbers, company names, and details from the source. Examples:
   - ✅ GOOD: "Netflix's $82.7 billion all-cash offer for Warner Bros Discovery"
   - ✅ GOOD: "the strategic partnership expansion with HD Hyundai"
   - ❌ BAD: "recent developments" or "strategic moves" (too vague)
5. **Connect to Earnings**: Frame how the source article's news relates to earnings expectations, investor sentiment, or the company's financial outlook.

═══════════════════════════════════════════════════════════════
` : ''}UPCOMING EARNINGS:
- Earnings Date: ${earningsDate}
${epsEstimate !== null ? `- EPS Estimate: $${epsEstimate.toFixed(2)}${epsPrior !== null ? ` (${epsEstimate > epsPrior ? 'Up' : epsEstimate < epsPrior ? 'Down' : 'Flat'} from $${epsPrior.toFixed(2)} YoY)` : ''}` : ''}
${revenueEstimate ? `- Revenue Estimate: ${formatRevenue(revenueEstimate)}${revenuePrior ? ` (${parseFloat(revenueEstimate.toString()) > parseFloat(revenuePrior.toString()) ? 'Up' : parseFloat(revenueEstimate.toString()) < parseFloat(revenuePrior.toString()) ? 'Down' : 'Flat'} from ${formatRevenue(revenuePrior)} YoY)` : ''}` : ''}
${peRatio !== null ? `- ${useForwardPE ? 'Forward' : ''} P/E Ratio: ${peRatio.toFixed(1)}x (${peRatio > 25 ? 'Indicates premium valuation' : peRatio < 15 ? 'Indicates value opportunity' : 'Suggests fair valuation'})` : ''}
${impliedVolatility !== null ? `- Implied Volatility: ${impliedVolatility.toFixed(1)}%${ivRank !== null ? ` (IV Rank: ${ivRank.toFixed(0)}%)` : ''} - Higher IV indicates options traders expect significant price movement around earnings` : ''}

ANALYST SENTIMENT:
${consensusRatings ? `- Consensus Rating: ${consensusRatings.consensus_rating ? consensusRatings.consensus_rating.charAt(0) + consensusRatings.consensus_rating.slice(1).toLowerCase() : 'N/A'}
- Average Price Target: $${consensusRatings.consensus_price_target ? parseFloat(consensusRatings.consensus_price_target.toString()).toFixed(2) : 'N/A'}
- Buy/Hold/Sell: ${consensusRatings.buy_percentage ? parseFloat(consensusRatings.buy_percentage.toString()).toFixed(1) : '0'}% Buy, ${consensusRatings.hold_percentage ? parseFloat(consensusRatings.hold_percentage.toString()).toFixed(1) : '0'}% Hold, ${consensusRatings.sell_percentage ? parseFloat(consensusRatings.sell_percentage.toString()).toFixed(1) : '0'}% Sell
- Total Analysts: ${consensusRatings.total_analyst_count || 'N/A'}` : '- No consensus data available'}

${recentAnalystActions && recentAnalystActions.length > 0 ? `NOTABLE RECENT ANALYST MOVES (Last 5-7 Actions):
${recentAnalystActions.map((action: any) => {
  let dateStr = '';
  if (action.date) {
    try {
      const date = new Date(action.date);
      dateStr = ` (${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`;
    } catch (e) {
      // If date parsing fails, skip date
    }
  }
  return `- ${action.firm}: ${action.action}${dateStr}`;
}).join('\n')}
Note: Full analyst coverage indicates ${consensusRatings?.total_analyst_count ? `a wide range of opinions from ${consensusRatings.total_analyst_count} analysts` : 'divergent views on valuation'}, reflecting the market's split view on ${companyName}'s valuation.` : ''}

CURRENT STOCK DATA:
- Current Price: $${currentPrice.toFixed(2)}
- Market Status: ${marketStatus}

${historicalEarnings && historicalEarnings.quarters && historicalEarnings.quarters.length > 0 ? `HISTORICAL EARNINGS PERFORMANCE (Last ${historicalEarnings.quarters.length} Quarters):
${historicalEarnings.quarters.filter((q: any) => {
  // Include quarters that have either actual EPS/revenue OR estimates (for context)
  const hasEpsData = (q.eps !== null && q.eps !== undefined) || (q.eps_estimate !== null && q.eps_estimate !== undefined);
  const hasRevenueData = (q.revenue !== null && q.revenue !== undefined) || (q.revenue_estimate !== null && q.revenue_estimate !== undefined);
  return hasEpsData || hasRevenueData;
}).map((q: any) => {
  const date = q.date ? formatEarningsDate(q.date) : 'N/A';
  const epsActual = (q.eps !== null && q.eps !== undefined) ? `$${typeof q.eps === 'string' ? parseFloat(q.eps).toFixed(2) : q.eps.toFixed(2)}` : null;
  const epsEst = (q.eps_estimate !== null && q.eps_estimate !== undefined) ? `$${typeof q.eps_estimate === 'string' ? parseFloat(q.eps_estimate).toFixed(2) : q.eps_estimate.toFixed(2)}` : null;
  const epsSurprise = q.eps_surprise !== null && q.eps_surprise !== undefined ? `${q.eps_surprise > 0 ? '+' : ''}${q.eps_surprise.toFixed(1)}%` : null;
  const revenueActual = (q.revenue !== null && q.revenue !== undefined) ? formatRevenue(q.revenue) : null;
  const revenueEst = (q.revenue_estimate !== null && q.revenue_estimate !== undefined) ? formatRevenue(q.revenue_estimate) : null;
  const revenueSurprise = q.revenue_surprise !== null && q.revenue_surprise !== undefined ? `${q.revenue_surprise > 0 ? '+' : ''}${q.revenue_surprise.toFixed(1)}%` : null;
  const beatMiss = q.beat_miss || null;
  
  let line = `- ${date}: `;
  if (epsActual && epsEst) {
    line += `EPS ${epsActual} vs ${epsEst} estimate`;
    if (beatMiss && epsSurprise) {
      line += ` (${beatMiss} by ${epsSurprise})`;
    }
  } else if (epsEst) {
    line += `EPS Estimate: ${epsEst}`;
  }
  if (revenueActual && revenueEst) {
    line += `, Revenue ${revenueActual} vs ${revenueEst} estimate${revenueSurprise ? ` (${revenueSurprise} surprise)` : ''}`;
  } else if (revenueEst) {
    line += revenueActual ? `, Revenue: ${revenueActual}` : `, Revenue Estimate: ${revenueEst}`;
  }
  return line;
}).join('\n')}

Historical Statistics:
- Beat/Miss Record: ${historicalEarnings.beats} beats, ${historicalEarnings.misses} misses (${historicalEarnings.beat_rate.toFixed(0)}% beat rate)
${historicalEarnings.avg_eps_surprise !== null ? `- Average EPS Surprise: ${historicalEarnings.avg_eps_surprise > 0 ? '+' : ''}${historicalEarnings.avg_eps_surprise.toFixed(1)}%` : ''}
` : ''}

CRITICAL STRUCTURAL REQUIREMENTS:

1. **HEADLINE**: Write a clear, engaging headline in the style: "[Company Name] Earnings Preview: What to Expect" (plain text, no markdown)

2. **LEAD PARAGRAPH** (${contextBrief ? '2-3 sentences' : 'exactly 2 sentences'}):
   ${leadInstructions}
   
   **CRITICAL:** Include a THREE-WORD hyperlink to the Benzinga earnings page in the first sentence. Format: <a href="https://www.benzinga.com/quote/${ticker}/earnings">[three consecutive words]</a>. Embed it naturally (e.g., "is scheduled to <a href="https://www.benzinga.com/quote/${ticker}/earnings">report earnings on</a> February 26").
   
   ${sourceUrl && sourceUrl.includes('benzinga.com') ? `**MANDATORY SOURCE ARTICLE REFERENCE:** The source article provided above contains critical information that MUST be mentioned in the lead paragraph. You MUST:
   1. Reference the main topic/event from the source article (e.g., "Netflix's $82.7 billion all-cash offer for Warner Bros Discovery" or "the strategic acquisition deal")
   2. Include a hyperlink to the source article embedded naturally within three consecutive words using: <a href="${sourceUrl}">three consecutive words</a>
   3. Connect the source article's news to the earnings context (e.g., how the acquisition might impact earnings expectations, investor sentiment, or financial outlook)
   
   EXAMPLE FORMAT: "Netflix (NASDAQ:NFLX) is scheduled to <a href="https://www.benzinga.com/quote/NFLX/earnings">report earnings on</a> April 16, 2026, as the company's <a href="${sourceUrl}">$82.7 billion acquisition</a> of Warner Bros Discovery adds complexity to its financial outlook..."
   
   Do NOT skip this - the source article was provided specifically to add context to the earnings story.` : ''}
   
   **OUTPUT:** Provide only the lead paragraph text with the embedded hyperlink(s). No labels, no section headers.

3. **SECTION MARKERS** (REQUIRED - use these EXACT markers):
   ${sourceUrl && !sourceUrl.includes('benzinga.com') ? `   - **CRITICAL:** After the lead paragraph, add a second paragraph that cites the source URL and summarizes the key development from the source article. Format: "According to <a href="${sourceUrl}">[source name]</a>, [summarize the main topic/event from the source article - be specific with details, numbers, and company names]. [Connect this development to how it might impact earnings expectations or investor sentiment]." This citation paragraph MUST mention the main topic from the source article - do not be vague.` : ''}
   - Insert "## Section: What to Expect" after the lead paragraph${sourceUrl && !sourceUrl.includes('benzinga.com') ? ' (and after the source citation paragraph)' : ''}
   - Insert "## Section: Historical Performance" after "What to Expect" (if historical data is available)
   - Insert "## Section: Analyst Sentiment" after the expectations/historical section
   - Insert "## Section: Technical Setup" (optional - include if relevant technical context is available)
   - Insert "## Section: Key Metrics to Watch" before the final sections
   - Insert "## Section: Price Action" immediately before the automatically-generated price action line

4. **SECTION: What to Expect**:
   ${contextBrief ? `- CRITICAL: Do NOT just list numbers. Synthesize the data into the narrative established in the lead paragraph.
   - Start with ONE sentence that connects the earnings date to the central challenge/opportunity from the Context Dossier.
   - Format earnings data as HTML bullet points, but frame each metric in context of the narrative:
     <ul>
     <li><strong>EPS Estimate</strong>: $X.XX (Up/Down from $X.XX YoY) - but frame it: "EPS expectations of $X.XX represent [what this means for the challenge/opportunity]"</li>
     <li><strong>Revenue Estimate</strong>: $X.XX billion/million (Up/Down from $X.XX billion/million YoY) - connect to the narrative: "Revenue of $X.XX would validate/invalidate [the central thesis from Context Dossier]"</li>
     ${peRatio !== null ? `<li><strong>Valuation</strong>: ${useForwardPE ? 'Forward' : ''} P/E of ${peRatio.toFixed(1)}x - explain what this means for the narrative: "${peRatio > 25 ? 'Premium' : peRatio < 15 ? 'Value' : 'Fair'} valuation suggests investors are [betting on/challenging] [the central thesis]"</li>` : ''}
     ${impliedVolatility !== null ? `<li><strong>Implied Volatility</strong>: ${impliedVolatility.toFixed(1)}%${ivRank !== null ? ` (IV Rank: ${ivRank.toFixed(0)}%)` : ''} - Options traders are pricing in significant expected price movement, ${impliedVolatility > 40 ? 'suggesting high uncertainty and potential for outsized moves' : impliedVolatility > 25 ? 'indicating moderate expectations for price swings' : 'reflecting relatively calm market expectations'}</li>` : ''}
     </ul>
   - Every number should answer "Why does this matter for the story?"` : `- Start with ONE introductory sentence referencing the earnings date
   - Format earnings data as HTML bullet points with bold labels:
     <ul>
     <li><strong>EPS Estimate</strong>: $X.XX (Up/Down from $X.XX YoY)</li>
     <li><strong>Revenue Estimate</strong>: $X.XX billion/million (Up/Down from $X.XX billion/million YoY)</li>
     ${peRatio !== null ? `<li><strong>Valuation</strong>: ${useForwardPE ? 'Forward' : ''} P/E of ${peRatio.toFixed(1)}x (Indicates ${peRatio > 25 ? 'premium valuation' : peRatio < 15 ? 'value opportunity' : 'fair valuation'})</li>` : ''}
     ${impliedVolatility !== null ? `<li><strong>Implied Volatility</strong>: ${impliedVolatility.toFixed(1)}%${ivRank !== null ? ` (IV Rank: ${ivRank.toFixed(0)}%)` : ''} - ${impliedVolatility > 40 ? 'High IV suggests options traders expect significant price movement' : impliedVolatility > 25 ? 'Moderate IV indicates expected price swings around earnings' : 'Lower IV reflects relatively calm market expectations'}</li>` : ''}
     </ul>`}

${historicalEarnings && historicalEarnings.quarters && historicalEarnings.quarters.length > 0 ? `5. **SECTION: Historical Performance** (MANDATORY - CRITICAL: Historical data has been provided above and you MUST use it):
   - CRITICAL INSTRUCTION: The "HISTORICAL EARNINGS PERFORMANCE" section above contains DATA with specific quarterly results (actuals and/or estimates). You MUST use this data. Do NOT write "specific historical performance data is not provided" or similar phrases - the data IS provided above.
   - Add a new section "## Section: Historical Performance" after "What to Expect"
   ${historicalEarnings.beats + historicalEarnings.misses > 0 ? `- Start with a sentence using the ACTUAL beat/miss record from above: "The company has beat estimates in ${historicalEarnings.beats} of the last ${historicalEarnings.quarters.length} quarters"${historicalEarnings.avg_eps_surprise !== null && Math.abs(historicalEarnings.avg_eps_surprise) >= 0.1 ? ` with an average EPS surprise of ${historicalEarnings.avg_eps_surprise > 0 ? '+' : ''}${historicalEarnings.avg_eps_surprise.toFixed(1)}%` : ''}.` : `- Start by referencing the quarterly data provided above. Mention trends in estimates over recent quarters (e.g., "EPS estimates have shown improvement from $-0.10 to $-0.09" or "Revenue estimates indicate steady growth").`}
   ${historicalEarnings.quarters && historicalEarnings.quarters.length > 0 ? `- Provide detailed analysis using specific quarters from the quarterly breakdown above. Reference at least 2-3 specific quarters with actual numbers (dates, EPS estimates/actuals, revenue estimates/actuals). Analyze trends - are estimates improving or declining? Are there patterns in beats/misses? How has revenue growth trended?
   - Add context about what the historical data suggests for the upcoming earnings (e.g., "Given the pattern of [beats/misses], investors should watch for..." or "The trend in revenue estimates suggests...")
   - Reference the most recent quarter specifically with all relevant data points
   ` : ''}
   - Provide analysis and context, not just raw numbers
   - Keep this section to 3-4 sentences but ensure it includes specific data points and meaningful analysis

6. **SECTION: Analyst Sentiment**:` : '5. **SECTION: Analyst Sentiment**:'}
   - Consensus rating and average price target
   - Recent analyst moves if available, formatted as:
     <strong>Analyst Consensus & Recent Actions:</strong>
     The stock carries a [Rating] Rating with an average price target of $[Target]. Notable recent moves include:
     ${recentAnalystActions && recentAnalystActions.length > 0 ? `\n<ul>\n${recentAnalystActions.map((action: any) => {
       let dateStr = '';
       if (action.date) {
         try {
           const date = new Date(action.date);
           dateStr = ` (${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`;
         } catch (e) {
           // If date parsing fails, skip date
         }
       }
       return `<li><strong>${action.firm}</strong>: ${action.action}${dateStr}</li>`;
     }).join('\n')}\n</ul>\nFull analyst coverage indicates ${consensusRatings?.total_analyst_count ? `a wide divergence in price targets from ${consensusRatings.total_analyst_count} analysts` : 'a wide divergence in price targets'}, reflecting the market's split view on ${companyName}'s valuation.` : ''}
   - Valuation Insight (if P/E and consensus available): Bold "Valuation Insight:" and italicize the rest

${historicalEarnings && historicalEarnings.quarters && historicalEarnings.quarters.length > 0 ? '7' : '6'}. **SECTION: Key Metrics to Watch**:
   - This section should be SPECIFIC and DATA-DRIVEN, not generic
   - Include 2-3 specific metrics that are relevant to ${companyName}'s business model
   - For technology/social media companies: user growth (DAU/MAU), advertising revenue trends, ARPU (average revenue per user), engagement metrics, platform revenue mix
   - For financial companies: net interest margin, loan growth, credit quality metrics, deposit trends
   - For retail/consumer: same-store sales, e-commerce growth, margin trends, inventory levels
   - For industrial/manufacturing: order backlog, capacity utilization, pricing power, supply chain metrics
   - Reference what to watch FOR with context (e.g., "Watch for continued growth in daily active users, which reached X million last quarter" or "Keep an eye on advertising revenue growth rates, which have averaged X% over the past four quarters")
   - If available, mention specific thresholds or comparisons from historical data
   - Avoid generic phrases like "user engagement" or "revenue growth" without specific context

${historicalEarnings && historicalEarnings.quarters && historicalEarnings.quarters.length > 0 ? '8' : '7'}. **PARAGRAPH LENGTH**: All paragraphs must be 2 sentences or less. Keep content concise and focused.

${historicalEarnings && historicalEarnings.quarters && historicalEarnings.quarters.length > 0 ? '9' : '8'}. **TONE**: Write in a conversational, direct tone. Use clear, accessible language. Avoid overly formal or sophisticated words.

${historicalEarnings && historicalEarnings.quarters && historicalEarnings.quarters.length > 0 ? '10' : '9'}. **STRUCTURE**: The article should flow logically from expectations → historical performance (if available) → analyst sentiment → technical setup (if included) → key metrics → price action.

CRITICAL: Do NOT write any content in the "## Section: Price Action" section - just place the section marker. The price action line is automatically generated and added after your article.

Generate the earnings preview article:`;

  try {
    const response = await aiProvider.generateCompletion(
      [{ role: 'user', content: prompt }],
      {
        model,
        temperature: 0.3,
        maxTokens,
      },
      providerOverride
    );
    
    return response.content.trim();
  } catch (error) {
    console.error('Error generating earnings preview:', error);
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    console.log('[EARNINGS PREVIEW] Received request');
    
    // Parse request body with error handling
    let requestBody;
    try {
      requestBody = await request.json();
      console.log('[EARNINGS PREVIEW] Request body keys:', Object.keys(requestBody));
      console.log('[EARNINGS PREVIEW] Request body:', JSON.stringify(requestBody).substring(0, 500));
    } catch (parseError) {
      console.error('[EARNINGS PREVIEW] Error parsing request body:', parseError);
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 });
    }
    
    const { tickers, provider, skipSEOSubheads, contextBriefs, sourceUrl } = requestBody;

    if (!tickers || !tickers.trim()) {
      console.error('[EARNINGS PREVIEW] Missing tickers in request');
      return NextResponse.json({ error: 'Please provide ticker(s)' }, { status: 400 });
    }
    
    console.log('[EARNINGS PREVIEW] Processing tickers:', tickers);

    const tickerList = tickers.split(',').map((t: string) => t.trim().toUpperCase());
    const aiProviderOption: AIProvider | undefined = provider && (provider === 'openai' || provider === 'gemini')
      ? provider
      : undefined;

    const backendUrl = process.env.NEWS_AGENT_BACKEND_URL;
    // Automatically enable SEO subheads for Enrich First mode (contextBriefs provided)
    // For regular mode, enable if not skipped
    const enableSEOSubheads = !skipSEOSubheads;

    const previews = await Promise.all(
      tickerList.map(async (ticker: string) => {
        try {
          // Step 1: Use provided context brief if available, otherwise fetch it
          let contextBrief = contextBriefs && contextBriefs[ticker] ? contextBriefs[ticker] : null;
          if (contextBrief) {
            console.log(`[CONTEXT BRIEF] ${ticker}: Using provided context brief from frontend:`, {
              hasData: !!contextBrief,
              majorEventDetected: contextBrief?.major_event_detected || false,
              sentiment: contextBrief?.sentiment || null,
              hasSummary: !!contextBrief?.summary_of_events,
              articleCount: contextBrief?.articles?.length || 0
            });
          } else {
            contextBrief = await fetchContextBrief(ticker, backendUrl);
          }
          
          // Step 2: Scrape source URL if provided
          let sourceContent: string | null = null;
          if (sourceUrl && sourceUrl.trim()) {
            try {
              console.log(`[EARNINGS PREVIEW] ${ticker}: Scraping source URL: ${sourceUrl}`);
              sourceContent = await scrapeNewsUrl(sourceUrl.trim());
              if (sourceContent) {
                console.log(`[EARNINGS PREVIEW] ${ticker}: Successfully scraped source URL, content length: ${sourceContent.length}`);
              } else {
                console.log(`[EARNINGS PREVIEW] ${ticker}: Failed to scrape source URL`);
              }
            } catch (error) {
              console.error(`[EARNINGS PREVIEW] ${ticker}: Error scraping source URL:`, error);
            }
          }
          
          // Step 3: Fetch all financial data in parallel
          const [basicStockData, nextEarnings, consensusRatings, recentAnalystActions, peRatio, historicalEarnings] = await Promise.all([
            fetchBasicStockData(ticker),
            fetchNextEarningsDate(ticker),
            fetchConsensusRatings(ticker),
            fetchRecentAnalystActions(ticker, 999), // Fetch all analyst actions (will deduplicate by firm)
            fetchPERatio(ticker),
            fetchHistoricalEarnings(ticker, 4),
          ]);

          if (!basicStockData) {
            return {
              ticker,
              error: 'Failed to fetch stock data'
            };
          }

          if (!nextEarnings) {
            return {
              ticker,
              error: 'No upcoming earnings date found'
            };
          }

          const companyName = basicStockData.companyName;
          const currentPrice = basicStockData.currentPrice;

          // Log historical earnings data for debugging
          console.log(`[EARNINGS PREVIEW] ${ticker}: Historical earnings data:`, {
            hasData: !!historicalEarnings,
            quartersCount: historicalEarnings?.quarters?.length || 0,
            beats: historicalEarnings?.beats || 0,
            misses: historicalEarnings?.misses || 0,
            avgSurprise: historicalEarnings?.avg_eps_surprise || null,
            firstQuarter: historicalEarnings?.quarters?.[0] || null
          });

          // Generate initial earnings preview article (with context brief and source URL)
          let preview = await generateEarningsPreview(
            ticker,
            companyName,
            nextEarnings,
            consensusRatings,
            recentAnalystActions,
            peRatio,
            currentPrice,
            historicalEarnings,
            contextBrief,
            aiProviderOption,
            sourceUrl,
            sourceContent || undefined
          );

          // Add "Also Read" section from related articles (after first paragraph)
          const relatedArticles = await fetchRelatedArticles(ticker);
          if (relatedArticles && relatedArticles.length > 0) {
            const alsoReadArticle = relatedArticles[0];
            
            // Insert "Also Read" after first paragraph (before "## Section: What to Expect")
            // Find the first section marker
            const sectionMarkerMatch = preview.match(/##\s*Section:/);
            if (sectionMarkerMatch && sectionMarkerMatch.index !== undefined) {
              const beforeSection = preview.substring(0, sectionMarkerMatch.index).trim();
              const afterSection = preview.substring(sectionMarkerMatch.index);
              // Check if "Also Read" already exists
              if (!beforeSection.includes('Also Read:')) {
                preview = `${beforeSection}\n\nAlso Read: <a href="${alsoReadArticle.url}">${alsoReadArticle.headline}</a>\n\n${afterSection}`;
              }
            } else {
              // Fallback: insert after first paragraph
              const paragraphs = preview.split(/\n\n+/);
              if (paragraphs.length > 1 && !preview.includes('Also Read:')) {
                paragraphs.splice(1, 0, `Also Read: <a href="${alsoReadArticle.url}">${alsoReadArticle.headline}</a>`);
                preview = paragraphs.join('\n\n');
              }
            }
          }

          // If contextBriefs were provided (Enrich First mode), automatically add news section
          if (contextBriefs && contextBriefs[ticker]) {
            if (!backendUrl) {
              console.log(`⚠️ [ENRICH FIRST] ${ticker}: NEWS_AGENT_BACKEND_URL not configured, cannot fetch news section. Please configure NEWS_AGENT_BACKEND_URL environment variable.`);
            } else {
              try {
                console.log(`[ENRICH FIRST] ${ticker}: Fetching news section for Enrich First mode...`);
                const newsSection = await fetchNewsSection(ticker, preview, backendUrl);
                if (newsSection) {
                  // Insert the news section between "Historical Performance" and "Analyst Sentiment"
                  const analystSentimentMarker = /##\s*Section:\s*Analyst Sentiment/i;
                  
                  if (analystSentimentMarker.test(preview)) {
                    const match = preview.match(analystSentimentMarker);
                    if (match && match.index !== undefined) {
                      const beforeAnalyst = preview.substring(0, match.index).trim();
                      const afterAnalyst = preview.substring(match.index);
                      preview = beforeAnalyst + '\n\n' + newsSection + '\n\n' + afterAnalyst;
                      console.log(`✅ [ENRICH FIRST] ${ticker}: Inserted news section before Analyst Sentiment`);
                    }
                  } else {
                    // Fallback: try to insert after Historical Performance
                    const historicalPerformanceMarker = /(##\s*Section:\s*Historical Performance[\s\S]*?)(?=##\s*Section:|$)/i;
                    if (historicalPerformanceMarker.test(preview)) {
                      preview = preview.replace(
                        historicalPerformanceMarker,
                        `$1\n\n${newsSection}\n\n`
                      );
                      console.log(`✅ [ENRICH FIRST] ${ticker}: Inserted news section after Historical Performance`);
                    } else {
                      // Last resort: append at end
                      preview += `\n\n${newsSection}`;
                      console.log(`✅ [ENRICH FIRST] ${ticker}: Appended news section at end`);
                    }
                  }
                } else {
                  console.log(`⚠️ [ENRICH FIRST] ${ticker}: fetchNewsSection returned null, news section not added`);
                }
              } catch (newsError) {
                console.error(`❌ [ENRICH FIRST] ${ticker}: Error fetching news section:`, newsError);
              }
            }
          }

          // Fetch ETF information
          let etfInfo = '';
          try {
            const etfs = await fetchETFs(ticker);
            if (etfs && etfs.length > 0) {
              etfInfo = formatETFInfo(etfs, ticker);
              
              // Insert ETF section before Price Action
              const priceActionMarker = /##\s*Section:\s*Price Action/i;
              if (priceActionMarker.test(preview)) {
                preview = preview.replace(priceActionMarker, `${etfInfo}\n\n## Section: Price Action`);
              } else {
                preview += `\n\n${etfInfo}`;
              }
            }
          } catch (etfError) {
            console.error(`Error fetching ETF data for ${ticker}:`, etfError);
          }

          // Generate and append price action
          const priceAction = await generatePriceAction(ticker, companyName);
          if (priceAction) {
            // Remove any existing price action marker
            preview = preview.replace(/##\s*Section:\s*Price Action\s*/gi, '').trim();
            preview += `\n\n## Section: Price Action\n\n${priceAction}`;
          }

          // Insert "Read Next" at the VERY END (after ETF and Price Action sections)
          if (relatedArticles && relatedArticles.length > 0) {
            // Remove any existing "Read Next" section first
            const readNextPattern = /Read Next:.*?(?=\n\n|$)/gi;
            preview = preview.replace(readNextPattern, '').trim();
            
            const readNextArticle = relatedArticles.length > 1 ? relatedArticles[1] : relatedArticles[0];
            // Always add at the very end
            preview = `${preview.trim()}\n\nRead Next: <a href="${readNextArticle.url}">${readNextArticle.headline}</a>`;
          }

          // Inject SEO subheads (FINAL STEP, if enabled)
          // Automatically enabled for Enrich First mode, or if not skipped for regular mode
          if (enableSEOSubheads && backendUrl) {
            try {
              console.log(`[SEO SUBHEADS] ${ticker}: Injecting SEO subheads${contextBriefs && contextBriefs[ticker] ? ' (Enrich First mode - automatic)' : ''}...`);
              const articleWithSubheads = await injectSEOSubheads(preview, backendUrl);
              if (articleWithSubheads) {
                preview = articleWithSubheads;
                console.log(`✅ [SEO SUBHEADS] ${ticker}: SEO subheads injected successfully (final step)`);
              }
            } catch (error) {
              console.error(`⚠️ [SEO SUBHEADS] ${ticker}: SEO subhead injection failed, using original article:`, error);
            }
          } else if (enableSEOSubheads && !backendUrl) {
            console.log(`⚠️ [SEO SUBHEADS] ${ticker}: NEWS_AGENT_BACKEND_URL not configured, skipping SEO subhead injection`);
          }

          return {
            ticker,
            preview,
            earningsDate: typeof nextEarnings === 'object' && nextEarnings.date ? nextEarnings.date : null,
          };
        } catch (error: any) {
          console.error(`Error generating earnings preview for ${ticker}:`, error);
          return {
            ticker,
            error: error.message || 'Failed to generate earnings preview'
          };
        }
      })
    );

    console.log('[EARNINGS PREVIEW] Successfully generated previews:', previews.length);
    return NextResponse.json({ previews });
  } catch (error: any) {
    console.error('[EARNINGS PREVIEW] Error in earnings preview endpoint:', error);
    console.error('[EARNINGS PREVIEW] Error stack:', error?.stack);
    console.error('[EARNINGS PREVIEW] Error name:', error?.name);
    
    // Return detailed error for debugging
    const errorMessage = error?.message || 'Failed to generate earnings preview';
    const errorStatus = error?.status || 500;
    
    return NextResponse.json(
      { 
        error: errorMessage,
        details: process.env.NODE_ENV === 'development' ? error?.stack : undefined
      },
      { status: errorStatus }
    );
  }
}

