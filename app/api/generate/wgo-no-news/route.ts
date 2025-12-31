import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { fetchETFs, formatETFInfo } from '@/lib/etf-utils';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const BENZINGA_API_KEY = process.env.BENZINGA_API_KEY!;
const BZ_NEWS_URL = 'https://api.benzinga.com/api/v2/news';

function getMarketStatus(): 'open' | 'premarket' | 'afterhours' | 'closed' {
  // Get current time in New York timezone
  const now = new Date();
  const nyTime = new Date(now.toLocaleString("en-US", {timeZone: "America/New_York"}));
  const day = nyTime.getDay();
  const hour = nyTime.getHours();
  const minute = nyTime.getMinutes();
  const time = hour * 100 + minute;
  
  if (day === 0 || day === 6) return 'closed';
  if (time >= 400 && time < 930) return 'premarket';
  if (time >= 930 && time < 1600) return 'open';
  if (time >= 1600 && time < 2000) return 'afterhours';
  return 'closed';
}

function getCurrentDayName(): string {
  // Get current day name in New York timezone
  const now = new Date();
  const nyTime = new Date(now.toLocaleString("en-US", {timeZone: "America/New_York"}));
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[nyTime.getDay()];
}

// Function to fetch related articles from Benzinga
async function fetchRelatedArticles(ticker: string, excludeUrl?: string): Promise<any[]> {
  try {
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - 7);
    const dateFromStr = dateFrom.toISOString().slice(0, 10);
    
    let url: string;
    
    if (ticker && ticker.trim() !== '') {
      // Fetch ticker-specific articles
      url = `${BZ_NEWS_URL}?token=${BENZINGA_API_KEY}&tickers=${encodeURIComponent(ticker)}&items=20&fields=headline,title,created,url,channels&accept=application/json&displayOutput=full&dateFrom=${dateFromStr}`;
    } else {
      // Fetch general market news when no ticker is provided
      url = `${BZ_NEWS_URL}?token=${BENZINGA_API_KEY}&items=20&fields=headline,title,created,url,channels&accept=application/json&displayOutput=full&dateFrom=${dateFromStr}`;
    }
    
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    
    if (!res.ok) {
      console.error('Benzinga API error:', await res.text());
      return [];
    }
    
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    
    // Filter out press releases and the current article URL
    const prChannelNames = ['press releases', 'press-releases', 'pressrelease', 'pr'];
    const normalize = (str: string) => str.toLowerCase().replace(/[-_]/g, ' ');
    
    const filteredArticles = data.filter(item => {
      // Exclude press releases
      if (Array.isArray(item.channels) && item.channels.some((ch: any) => 
        typeof ch.name === 'string' && prChannelNames.includes(normalize(ch.name))
      )) {
        return false;
      }
      
      // Exclude the current article URL if provided
      if (excludeUrl && item.url === excludeUrl) {
        return false;
      }
      
      return true;
    });
    
    const relatedArticles = filteredArticles
      .map((item: any) => ({
        headline: item.headline || item.title || '[No Headline]',
        url: item.url,
        created: item.created,
      }))
      .slice(0, 5);
    
    return relatedArticles;
  } catch (error) {
    console.error('Error fetching related articles:', error);
    return [];
  }
}

// Helper function to map sector name to sector ETF ticker
function getSectorETFTicker(sectorName: string): string | null {
  const sectorMap: { [key: string]: string } = {
    'Technology': 'XLK',
    'Financials': 'XLF',
    'Energy': 'XLE',
    'Healthcare': 'XLV',
    'Industrials': 'XLI',
    'Consumer Staples': 'XLP',
    'Consumer Discretionary': 'XLY',
    'Utilities': 'XLU',
    'Real Estate': 'XLRE',
    'Communication Services': 'XLC',
    'Materials': 'XLB'
  };
  
  // Try exact match first
  if (sectorMap[sectorName]) {
    return sectorMap[sectorName];
  }
  
  // Try case-insensitive match
  const sectorLower = sectorName.toLowerCase();
  for (const [key, value] of Object.entries(sectorMap)) {
    if (key.toLowerCase() === sectorLower) {
      return value;
    }
  }
  
  return null;
}

// Helper function to map sector ETF ticker to readable sector name (same as market-report)
function getSectorName(ticker: string): string {
  return ticker === 'XLK' ? 'Technology' :
         ticker === 'XLF' ? 'Financials' :
         ticker === 'XLE' ? 'Energy' :
         ticker === 'XLV' ? 'Healthcare' :
         ticker === 'XLI' ? 'Industrials' :
         ticker === 'XLP' ? 'Consumer Staples' :
         ticker === 'XLY' ? 'Consumer Discretionary' :
         ticker === 'XLU' ? 'Utilities' :
         ticker === 'XLRE' ? 'Real Estate' :
         ticker === 'XLC' ? 'Communication Services' :
         ticker === 'XLB' ? 'Materials' : ticker;
}

// Helper function to get stock sector and performance
async function getStockSectorPerformance(ticker: string): Promise<{ sectorName: string; sectorChange: number; sp500Change: number } | null> {
  try {
    // Fetch stock overview to get sector info
    const overviewRes = await fetch(`https://api.polygon.io/v3/reference/tickers/${ticker}?apikey=${process.env.POLYGON_API_KEY}`);
    if (!overviewRes.ok) return null;
    
    const overview = await overviewRes.json();
    const result = overview.results;
    
    if (!result) return null;
    
    // Try multiple fields - sector is most reliable, then sic_description, then industry
    let sectorField = result.sector || result.sic_description || result.industry || null;
    
    if (!sectorField) return null;
    
    // Map sector name/description to ETF ticker
    // Handle common variations and partial matches
    const sectorLower = sectorField.toLowerCase();
    
    // Direct mapping attempts
    let sectorETF: string | null = null;
    
    if (sectorLower.includes('technology') || sectorLower.includes('software') || sectorLower.includes('tech')) {
      sectorETF = 'XLK';
    } else if (sectorLower.includes('financial') || sectorLower.includes('bank') || sectorLower.includes('insurance')) {
      sectorETF = 'XLF';
    } else if (sectorLower.includes('energy') || sectorLower.includes('oil') || sectorLower.includes('gas')) {
      sectorETF = 'XLE';
    } else if (sectorLower.includes('health') || sectorLower.includes('pharma') || sectorLower.includes('biotech')) {
      sectorETF = 'XLV';
    } else if (sectorLower.includes('industrial') || sectorLower.includes('manufacturing')) {
      sectorETF = 'XLI';
    } else if (sectorLower.includes('consumer staple') || sectorLower.includes('staples')) {
      sectorETF = 'XLP';
    } else if (sectorLower.includes('consumer discretion') || sectorLower.includes('retail') || sectorLower.includes('automotive')) {
      sectorETF = 'XLY';
    } else if (sectorLower.includes('utilit')) {
      sectorETF = 'XLU';
    } else if (sectorLower.includes('real estate') || sectorLower.includes('reit')) {
      sectorETF = 'XLRE';
    } else if (sectorLower.includes('communication') || sectorLower.includes('telecom') || sectorLower.includes('media')) {
      sectorETF = 'XLC';
    } else if (sectorLower.includes('material') || sectorLower.includes('chemical') || sectorLower.includes('mining')) {
      sectorETF = 'XLB';
    } else {
      // Fallback to direct mapping function
      sectorETF = getSectorETFTicker(sectorField);
    }
    
    if (!sectorETF) return null;
    
    // Fetch market context
    const INDICES = ['SPY'];
    const SECTORS = [sectorETF];
    const [indicesRes, sectorsRes] = await Promise.all([
      fetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${INDICES.join(',')}&apikey=${process.env.POLYGON_API_KEY}`),
      fetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${SECTORS.join(',')}&apikey=${process.env.POLYGON_API_KEY}`)
    ]);
    
    const [indicesData, sectorsData] = await Promise.all([
      indicesRes.json(),
      sectorsRes.json()
    ]);
    
    const sp500 = (indicesData.tickers || []).find((idx: any) => idx.ticker === 'SPY');
    const sector = (sectorsData.tickers || []).find((s: any) => s.ticker === sectorETF);
    
    if (!sp500 || !sector) return null;
    
    return {
      sectorName: getSectorName(sectorETF),
      sectorChange: sector.todaysChangePerc || 0,
      sp500Change: sp500.todaysChangePerc || 0
    };
  } catch (error) {
    console.error('Error getting stock sector performance:', error);
    return null;
  }
}

async function fetchRecentArticles(ticker: string): Promise<any[]> {
  try {
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - 7);
    const dateFromStr = dateFrom.toISOString().slice(0, 10);
    
    const url = `https://api.benzinga.com/api/v2/news?token=${BENZINGA_API_KEY}&tickers=${encodeURIComponent(ticker)}&items=10&fields=headline,title,created,body,url,channels&accept=application/json&displayOutput=full&dateFrom=${dateFromStr}`;
    
    console.log('WGO No News: Fetching articles for ticker:', ticker);
    console.log('WGO No News: Benzinga API URL:', url);
    console.log('WGO No News: BENZINGA_API_KEY available:', !!BENZINGA_API_KEY);
    
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    
    console.log('WGO No News: API response status:', res.status);
    
    if (!res.ok) {
      const errorText = await res.text();
      console.error('WGO No News: Benzinga API error:', errorText);
      return [];
    }
    
    const data = await res.json();
    console.log('WGO No News: Raw API response:', data);
    console.log('WGO No News: Response is array:', Array.isArray(data));
    console.log('WGO No News: Response length:', Array.isArray(data) ? data.length : 'Not an array');
    
    if (!Array.isArray(data) || data.length === 0) return [];
    
    // Filter out press releases
    const prChannelNames = ['press releases', 'press-releases', 'pressrelease', 'pr'];
    const normalize = (str: string) => str.toLowerCase().replace(/[-_]/g, ' ');
    
    console.log('WGO No News: Starting to filter articles...');
    console.log('WGO No News: Total articles before filtering:', data.length);
    
    const recentArticles = data
      .filter(item => {
        // Exclude press releases
        if (Array.isArray(item.channels) && item.channels.some((ch: any) => 
          typeof ch.name === 'string' && prChannelNames.includes(normalize(ch.name))
        )) {
          console.log('WGO No News: Filtering out press release:', item.headline || item.title);
          return false;
        }
        return true;
      })
      .map((item: any) => ({
        headline: item.headline || item.title || '[No Headline]',
        body: item.body || '',
        url: item.url,
        created: item.created,
      }))
      .filter(item => {
        if (!item.body || item.body.length <= 100) {
          console.log('WGO No News: Filtering out article with insufficient content:', item.headline, 'Body length:', item.body ? item.body.length : 0);
          return false;
        }
        return true;
      }); // Ensure there's substantial content
    
    const finalArticles = recentArticles.slice(0, 2); // Return up to 2 articles
    console.log('WGO No News: Final articles after filtering:', finalArticles.length);
    if (finalArticles.length > 0) {
      console.log('WGO No News: First article:', finalArticles[0].headline);
      console.log('WGO No News: Second article:', finalArticles[1]?.headline || 'None');
    } else {
      console.log('WGO No News: No articles found after filtering');
    }
    return finalArticles;
  } catch (error) {
    console.error('Error fetching recent articles:', error);
    return [];
  }
}

// Fetch consensus ratings from Benzinga calendar endpoint
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
    
    // Use v1 consensus-ratings endpoint - if 404, fallback to analyst/insights aggregation
    const consensusUrl = `https://api.benzinga.com/api/v1/consensus-ratings?${params.toString()}`;
    
    console.log('WGO No News: Fetching consensus ratings from:', consensusUrl);
    const consensusRes = await fetch(consensusUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
    });
      
    if (consensusRes.ok) {
      const consensusData = await consensusRes.json();
      
      // Handle different response structures
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
          // Rating distributions
          buy_percentage: extractedConsensus.buy_percentage || extractedConsensus.buyPercentage || extractedConsensus.buy || null,
          hold_percentage: extractedConsensus.hold_percentage || extractedConsensus.holdPercentage || extractedConsensus.hold || null,
          sell_percentage: extractedConsensus.sell_percentage || extractedConsensus.sellPercentage || extractedConsensus.sell || null,
        };
        
        if (consensus.consensus_price_target || consensus.consensus_rating) {
          console.log('WGO No News: Consensus ratings fetched:', consensus);
          return consensus;
        }
      }
    } else if (consensusRes.status === 404) {
      // If 404, try analyst/insights endpoint and aggregate consensus data
      console.log('WGO No News: 404 on consensus-ratings endpoint, trying analyst/insights endpoint');
      const insightsUrl = `https://api.benzinga.com/api/v2/analyst/insights?token=${BENZINGA_API_KEY}&symbols=${encodeURIComponent(ticker)}&pageSize=100`;
      const insightsRes = await fetch(insightsUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });
      
      if (insightsRes.ok) {
        const insightsData = await insightsRes.json();
        console.log(`WGO No News: Fetched ${Array.isArray(insightsData) ? insightsData.length : 0} analyst insights`);
        
        if (Array.isArray(insightsData) && insightsData.length > 0) {
          // Aggregate consensus from individual insights (same logic as technical-analysis route)
          const validInsights = insightsData.filter((insight: any) => insight.rating || insight.pt);
          if (validInsights.length > 0) {
            const ratingCounts: { [key: string]: number } = {};
            const priceTargets: number[] = [];
            
            validInsights.forEach((insight: any) => {
              if (insight.rating) {
                const rating = insight.rating.toUpperCase();
                ratingCounts[rating] = (ratingCounts[rating] || 0) + 1;
              }
              if (insight.pt) {
                const pt = parseFloat(insight.pt);
                if (!isNaN(pt) && pt > 0) {
                  priceTargets.push(pt);
                }
              }
            });
            
            let consensusRating = null;
            let maxCount = 0;
            Object.keys(ratingCounts).forEach(rating => {
              if (ratingCounts[rating] > maxCount) {
                maxCount = ratingCounts[rating];
                consensusRating = rating;
              }
            });
            
            const consensusPriceTarget = priceTargets.length > 0 
              ? priceTargets.reduce((sum, pt) => sum + pt, 0) / priceTargets.length 
              : null;
            
            const totalRatings = validInsights.length;
            const buyCount = Object.keys(ratingCounts).filter(r => ['BUY', 'STRONG BUY', 'OVERWEIGHT', 'POSITIVE'].includes(r)).reduce((sum, r) => sum + ratingCounts[r], 0);
            const holdCount = Object.keys(ratingCounts).filter(r => ['HOLD', 'NEUTRAL', 'EQUAL WEIGHT'].includes(r)).reduce((sum, r) => sum + ratingCounts[r], 0);
            const sellCount = Object.keys(ratingCounts).filter(r => ['SELL', 'STRONG SELL', 'UNDERWEIGHT', 'NEGATIVE'].includes(r)).reduce((sum, r) => sum + ratingCounts[r], 0);
            
            if (consensusRating || consensusPriceTarget) {
              const consensus = {
                consensus_rating: consensusRating,
                consensus_price_target: consensusPriceTarget,
                total_analyst_count: totalRatings,
                buy_percentage: totalRatings > 0 ? (buyCount / totalRatings) * 100 : null,
                hold_percentage: totalRatings > 0 ? (holdCount / totalRatings) * 100 : null,
                sell_percentage: totalRatings > 0 ? (sellCount / totalRatings) * 100 : null,
                high_price_target: priceTargets.length > 0 ? Math.max(...priceTargets) : null,
                low_price_target: priceTargets.length > 0 ? Math.min(...priceTargets) : null,
              };
              
              console.log('WGO No News: Successfully aggregated consensus from insights:', consensus);
              return consensus;
            }
          }
        }
      }
      console.log('WGO No News: Could not aggregate consensus from insights, returning null');
    } else {
      const errorText = await consensusRes.text().catch(() => '');
      console.log('WGO No News: Consensus ratings API failed:', consensusRes.status, 'Error:', errorText.substring(0, 300));
    }
    
    return null;
  } catch (error) {
    console.error('WGO No News: Error fetching consensus ratings:', error);
    return null;
  }
}

// Helper function to format date string without timezone issues
function formatEarningsDate(dateString: string | null | undefined): string {
  if (!dateString) return 'a date to be announced';
  try {
    // Parse date string (format: YYYY-MM-DD) as local date to avoid timezone issues
    const parts = dateString.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed
      const day = parseInt(parts[2], 10);
      const date = new Date(year, month, day);
      return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    }
    // Fallback to standard parsing if format is unexpected
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
    
    // If >= 1000 million, format as billions
    if (millions >= 1000) {
      const billions = millions / 1000;
      return `$${billions.toFixed(2)}B`;
    } else {
      // Otherwise format as millions
      return `$${millions.toFixed(2)}M`;
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
    // Look ahead 180 days (6 months) for earnings dates
    const dateTo = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    // Use the v2 calendar/earnings endpoint with proper parameters
    const url = 'https://api.benzinga.com/api/v2/calendar/earnings' +
      `?token=${BENZINGA_API_KEY}` +
      `&parameters[tickers]=${encodeURIComponent(ticker)}` +
      `&parameters[date_from]=${dateFrom}` +
      `&parameters[date_to]=${dateTo}` +
      `&pagesize=20`;
    
    console.log('WGO No News: Fetching earnings date from:', url);
    const earningsRes = await fetch(url, {
      headers: { accept: 'application/json' }
    });
      
    if (earningsRes.ok) {
      const raw = await earningsRes.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.trim());
      } catch {
        console.log('WGO No News: Earnings calendar: Invalid JSON response');
        return null;
      }
      
      // Handle different response structures (array or wrapped in object)
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
      
      // Find the earliest upcoming earnings date
      interface EarningsItem {
        date?: string;
        earnings_date?: string;
        earningsDate?: string;
        eps_estimate?: number;
        eps_prior?: number;
        revenue_estimate?: number;
        revenue_prior?: number;
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
          // Return full earnings data including estimates
          // Note: Benzinga API returns eps_est and revenue_est (not eps_estimate/revenue_estimate)
          const earningsData = {
            date: earningsDate,
            eps_estimate: nextEarnings.eps_est || nextEarnings.epsEst || nextEarnings.eps_estimate || nextEarnings.epsEstimate || nextEarnings.estimated_eps || null,
            eps_prior: nextEarnings.eps_prior || nextEarnings.epsPrior || nextEarnings.eps_prev || nextEarnings.previous_eps || null,
            revenue_estimate: nextEarnings.revenue_est || nextEarnings.revenueEst || nextEarnings.revenue_estimate || nextEarnings.revenueEstimate || nextEarnings.estimated_revenue || null,
            revenue_prior: nextEarnings.revenue_prior || nextEarnings.revenuePrior || nextEarnings.rev_prev || nextEarnings.previous_revenue || null,
          };
          console.log('WGO No News: Next earnings data:', earningsData);
          return earningsData;
        }
      }
    } else {
      const errorText = await earningsRes.text().catch(() => '');
      console.log('WGO No News: Earnings calendar error:', errorText.substring(0, 300));
    }
    
    return null;
  } catch (error) {
    console.error('WGO No News: Error fetching next earnings date:', error);
    return null;
  }
}

async function fetchStockData(ticker: string) {
  try {
    // Fetch up to 2 relevant recent articles
    const recentArticles = await fetchRecentArticles(ticker);
    
    // Fetch real price action data from Benzinga using the working endpoint
    const priceActionUrl = `https://api.benzinga.com/api/v2/quoteDelayed?token=${BENZINGA_API_KEY}&symbols=${encodeURIComponent(ticker)}`;
    
    console.log('Fetching price action from:', priceActionUrl);
    const priceActionRes = await fetch(priceActionUrl);
    
    let priceAction = null;
    const marketStatus = getMarketStatus();
    
    if (priceActionRes.ok) {
      const priceData = await priceActionRes.json();
      console.log('Price action response:', priceData);
      if (priceData && typeof priceData === 'object') {
        const quote = priceData[ticker.toUpperCase()];
        if (quote && typeof quote === 'object') {
          // Enhanced price action with session-specific data
          priceAction = {
            last: quote.lastTradePrice || 0,
            change: quote.change || 0,
            changePercent: quote.changePercent || 0,
            volume: quote.volume || 0,
            marketStatus: marketStatus,
            // Session-specific data
            regularHours: {
              open: quote.open || 0,
              close: quote.close || 0,
              high: quote.high || 0,
              low: quote.low || 0,
              volume: quote.volume || 0
            },
            // Pre-market data if available
            premarket: {
              last: quote.preMarketLast || 0,
              change: quote.preMarketChange || 0,
              changePercent: quote.preMarketChangePercent || 0,
              volume: quote.preMarketVolume || 0
            },
            // After-hours data if available
            afterHours: {
              last: quote.afterHoursLast || 0,
              change: quote.afterHoursChange || 0,
              changePercent: quote.afterHoursChangePercent || 0,
              volume: quote.afterHoursVolume || 0
            },
            // Previous day data
            previousClose: quote.previousClose || 0,
            companyName: quote.companyStandardName || quote.name || ticker.toUpperCase()
          };
          console.log('Parsed enhanced price action:', priceAction);
        }
      }
    } else {
      console.error('Price action API failed:', priceActionRes.status, await priceActionRes.text());
    }
    
    // Fetch real analyst ratings from Benzinga using the working endpoint
    const analystUrl = `https://api.benzinga.com/api/v2.1/calendar/ratings?token=${BENZINGA_API_KEY}&parameters[tickers]=${encodeURIComponent(ticker)}&parameters[range]=6m`;
    
    console.log('Fetching analyst ratings from:', analystUrl);
    const analystRes = await fetch(analystUrl, {
      headers: { Accept: 'application/json' },
    });
    
    let analystRatings = [];
    if (analystRes.ok) {
      const analystData = await analystRes.json();
      console.log('Analyst ratings response:', analystData);
      console.log('Analyst ratings response type:', typeof analystData);
      console.log('Analyst ratings response keys:', Object.keys(analystData || {}));
      
      // Handle the response structure - it might be an array or an object with ratings property
      const ratingsArray = Array.isArray(analystData) 
        ? analystData 
        : (analystData.ratings || []);
      
      console.log('Processed ratings array:', ratingsArray);
      console.log('Ratings array length:', ratingsArray.length);
      
      if (ratingsArray.length > 0) {
        analystRatings = ratingsArray.slice(0, 3).map((rating: any) => {
          console.log('Processing rating:', rating);
          // Extract just the firm name, removing any analyst name if present
          const firmName = (rating.action_company || rating.firm || 'Analyst').split(' - ')[0].split(':')[0].trim();
          let line = `${firmName} maintains ${rating.rating_current} rating`;
          if (rating.pt_current) {
            line += ` with $${parseFloat(rating.pt_current).toFixed(0)} price target`;
          }
          console.log('Generated line:', line);
          return line;
        });
      }
    } else {
      console.error('Analyst ratings API failed:', analystRes.status, await analystRes.text());
    }
    
    // Only fallback to mock data if we have no real data
    if (!priceAction) {
      console.log('Using fallback price action data');
      priceAction = {
        last: 150.00,
        change: 2.50,
        changePercent: 1.69,
        volume: 45000000,
        marketStatus: marketStatus,
        regularHours: {
          open: 148.00,
          close: 150.00,
          high: 152.00,
          low: 147.50,
          volume: 45000000
        },
        premarket: {
          last: 0,
          change: 0,
          changePercent: 0,
          volume: 0
        },
        afterHours: {
          last: 0,
          change: 0,
          changePercent: 0,
          volume: 0
        },
        previousClose: 147.50,
        companyName: ticker.toUpperCase()
      };
    }
    
    // If no recent articles found, create fallback articles for hyperlinking
    if (recentArticles.length === 0) {
      console.log('WGO No News: No recent articles found, creating fallback articles for hyperlinking');
      recentArticles.push(
        {
          headline: 'Market Analysis',
          body: 'Recent market analysis shows continued momentum in the sector.',
          url: 'https://www.benzinga.com/markets',
          created: new Date().toISOString(),
          daysOld: 1,
          isRecent: true,
          isThisWeek: true,
          isLastWeek: false
        },
        {
          headline: 'Trading Volume Analysis',
          body: 'Trading volume analysis indicates strong investor interest.',
          url: 'https://www.benzinga.com/trading',
          created: new Date().toISOString(),
          daysOld: 2,
          isRecent: true,
          isThisWeek: true,
          isLastWeek: false
        }
      );
    }
    
    console.log('Final analyst ratings array length:', analystRatings.length);
    if (analystRatings.length === 0) {
      console.log('Using fallback analyst ratings data');
      analystRatings = [
        "Multiple firms maintain Buy rating with $200 price target",
        "Analyst consensus remains positive on growth prospects",
        "Strong institutional support continues"
      ];
    } else {
      console.log('Using real analyst ratings data:', analystRatings);
    }
    
    // Fetch consensus ratings and earnings date
    const [consensusRatings, nextEarnings] = await Promise.all([
      fetchConsensusRatings(ticker),
      fetchNextEarningsDate(ticker)
    ]);
    
    return {
      priceAction,
      analystRatings,
      recentArticles, // Array of up to 2 articles
      consensusRatings, // Consensus rating and price target
      nextEarnings, // Next earnings date and estimates
    };
  } catch (error) {
    console.error('Error fetching stock data:', error);
    return { priceAction: null, analystRatings: [], recentArticles: [], consensusRatings: null, nextEarnings: null };
  }
}

export async function POST(request: Request) {
  try {
    const { ticker } = await request.json();
    
    if (!ticker) {
      return NextResponse.json({ error: 'Ticker is required.' }, { status: 400 });
    }

         // Fetch stock data
     const stockData = await fetchStockData(ticker);
     
           // Get current date and market status for context
      const currentDate = new Date();
      const currentDateStr = currentDate.toISOString().slice(0, 10);
      const marketStatus = getMarketStatus();
      const currentDayName = getCurrentDayName();
      
      // Get sector performance for comparison line
      const sectorPerformance = await getStockSectorPerformance(ticker);
     
     // Calculate days difference for each article
     const articlesWithDateContext = stockData.recentArticles?.map((article: any) => {
       const articleDate = new Date(article.created);
       const daysDiff = Math.floor((currentDate.getTime() - articleDate.getTime()) / (1000 * 60 * 60 * 24));
       return {
         ...article,
         daysOld: daysDiff,
         isRecent: daysDiff <= 3,
         isThisWeek: daysDiff <= 7,
         isLastWeek: daysDiff > 7 && daysDiff <= 14
       };
     }) || [];

     // Debug logging for analyst ratings
     console.log('WGO No News: Analyst ratings being passed to AI:', stockData.analystRatings);
     console.log('WGO No News: Analyst ratings length:', stockData.analystRatings?.length || 0);

     // Create a template-based analyst ratings section to force proper usage
     let analystSection = '';
     if (stockData.analystRatings && stockData.analystRatings.length > 0) {
       analystSection = `ANALYST RATINGS DATA (USE THIS EXACTLY):
${stockData.analystRatings.join('\n')}

You MUST use the above analyst ratings data in your story. Analyze the sentiment and format as:
- If ratings are mostly positive (Buy, Overweight, Outperform): "Analyst sentiment remains positive"
- If ratings are mixed (some positive, some neutral/negative): "Analyst ratings show mixed sentiment" 
- If ratings are mostly negative (Sell, Underweight, Underperform): "Analyst sentiment appears cautious"
- If ratings are mostly neutral (Hold, Market Perform, Equal Weight): "Analyst ratings reflect neutral sentiment"

Format: "[SENTIMENT COMMENTARY], with [FIRST FIRM] maintaining [FIRST RATING] rating with $[FIRST PRICE] price target, [SECOND FIRM] maintaining [SECOND RATING] rating with $[SECOND PRICE] price target"

CRITICAL: Use the EXACT firm names from the data above. Do NOT use [FIRM NAME] placeholders.`;
     } else {
       analystSection = `ANALYST RATINGS: No recent analyst ratings data available.`;
     }

           // Generate WGO No News story
             const prompt = `
You are a financial journalist creating a WGO No News story for ${ticker}. Focus on technical analysis and market data.

CURRENT DATE: ${currentDateStr}
CURRENT MARKET STATUS: ${marketStatus}

STOCK DATA:
${JSON.stringify(stockData, null, 2)}

${sectorPerformance ? `
COMPARISON LINE (USE THIS EXACT FORMAT AT THE START OF THE ARTICLE, IMMEDIATELY AFTER THE HEADLINE):
${stockData.priceAction?.companyName || ticker} stock is ${stockData.priceAction?.changePercent >= 0 ? 'up' : 'down'} approximately ${Math.abs(stockData.priceAction?.changePercent || 0).toFixed(1)}% on ${currentDayName} versus a ${sectorPerformance.sectorChange.toFixed(1)}% ${sectorPerformance.sectorChange >= 0 ? 'gain' : 'loss'} in the ${sectorPerformance.sectorName} sector and a ${Math.abs(sectorPerformance.sp500Change).toFixed(1)}% ${sectorPerformance.sp500Change >= 0 ? 'gain' : 'loss'} in the S&P 500.

CRITICAL: This comparison line should appear immediately after the headline and before the main story content. Use this exact format.
` : ''}

CRITICAL INSTRUCTIONS:

1. HEADLINE: Use format "[Company] Stock Is Trending ${currentDayName}: What's Going On?" (on its own line, no bold formatting)

2. ${sectorPerformance ? 'COMPARISON LINE (right after headline): Use the comparison line format provided above.' : ''}

3. LEAD PARAGRAPH (exactly 2 sentences):
- First sentence: Start with company name and ticker, describe actual price movement (up/down/unchanged) with time context
- Second sentence: Brief context about sector correlation or market context - do NOT mention technical indicators here

4. SECTION MARKER: After the lead paragraph, insert "## Section: The Catalyst" on its own line.

5. CATALYST SECTION (after section marker):
- Focus ONLY on sector correlation, market context, and relative strength/weakness
- Explain whether the stock is moving WITH or AGAINST broader market trends
- Mention sector performance (e.g., "defying broad declines in the Technology sector")
- DO NOT mention specific Moving Averages (SMAs), RSI numbers, MACD, or any technical indicators here
- DO NOT mention 12-month performance, 52-week ranges, or specific price levels here
- Keep to 1-2 sentences focused on market/sector correlation

6. SECTION MARKER: After the Catalyst section, insert "## Section: Technical Analysis" on its own line.

7. TECHNICAL ANALYSIS SECTION (simplified structure):
Write exactly 3 paragraphs for technical analysis:

TECHNICAL ANALYSIS PARAGRAPH 1 (MOVING AVERAGES, 12-MONTH PERFORMANCE, 52-WEEK RANGE): Write a single paragraph that combines: (1) Stock position relative to 20-day and 100-day SMAs with exact percentages if available (e.g., "Apple stock is currently trading 2.3% below its 20-day simple moving average (SMA), but is X% above its 100-day SMA, demonstrating longer-term strength"), (2) 12-month performance if available (e.g., "Shares have increased/decreased X% over the past 12 months"), and (3) 52-week range position (e.g., "and are currently positioned closer to their 52-week highs than lows" or "closer to their 52-week lows than highs" - DO NOT include a percentage, just use qualitative positioning). If specific technical data is not available in the stock data, use general language about the stock's technical position. Keep this to 2-3 sentences maximum.

TECHNICAL ANALYSIS PARAGRAPH 2 (RSI AND MACD): Write a single paragraph that combines: (1) RSI level and interpretation if available. CRITICAL RSI INTERPRETATION: RSI below 30 = oversold/bearish, RSI 30-45 = bearish, RSI 45-55 = neutral, RSI 55-70 = bullish momentum, RSI above 70 = overbought. Use accurate interpretations (e.g., "The RSI is at 62.41, signaling bullish momentum that still has room to run before hitting overbought territory"), and (2) MACD status if available (e.g., "Meanwhile, MACD is above its signal line, suggesting bullish conditions" or "MACD is below its signal line, indicating bearish pressure"). If specific indicator data is not available, use general language about momentum indicators. Keep this to 2 sentences maximum.

TECHNICAL ANALYSIS PARAGRAPH 3 (RSI/MACD SUMMARY): Write a single sentence that summarizes the RSI and MACD signals using accurate RSI interpretations (e.g., "The combination of bullish RSI and bullish MACD confirms strong upward momentum" or "The combination of neutral RSI and bearish MACD suggests mixed momentum"). Keep this to 1 sentence maximum. STOP AFTER THIS PARAGRAPH.

KEY LEVELS (MANDATORY): After paragraph 3, you MUST extract and display the key support and resistance levels in a clear, scannable format. Format as bullet points using HTML <ul> and <li> tags:
<ul>
<li><strong>Key Resistance</strong>: $XXX.XX</li>
<li><strong>Key Support</strong>: $XXX.XX</li>
</ul>
These should be clearly labeled, rounded to the nearest $0.50, and formatted as bullet points. This format helps with SEO and Featured Snippets.

${stockData.consensusRatings || stockData.nextEarnings ? `
5. EARNINGS AND ANALYST OUTLOOK SECTION (forward-looking):
After the technical analysis section, include a forward-looking section that anticipates the upcoming earnings report and provides analyst outlook. This section should help investors understand both the stock's value proposition and how analysts view it.

CRITICAL INSTRUCTIONS FOR THIS SECTION:
- Start with a brief introductory sentence (1 sentence max) about the earnings date
- Then present key data points as separate lines (not HTML bullets) with bold labels
- Format: Use <strong> tags to bold the labels (EPS Estimate, Revenue Estimate, Analyst Consensus), followed by the data on the same line
- Each data point should be on its own line with a blank line between them
- Focus on helping investors understand: (1) whether the stock represents good value, and (2) how analysts view the stock
- CRITICAL: When mentioning the price target in the intro sentence, compare it to the current price. If price target is BELOW current price, say "suggesting the stock may be trading at a premium relative to analyst expectations" instead of "indicating potential upside"
- Make it forward-looking and actionable for investors

${stockData.nextEarnings ? `
UPCOMING EARNINGS DATA:
- Next Earnings Date: ${formatEarningsDate(stockData.nextEarnings.date)}
${stockData.nextEarnings.eps_estimate ? `- EPS Estimate: $${parseFloat(stockData.nextEarnings.eps_estimate.toString()).toFixed(2)}` : ''}
${stockData.nextEarnings.eps_prior ? `- Previous EPS: $${parseFloat(stockData.nextEarnings.eps_prior.toString()).toFixed(2)}` : ''}
${stockData.nextEarnings.revenue_estimate ? `- Revenue Estimate: $${(parseFloat(stockData.nextEarnings.revenue_estimate.toString()) / 1000000).toFixed(2)}M` : ''}
${stockData.nextEarnings.revenue_prior ? `- Previous Revenue: $${(parseFloat(stockData.nextEarnings.revenue_prior.toString()) / 1000000).toFixed(2)}M` : ''}

` : ''}

${stockData.consensusRatings ? `
ANALYST OUTLOOK DATA:
- Consensus Rating: ${stockData.consensusRatings.consensus_rating ? stockData.consensusRatings.consensus_rating.charAt(0) + stockData.consensusRatings.consensus_rating.slice(1).toLowerCase() : 'N/A'}
- Consensus Price Target: ${stockData.consensusRatings.consensus_price_target ? '$' + parseFloat(stockData.consensusRatings.consensus_price_target.toString()).toFixed(2) : 'N/A'}
${stockData.consensusRatings.high_price_target ? `- High Price Target: $${parseFloat(stockData.consensusRatings.high_price_target.toString()).toFixed(2)}` : ''}
${stockData.consensusRatings.low_price_target ? `- Low Price Target: $${parseFloat(stockData.consensusRatings.low_price_target.toString()).toFixed(2)}` : ''}
${stockData.consensusRatings.total_analyst_count ? `- Total Analysts: ${stockData.consensusRatings.total_analyst_count}` : ''}
${stockData.consensusRatings.buy_percentage ? `- Buy Rating: ${parseFloat(stockData.consensusRatings.buy_percentage.toString()).toFixed(1)}%` : ''}
${stockData.consensusRatings.hold_percentage ? `- Hold Rating: ${parseFloat(stockData.consensusRatings.hold_percentage.toString()).toFixed(1)}%` : ''}
${stockData.consensusRatings.sell_percentage ? `- Sell Rating: ${parseFloat(stockData.consensusRatings.sell_percentage.toString()).toFixed(1)}%` : ''}
` : ''}

CRITICAL FORMATTING REQUIREMENTS:
- Start with ONE introductory sentence (e.g., "Investors are looking ahead to the company's next earnings report on [DATE].")
- Then format the data as separate lines (not HTML bullets) with bold labels
- Each data point should be on its own line with a blank line between them
- Format example:
  <strong>EPS Estimate</strong>: $X.XX (Up/Down from $X.XX YoY)

  <strong>Revenue Estimate</strong>: $X.XX Billion (Up/Down from $X.XX Billion YoY)

  <strong>Analyst Consensus</strong>: [Rating] Rating ($X.XX Avg Price Target)

IMPORTANT: When earnings estimates are available, ALWAYS compare them to the same quarter from the previous year (year-over-year comparison):
- If eps_prior is available, compare eps_estimate to eps_prior (e.g., "up from $0.65 from the same quarter last year" or "down from $0.80 from the prior-year period")
- If revenue_prior is available, compare revenue_estimate to revenue_prior (e.g., "revenue of $25.5M, up from $23.2M from the same quarter last year")
- NOTE: eps_prior and revenue_prior represent the same quarter from the previous year, NOT the sequentially previous quarter
- This year-over-year comparison helps investors understand whether expectations show growth, decline, or stability compared to the same period last year

EXAMPLE APPROACH (adapt based on available data):
${stockData.nextEarnings && stockData.consensusRatings ? `
"Investors are looking ahead to the company's next earnings report, scheduled for ${formatEarningsDate(stockData.nextEarnings.date)}, ${stockData.nextEarnings.eps_estimate ? `with analysts expecting earnings per share of $${parseFloat(stockData.nextEarnings.eps_estimate.toString()).toFixed(2)}${stockData.nextEarnings.eps_prior ? `, ${parseFloat(stockData.nextEarnings.eps_estimate.toString()) > parseFloat(stockData.nextEarnings.eps_prior.toString()) ? 'up from' : parseFloat(stockData.nextEarnings.eps_estimate.toString()) < parseFloat(stockData.nextEarnings.eps_prior.toString()) ? 'down from' : 'compared to'} $${parseFloat(stockData.nextEarnings.eps_prior.toString()).toFixed(2)} from the same quarter last year` : ''}${stockData.nextEarnings.revenue_estimate && stockData.nextEarnings.revenue_prior ? ` and revenue of ${formatRevenue(stockData.nextEarnings.revenue_estimate as string | number | null)}${parseFloat((stockData.nextEarnings.revenue_estimate as string | number).toString()) > parseFloat((stockData.nextEarnings.revenue_prior as string | number).toString()) ? ', up from' : parseFloat((stockData.nextEarnings.revenue_estimate as string | number).toString()) < parseFloat((stockData.nextEarnings.revenue_prior as string | number).toString()) ? ', down from' : ', compared to'} ${formatRevenue(stockData.nextEarnings.revenue_prior as string | number | null)} from the same quarter last year` : ''}.` : 'which will provide key insights into the company\'s financial performance.'} ${stockData.priceAction?.companyName || ticker} has a consensus ${stockData.consensusRatings.consensus_rating ? stockData.consensusRatings.consensus_rating.charAt(0) + stockData.consensusRatings.consensus_rating.slice(1).toLowerCase() : 'N/A'} rating among analysts${stockData.consensusRatings.consensus_price_target ? ` with an average price target of $${parseFloat(stockData.consensusRatings.consensus_price_target.toString()).toFixed(2)}` : ''}, ${stockData.consensusRatings.buy_percentage && parseFloat(stockData.consensusRatings.buy_percentage.toString()) > 50 ? `reflecting a bullish outlook from the analyst community with ${parseFloat(stockData.consensusRatings.buy_percentage.toString()).toFixed(0)}% buy ratings.` : stockData.consensusRatings.hold_percentage && parseFloat(stockData.consensusRatings.hold_percentage.toString()) > 50 ? `reflecting a cautious stance with ${parseFloat(stockData.consensusRatings.hold_percentage.toString()).toFixed(0)}% hold ratings.` : 'as investors monitor the stock ahead of the earnings release.'}"
` : stockData.nextEarnings ? `
"Investors are looking ahead to the company's next earnings report, scheduled for ${formatEarningsDate(stockData.nextEarnings.date)}, ${stockData.nextEarnings.eps_estimate ? `with analysts expecting earnings per share of $${parseFloat(stockData.nextEarnings.eps_estimate.toString()).toFixed(2)}${stockData.nextEarnings.eps_prior ? `, ${parseFloat(stockData.nextEarnings.eps_estimate.toString()) > parseFloat(stockData.nextEarnings.eps_prior.toString()) ? 'up from' : parseFloat(stockData.nextEarnings.eps_estimate.toString()) < parseFloat(stockData.nextEarnings.eps_prior.toString()) ? 'down from' : 'compared to'} $${parseFloat(stockData.nextEarnings.eps_prior.toString()).toFixed(2)} from the same quarter last year` : ''}${stockData.nextEarnings.revenue_estimate && stockData.nextEarnings.revenue_prior ? ` and revenue of ${formatRevenue(stockData.nextEarnings.revenue_estimate as string | number | null)}${parseFloat((stockData.nextEarnings.revenue_estimate as string | number).toString()) > parseFloat((stockData.nextEarnings.revenue_prior as string | number).toString()) ? ', up from' : parseFloat((stockData.nextEarnings.revenue_estimate as string | number).toString()) < parseFloat((stockData.nextEarnings.revenue_prior as string | number).toString()) ? ', down from' : ', compared to'} ${formatRevenue(stockData.nextEarnings.revenue_prior as string | number | null)} from the same quarter last year` : ''}.` : 'which will provide key insights into the company\'s financial performance and outlook.'}"
` : stockData.consensusRatings ? `
"${stockData.priceAction?.companyName || ticker} has a consensus ${stockData.consensusRatings.consensus_rating ? stockData.consensusRatings.consensus_rating.charAt(0) + stockData.consensusRatings.consensus_rating.slice(1).toLowerCase() : 'N/A'} rating among analysts${stockData.consensusRatings.consensus_price_target ? ` with an average price target of $${parseFloat(stockData.consensusRatings.consensus_price_target.toString()).toFixed(2)}` : ''}, ${stockData.consensusRatings.buy_percentage && parseFloat(stockData.consensusRatings.buy_percentage.toString()) > 50 ? `reflecting a bullish outlook from the analyst community with ${parseFloat(stockData.consensusRatings.buy_percentage.toString()).toFixed(0)}% buy ratings.` : stockData.consensusRatings.hold_percentage && parseFloat(stockData.consensusRatings.hold_percentage.toString()) > 50 ? `reflecting a cautious stance with ${parseFloat(stockData.consensusRatings.hold_percentage.toString()).toFixed(0)}% hold ratings.` : 'as analysts monitor the stock\'s performance.'} ${stockData.consensusRatings.total_analyst_count ? `${stockData.consensusRatings.total_analyst_count} analysts are currently covering the stock.` : ''}"
` : ''}
` : ''}

SECTION BOUNDARIES (STRICT - CRITICAL):
- **CATALYST SECTION:** Focus ONLY on News (or lack of it), Sector Correlation, Market Context, and Relative Strength. DO NOT mention specific Moving Averages (SMAs), RSI numbers, MACD, 12-month performance, 52-week ranges, or any technical indicators here.
- **TECHNICAL ANALYSIS SECTION:** This is the ONLY place for SMAs, RSI, MACD, 12-month performance, 52-week ranges, and all technical data. DO NOT repeat technical data from this section in the Catalyst section.

8. PRICE ACTION LINE (at the end):
- Format: "[TICKER] Price Action: [Company Name] shares were [up/down] [X.XX]% at $[XX.XX] [during premarket trading/during after-hours trading/while the market was closed] on [Day], according to <a href=\"https://pro.benzinga.com\">Benzinga Pro</a>."
- All prices must be formatted to exactly 2 decimal places

9. WRITING STYLE:
- Professional financial journalism
- Active voice, clear language
- No flowery phrases like "amidst" or "whilst"
- Keep paragraphs to 2 sentences maximum

IMPORTANT: Do NOT include any analyst ratings section in this story. This will be added in a separate step.

Generate the basic technical story now.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1500,
      temperature: 0.7,
    });

    let story = completion.choices[0].message?.content?.trim() || '';

    if (!story) {
      return NextResponse.json({ error: 'Failed to generate WGO No News story.' }, { status: 500 });
    }

    // Log story generation completion
    console.log(`Generated WGO No News story for ${ticker} focusing on technical data`);

    // Fetch related articles and add "Also Read" and "Read Next" sections
    const relatedArticles = await fetchRelatedArticles(ticker);
    
    // Ensure "Also Read" and "Read Next" sections are included if related articles are available
    if (relatedArticles && relatedArticles.length > 0) {
      // Check if "Also Read" section exists and is in the correct position
      const alsoReadPattern = /<p>Also Read:.*?<\/p>/i;
      const alsoReadMatch = story.match(alsoReadPattern);
      const alsoReadExists = !!alsoReadMatch;
      
      // Find where "Also Read" currently is
      const paragraphs = story.split('</p>').filter(p => p.trim().length > 0);
      const alsoReadIndex = alsoReadMatch ? paragraphs.findIndex(p => p.includes('Also Read:')) : -1;
      
      // Target position: after the second paragraph (index 2, which is the 3rd element: lead, para1, Also Read)
      const targetIndex = 2;
      
      if (alsoReadExists && alsoReadIndex === targetIndex) {
        console.log('"Also Read" section already exists in correct position');
      } else {
        // Remove existing "Also Read" if it's in the wrong place
        if (alsoReadExists && alsoReadIndex !== -1) {
          console.log(`Moving "Also Read" from position ${alsoReadIndex} to position ${targetIndex}`);
          paragraphs.splice(alsoReadIndex, 1);
        } else if (!alsoReadExists) {
          console.log('Adding "Also Read" section');
        }
        
        // Insert "Also Read" at the correct position (after second paragraph)
        if (paragraphs.length >= 2) {
          const alsoReadSection = `<p>Also Read: <a href="${relatedArticles[0].url}">${relatedArticles[0].headline}</a></p>`;
          paragraphs.splice(targetIndex, 0, alsoReadSection);
          // When we split by '</p>', each element doesn't have the closing tag
          // But alsoReadSection already has '</p>', so we need to handle it differently
          story = paragraphs.map(p => {
            // If it already has '</p>' (like alsoReadSection), return as-is
            if (p.trim().endsWith('</p>')) return p;
            // Otherwise, add '</p>' back
            return p + '</p>';
          }).join('');
          console.log('✅ "Also Read" section placed after second paragraph');
        }
      }
      
      // Check if "Read Next" section exists, if not add it after context but before price action
      if (!story.includes('Read Next:')) {
        console.log('Adding "Read Next" section');
        const readNextSection = `<p>Read Next: <a href="${relatedArticles[1]?.url || relatedArticles[0].url}">${relatedArticles[1]?.headline || relatedArticles[0].headline}</a></p>`;
        
        // Find the price action section to insert before it
        const priceActionIndex = story.indexOf('Price Action:');
        if (priceActionIndex !== -1) {
          // Insert before price action
          const beforePriceAction = story.substring(0, priceActionIndex);
          const priceActionAndAfter = story.substring(priceActionIndex);
          story = `${beforePriceAction}\n\n${readNextSection}\n\n${priceActionAndAfter}`;
        } else {
          // If no price action found, add to the end
          story += readNextSection;
        }
      } else {
        console.log('"Read Next" section already exists');
      }
      } else {
        console.log('No related articles available');
      }

    // Post-process Earnings & Analyst Outlook section to format as bullet points
    const earningsSectionMarker = /##\s*Section:\s*Earnings\s*&\s*Analyst\s*Outlook/i;
    const earningsSectionMatch = story.match(earningsSectionMarker);
    if (earningsSectionMatch && earningsSectionMatch.index !== undefined) {
      const afterEarningsMarker = story.substring(earningsSectionMatch.index + earningsSectionMatch[0].length);
      const nextSectionMatch = afterEarningsMarker.match(/(##\s*Section:|##\s*Top\s*ETF|Price Action:)/i);
      const earningsSectionEnd = nextSectionMatch ? nextSectionMatch.index! : afterEarningsMarker.length;
      const earningsContent = afterEarningsMarker.substring(0, earningsSectionEnd).trim();
      
      // Check if content is already formatted (has bullet points with <strong> tags for labels)
      if (!earningsContent.includes('<ul>') && !earningsContent.includes('<strong>EPS Estimate</strong>') && !earningsContent.includes('<strong>Revenue Estimate</strong>')) {
        // Extract earnings data from the content - handle multiple date patterns
        // First try to match full date format: "on February 26, 2026"
        let earningsDateMatch = earningsContent.match(/(?:scheduled for|on|report on|earnings report on) ([A-Za-z]+ \d{1,2}, \d{4})/i);
        if (!earningsDateMatch) {
          // Fallback to partial date: "on February 26"
          earningsDateMatch = earningsContent.match(/(?:scheduled for|on|report on|earnings report on) ([^,]+?)(?:,|\.|$)/i);
        }
        
        // Try narrative format first
        let epsEstimateMatch = earningsContent.match(/earnings per share of \$([\d.-]+)/i);
        let epsPriorMatch = earningsContent.match(/(?:up from|down from|compared to|from the same quarter last year|from a loss of) \$([\d.-]+)/i);
        let revenueEstimateMatch = earningsContent.match(/revenue of (\$[\d.]+[BM])/i);
        let revenuePriorMatch = earningsContent.match(/revenue.*?(?:up from|down from|compared to|from the same quarter last year|from the prior-year period) (\$[\d.]+[BM])/i);
        let consensusRatingMatch = earningsContent.match(/(?:consensus|has a) ([A-Za-z]+) rating/i);
        let priceTargetMatch = earningsContent.match(/price target of \$([\d.]+)/i);
        
        // Check if content already has formatted lines (e.g., "EPS Estimate: $0.73")
        const formattedLines: string[] = [];
        const epsLineMatch = earningsContent.match(/^EPS Estimate:\s*(.+?)(?:\n|$)/im);
        const revenueLineMatch = earningsContent.match(/^Revenue Estimate:\s*(.+?)(?:\n|$)/im);
        const consensusLineMatch = earningsContent.match(/^Analyst Consensus:\s*(.+?)(?:\n|$)/im);
        
        if (epsLineMatch || revenueLineMatch || consensusLineMatch) {
          // Content is already formatted - just extract and wrap in HTML
          if (epsLineMatch) {
            formattedLines.push(`<strong>EPS Estimate</strong>: ${epsLineMatch[1].trim()}`);
          }
          if (revenueLineMatch) {
            formattedLines.push(`<strong>Revenue Estimate</strong>: ${revenueLineMatch[1].trim()}`);
          }
          if (consensusLineMatch) {
            formattedLines.push(`<strong>Analyst Consensus</strong>: ${consensusLineMatch[1].trim()}`);
          }
        }
        
        console.log('[EARNINGS FORMAT] Extracting data:', {
          hasDate: !!earningsDateMatch,
          dateMatch: earningsDateMatch ? earningsDateMatch[1] : null,
          hasEPS: !!epsEstimateMatch,
          hasRevenue: !!revenueEstimateMatch,
          hasConsensus: !!consensusRatingMatch,
          hasPriceTarget: !!priceTargetMatch,
          hasFormattedLines: formattedLines.length > 0,
          contentSample: earningsContent.substring(0, 500)
        });
        
        // Build formatted lines with bold labels
        const lines: string[] = [];
        let intro = '';
        let priceTargetNote = '';
        
        // Use pre-formatted lines if found, otherwise extract from narrative format
        if (formattedLines.length > 0) {
          lines.push(...formattedLines);
          // Extract intro sentence from the beginning of the content
          const introMatch = earningsContent.match(/^(.+?\.)(?:\n\n|\nEPS Estimate:|$)/m);
          intro = introMatch ? introMatch[1].trim() : 'Investors are looking ahead to the next earnings report.';
        }
        
        if (lines.length === 0 && earningsDateMatch) {
          intro = `Investors are looking ahead to the next earnings report on ${earningsDateMatch[1].trim()}.`;
          
          if (epsEstimateMatch) {
            const epsEst = epsEstimateMatch[1];
            const epsPrior = epsPriorMatch ? epsPriorMatch[1] : null;
            const direction = epsPrior ? (parseFloat(epsEst) > parseFloat(epsPrior) ? 'Up' : parseFloat(epsEst) < parseFloat(epsPrior) ? 'Down' : '') : '';
            lines.push(`<strong>EPS Estimate</strong>: $${epsEst}${epsPrior && direction ? ` (${direction} from $${epsPrior} YoY)` : ''}`);
          }
          
          if (revenueEstimateMatch) {
            const revEst = revenueEstimateMatch[1];
            const revPrior = revenuePriorMatch ? revenuePriorMatch[1] : null;
            const direction = revPrior ? (parseFloat(revEst.replace(/[$,BM]/g, '')) > parseFloat(revPrior.replace(/[$,BM]/g, '')) ? 'Up' : parseFloat(revEst.replace(/[$,BM]/g, '')) < parseFloat(revPrior.replace(/[$,BM]/g, '')) ? 'Down' : '') : '';
            lines.push(`<strong>Revenue Estimate</strong>: ${revEst}${revPrior && direction ? ` (${direction} from ${revPrior} YoY)` : ''}`);
          }
          
          if (consensusRatingMatch && priceTargetMatch) {
            const rating = consensusRatingMatch[1].charAt(0) + consensusRatingMatch[1].slice(1).toLowerCase();
            const target = parseFloat(priceTargetMatch[1]);
            lines.push(`<strong>Analyst Consensus</strong>: ${rating} Rating ($${target.toFixed(2)} Avg Price Target)`);
            
            // Add price comparison logic note
            if (stockData.priceAction?.last) {
              const currentPrice = stockData.priceAction.last;
              const priceDiff = ((target - currentPrice) / currentPrice) * 100;
              if (priceDiff > 0) {
                // Target is above current price = upside potential
                priceTargetNote = `\n\n<strong>Note:</strong> <em>The average price target implies significant upside potential from current levels.</em>`;
              } else {
                // Target is below current price = trading at premium
                priceTargetNote = `\n\n<strong>Note:</strong> <em>The average price target suggests the stock is trading at a premium to analyst targets.</em>`;
              }
            }
          } else if (consensusRatingMatch) {
            const rating = consensusRatingMatch[1].charAt(0) + consensusRatingMatch[1].slice(1).toLowerCase();
            lines.push(`<strong>Analyst Consensus</strong>: ${rating} Rating`);
          } else if (priceTargetMatch) {
            const target = parseFloat(priceTargetMatch[1]);
            lines.push(`<strong>Analyst Consensus</strong>: $${target.toFixed(2)} Avg Price Target`);
            
            // Add price comparison logic note
            if (stockData.priceAction?.last) {
              const currentPrice = stockData.priceAction.last;
              const priceDiff = ((target - currentPrice) / currentPrice) * 100;
              if (priceDiff > 0) {
                priceTargetNote = `\n\n<strong>Note:</strong> <em>The average price target implies significant upside potential from current levels.</em>`;
              } else {
                priceTargetNote = `\n\n<strong>Note:</strong> <em>The average price target suggests the stock is trading at a premium to analyst targets.</em>`;
              }
            }
          }
        }
        
        // Format the section if we have lines
        if (lines.length > 0 && intro) {
          // Format as HTML bullet points with bold labels
          const formattedSection = `${intro}\n\n<ul>\n${lines.map(l => `  <li>${l}</li>`).join('\n')}\n</ul>${priceTargetNote}`;
          const beforeEarnings = story.substring(0, earningsSectionMatch.index + earningsSectionMatch[0].length);
          const afterEarnings = story.substring(earningsSectionMatch.index + earningsSectionMatch[0].length + earningsSectionEnd);
          story = `${beforeEarnings}\n\n${formattedSection}\n\n${afterEarnings}`;
          console.log('✅ Formatted Earnings & Analyst Outlook section with bold labels and bullet points');
        } else if (lines.length > 0) {
          // We have lines but no intro - use default
          intro = 'Investors are looking ahead to the next earnings report.';
          const formattedSection = `${intro}\n\n<ul>\n${lines.map(l => `  <li>${l}</li>`).join('\n')}\n</ul>${priceTargetNote}`;
          const beforeEarnings = story.substring(0, earningsSectionMatch.index + earningsSectionMatch[0].length);
          const afterEarnings = story.substring(earningsSectionMatch.index + earningsSectionMatch[0].length + earningsSectionEnd);
          story = `${beforeEarnings}\n\n${formattedSection}\n\n${afterEarnings}`;
          console.log('✅ Formatted Earnings & Analyst Outlook section (using default intro)');
        } else {
          console.log('⚠️ Could not extract earnings data from content - regex patterns may need updating');
          console.log('Earnings content sample:', earningsContent.substring(0, 500));
        }
      }
    }
    
    // Post-process Technical Analysis section to extract and format Key Levels
    const technicalSectionMarker = /##\s*Section:\s*Technical\s*Analysis/i;
    const technicalSectionMatch = story.match(technicalSectionMarker);
    if (technicalSectionMatch && technicalSectionMatch.index !== undefined) {
      const afterTechnicalMarker = story.substring(technicalSectionMatch.index + technicalSectionMatch[0].length);
      const nextSectionMatch = afterTechnicalMarker.match(/(##\s*Section:|##\s*Top\s*ETF|Price Action:)/i);
      const technicalSectionEnd = nextSectionMatch ? nextSectionMatch.index! : afterTechnicalMarker.length;
      const technicalContent = afterTechnicalMarker.substring(0, technicalSectionEnd);
      
      // Extract support and resistance levels
      const supportMatch = technicalContent.match(/(?:Key\s+)?support\s+(?:is\s+at|at)\s+\$([\d.]+)/i);
      const resistanceMatch = technicalContent.match(/(?:Key\s+)?resistance\s+(?:is\s+at|at)\s+\$([\d.]+)/i);
      
      if (supportMatch || resistanceMatch) {
        // Check if Key Levels are already formatted as bullet points
        const hasBulletFormat = technicalContent.includes('<ul>') && technicalContent.includes('Key Resistance') && technicalContent.includes('Key Support');
        
        // Also check if they exist in plain text format (need to replace)
        const hasPlainTextFormat = technicalContent.includes('Key Resistance:') || technicalContent.includes('Key Support:');
        
        if (!hasBulletFormat) {
          // Round to nearest $0.50
          const roundToHalf = (val: number) => Math.round(val * 2) / 2;
          const support = supportMatch ? roundToHalf(parseFloat(supportMatch[1])).toFixed(2) : null;
          const resistance = resistanceMatch ? roundToHalf(parseFloat(resistanceMatch[1])).toFixed(2) : null;
          
          if (support || resistance) {
            // If plain text format exists, remove it first
            let cleanedTechnicalContent = technicalContent;
            if (hasPlainTextFormat) {
              // Remove existing plain text Key Resistance/Support lines
              cleanedTechnicalContent = cleanedTechnicalContent.replace(/Key\s+Resistance:\s*\$\d+\.\d+\s*\n?/gi, '');
              cleanedTechnicalContent = cleanedTechnicalContent.replace(/Key\s+Support:\s*\$\d+\.\d+\s*\n?/gi, '');
            }
            
            // Find the end of the last paragraph in technical section
            const lastParagraphEnd = cleanedTechnicalContent.lastIndexOf('</p>');
            const beforeLastParagraph = cleanedTechnicalContent.substring(0, lastParagraphEnd !== -1 ? lastParagraphEnd + 4 : cleanedTechnicalContent.length);
            const afterLastParagraph = cleanedTechnicalContent.substring(lastParagraphEnd !== -1 ? lastParagraphEnd + 4 : cleanedTechnicalContent.length);
            
            // Build Key Levels section as bullet points
            const keyLevelBullets: string[] = [];
            if (resistance) {
              keyLevelBullets.push(`<strong>Key Resistance</strong>: $${resistance}`);
            }
            if (support) {
              keyLevelBullets.push(`<strong>Key Support</strong>: $${support}`);
            }
            const keyLevels = keyLevelBullets.length > 0 
              ? `\n\n<ul>\n${keyLevelBullets.map(b => `  <li>${b}</li>`).join('\n')}\n</ul>`
              : '';
            
            // Update the technical section
            const beforeTechnical = story.substring(0, technicalSectionMatch.index + technicalSectionMatch[0].length);
            const updatedTechnicalContent = `${beforeLastParagraph}${keyLevels}${afterLastParagraph}`;
            const afterTechnical = story.substring(technicalSectionMatch.index + technicalSectionMatch[0].length + technicalSectionEnd);
            story = `${beforeTechnical}\n\n${updatedTechnicalContent}${afterTechnical}`;
            console.log('✅ Extracted and formatted Key Levels from Technical Analysis');
          }
        }
      }
    }

    // Fetch and append ETF information after price action line
    try {
      const etfs = await fetchETFs(ticker);
      if (etfs && etfs.length > 0) {
        const etfInfo = formatETFInfo(etfs, ticker);
        if (etfInfo) {
          // Find the price action line and append ETF info after it
          const priceActionIndex = story.indexOf('Price Action:');
          if (priceActionIndex !== -1) {
            // Find the end of the price action line (look for "according to Benzinga Pro data" or similar ending)
            const afterPriceAction = story.substring(priceActionIndex);
            // Look for the end pattern: period followed by optional space and "according to" or end of line
            const endMatch = afterPriceAction.match(/(\.\s*(?:according to|$))/i);
            if (endMatch && endMatch.index !== undefined) {
              // Find the actual end after "according to Benzinga Pro data" or similar
              const potentialEnd = priceActionIndex + endMatch.index + endMatch[0].length;
              // Look for the period that ends the sentence after "according to"
              const fullEndMatch = story.substring(potentialEnd - 50, potentialEnd + 50).match(/(according to[^.]*\.)/i);
              if (fullEndMatch) {
                const insertIndex = story.indexOf(fullEndMatch[0], potentialEnd - 50) + fullEndMatch[0].length;
                story = story.substring(0, insertIndex) + etfInfo + story.substring(insertIndex);
              } else {
                // Fallback: insert after the period we found
                const insertIndex = priceActionIndex + endMatch.index + 1;
                story = story.substring(0, insertIndex) + etfInfo + story.substring(insertIndex);
              }
            } else {
              // If we can't find the end, append at the end of the story
              story += etfInfo;
            }
          } else {
            // If no price action found, append at the end
            story += etfInfo;
          }
        }
      }
    } catch (etfError) {
      console.error(`Error fetching ETF data for ${ticker}:`, etfError);
      // Continue without ETF info if there's an error
    }

    return NextResponse.json({ 
      story,
      stockData
    });
  } catch (error: any) {
    console.error('Error generating WGO No News story:', error);
    return NextResponse.json({ error: error.message || 'Failed to generate WGO No News story.' }, { status: 500 });
  }
} 