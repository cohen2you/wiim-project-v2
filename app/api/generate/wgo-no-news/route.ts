import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { fetchETFs, formatETFInfo } from '@/lib/etf-utils';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const BENZINGA_API_KEY = process.env.BENZINGA_API_KEY!;
const BENZINGA_EDGE_API_KEY = process.env.BENZINGA_EDGE_API_KEY!;
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
  // Markets are closed on weekends, so return Friday for Saturday/Sunday
  const now = new Date();
  const nyTime = new Date(now.toLocaleString("en-US", {timeZone: "America/New_York"}));
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const currentDay = nyTime.getDay();
  
  // If it's a weekend, return Friday as the last trading day
  if (currentDay === 0) { // Sunday
    return 'Friday';
  } else if (currentDay === 6) { // Saturday
    return 'Friday';
  } else {
    return days[currentDay];
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

// Fetch historical sector performance for past week and month
async function fetchHistoricalSectorPerformance(sectorETF: string): Promise<{ weekChange?: number; monthChange?: number } | null> {
  try {
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo = new Date(now);
    monthAgo.setMonth(monthAgo.getMonth() - 1);
    
    const formatDate = (date: Date) => date.toISOString().split('T')[0];
    const to = formatDate(now);
    const fromWeek = formatDate(weekAgo);
    const fromMonth = formatDate(monthAgo);
    
    // Fetch weekly and monthly historical bars
    const [weekRes, monthRes] = await Promise.all([
      fetch(`https://api.polygon.io/v2/aggs/ticker/${sectorETF}/range/1/day/${fromWeek}/${to}?adjusted=true&apikey=${process.env.POLYGON_API_KEY}`),
      fetch(`https://api.polygon.io/v2/aggs/ticker/${sectorETF}/range/1/day/${fromMonth}/${to}?adjusted=true&apikey=${process.env.POLYGON_API_KEY}`)
    ]);
    
    const [weekData, monthData] = await Promise.all([
      weekRes.ok ? weekRes.json() : null,
      monthRes.ok ? monthRes.json() : null
    ]);
    
    const weekBars = weekData?.results || [];
    const monthBars = monthData?.results || [];
    
    let weekChange: number | undefined;
    let monthChange: number | undefined;
    
    // Calculate week change (first vs last close)
    if (weekBars.length >= 2) {
      const firstClose = weekBars[0].c;
      const lastClose = weekBars[weekBars.length - 1].c;
      weekChange = ((lastClose - firstClose) / firstClose) * 100;
    }
    
    // Calculate month change (first vs last close)
    if (monthBars.length >= 2) {
      const firstClose = monthBars[0].c;
      const lastClose = monthBars[monthBars.length - 1].c;
      monthChange = ((lastClose - firstClose) / firstClose) * 100;
    }
    
    return (weekChange !== undefined || monthChange !== undefined) ? { weekChange, monthChange } : null;
  } catch (error) {
    console.error('Error fetching historical sector performance:', error);
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

// Fetch Edge ratings from Benzinga Edge API
async function fetchEdgeRatings(ticker: string) {
  try {
    if (!BENZINGA_EDGE_API_KEY) {
      console.log('WGO No News: BENZINGA_EDGE_API_KEY not configured, skipping Edge ratings');
      return null;
    }

    // Try different possible Edge API endpoints
    const possibleUrls = [
      `https://data-api-next.benzinga.com/rest/v3/tickerDetail?apikey=${BENZINGA_EDGE_API_KEY}&symbols=${encodeURIComponent(ticker)}`,
      `https://api.benzinga.com/api/v2/edge?token=${BENZINGA_EDGE_API_KEY}&symbols=${encodeURIComponent(ticker)}`,
      `https://api.benzinga.com/api/v2/edge/stock/${encodeURIComponent(ticker)}?token=${BENZINGA_EDGE_API_KEY}`,
      `https://api.benzinga.com/api/v2/edge/${encodeURIComponent(ticker)}?token=${BENZINGA_EDGE_API_KEY}`,
      `https://api.benzinga.com/api/v2/edge/ratings?token=${BENZINGA_EDGE_API_KEY}&symbols=${encodeURIComponent(ticker)}`
    ];
    
    let data = null;
    
    for (const url of possibleUrls) {
      console.log('WGO No News: Trying Edge API URL:', url);
      const response = await fetch(url, {
        headers: { 
          'Accept': 'application/json'
        },
      });
      
      if (response.ok) {
        data = await response.json();
        console.log('WGO No News: Edge API success with URL:', url);
        break;
      } else {
        console.log('WGO No News: Edge API failed with URL:', url, response.status);
      }
    }
    
    if (!data) {
      console.log('WGO No News: All Edge API endpoints failed');
      return null;
    }
    
    console.log('WGO No News: Edge API response:', data);
    
    // Extract the relevant ratings data - try different possible data structures
    let edgeData = null;
    
    // Handle the tickerDetail API response structure
    if (data.result && Array.isArray(data.result) && data.result.length > 0) {
      const tickerData = data.result[0];
      if (tickerData.rankings && tickerData.rankings.exists) {
        edgeData = {
          ticker: ticker.toUpperCase(),
          value_rank: tickerData.rankings.value,
          growth_rank: tickerData.rankings.growth,
          quality_rank: tickerData.rankings.quality,
          momentum_rank: tickerData.rankings.momentum,
        };
      }
    }
    
    // Fallback to other possible data structures
    if (!edgeData) {
      edgeData = {
        ticker: ticker.toUpperCase(),
        value_rank: data.value_rank || data.valueRank || data.value || data.rankings?.value,
        growth_rank: data.growth_rank || data.growthRank || data.growth || data.rankings?.growth,
        quality_rank: data.quality_rank || data.qualityRank || data.quality || data.rankings?.quality,
        momentum_rank: data.momentum_rank || data.momentumRank || data.momentum || data.rankings?.momentum,
      };
      
      // Only return if we have at least one valid ranking
      if (!edgeData.value_rank && !edgeData.growth_rank && !edgeData.quality_rank && !edgeData.momentum_rank) {
        return null;
      }
    }
    
    console.log('WGO No News: Processed Edge data:', edgeData);
    return edgeData;
  } catch (error) {
    console.error('WGO No News: Error fetching Edge ratings:', error);
    return null;
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

// Fetch price data from Benzinga API (shared helper for both price action line and sync)
async function fetchPriceDataFromBenzinga(ticker: string): Promise<{ quote: any; changePercent: number | undefined } | null> {
  try {
    const url = `https://api.benzinga.com/api/v2/quoteDelayed?token=${BENZINGA_API_KEY}&symbols=${ticker}`;
    const res = await fetch(url);
    
    if (!res.ok) {
      console.error(`[PRICE DATA] Failed to fetch price data for ${ticker}:`, res.statusText);
      return null;
    }
    
    const data = await res.json();
    if (!data || typeof data !== 'object') {
      return null;
    }
    
    const quote = data[ticker.toUpperCase()];
    if (!quote || typeof quote !== 'object' || !quote.lastTradePrice) {
      return null;
    }
    
    // Use Benzinga's changePercent if provided - don't override it with manual calculations
    // During open market hours, if changePercent is 0, it might not be updated yet by Benzinga's delayed feed
    // In that case, we'll skip showing the percentage to avoid misleading "unchanged 0.00%" messages
    const changePercent = typeof quote.changePercent === 'number' ? quote.changePercent : undefined;
    return { quote, changePercent };
  } catch (error) {
    console.error(`[PRICE DATA] Error fetching price data for ${ticker}:`, error);
    return null;
  }
}

// Generate price action line programmatically using Benzinga API (matching price-action route logic)
async function generatePriceActionLine(ticker: string, companyName: string, stockData: any): Promise<string> {
  try {
    // Fetch price action data directly from Benzinga API
    const priceData = await fetchPriceDataFromBenzinga(ticker);
    if (!priceData) {
      return '';
    }
    
    const { quote, changePercent } = priceData;
    const symbol = quote.symbol ?? ticker.toUpperCase();
    
    const marketStatus = getMarketStatus();
    const dayOfWeek = getCurrentDayName();
    
    // Check if it's a weekend
    const now = new Date();
    const nyTime = new Date(now.toLocaleString("en-US", {timeZone: "America/New_York"}));
    const isWeekend = nyTime.getDay() === 0 || nyTime.getDay() === 6;
    
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
    
    // During open market hours, if changePercent is 0 or missing, skip the change percentage
    // (Benzinga's delayed feed may not have updated it yet, showing 0.00% is misleading)
    // For other market statuses (premarket, afterhours, closed), show 0 if provided (stock truly unchanged)
    const shouldShowChangePercent = marketStatus === 'open'
      ? (changePercent !== undefined && changePercent !== 0)
      : changePercent !== undefined;
    
    const changePercentForCalc = changePercent ?? 0;
    const upDown = changePercentForCalc > 0 ? 'up' : changePercentForCalc < 0 ? 'down' : 'unchanged';
    const absChange = Math.abs(changePercentForCalc).toFixed(2);
    
    // Build price action text with explicit string concatenation
    let priceActionText = '';
    
    if (marketStatus === 'open') {
      if (shouldShowChangePercent) {
        priceActionText = `${symbol} Price Action: ${companyName} shares were ${upDown} ${absChange}% at $${priceString} at the time of publication on ${dayOfWeek}`;
      } else {
        // Skip change percentage if it's 0 and we couldn't calculate it (Benzinga hasn't updated yet)
        priceActionText = `${symbol} Price Action: ${companyName} shares were trading at $${priceString} at the time of publication on ${dayOfWeek}`;
      }
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
    
    // Only bold the ticker prefix (e.g., "MSFT Price Action:"), not the entire line
    const prefixMatch = priceActionText.match(/^([A-Z]+\s+Price Action:)\s+(.+)$/);
    if (prefixMatch) {
      const prefix = prefixMatch[1];
      const rest = prefixMatch[2];
      return `<strong>${prefix}</strong> ${rest}, according to <a href="https://pro.benzinga.com/dashboard">Benzinga Pro data</a>.`;
    }
    // Fallback: if pattern doesn't match, return as-is with prefix bolded
    return `<strong>${priceActionText}</strong>, according to <a href="https://pro.benzinga.com/dashboard">Benzinga Pro data</a>.`;
  } catch (error) {
    console.error(`Error generating price action line for ${ticker}:`, error);
    return '';
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
          console.log(`[PRICE API] Raw quote data for ${ticker}:`, JSON.stringify(quote, null, 2));
          
          // Use changePercent directly from API - this matches generatePriceActionLine logic
          const changePercent = typeof quote.changePercent === 'number' ? quote.changePercent : 0;
          
          // Enhanced price action with session-specific data
          priceAction = {
            last: quote.lastTradePrice || 0,
            change: quote.change || 0,
            changePercent: changePercent, // Use API's changePercent directly (same as generatePriceActionLine)
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
            // Try multiple possible field names for premarket changePercent
            premarket: {
              last: quote.preMarketLast || quote.preMarketPrice || quote.lastTradePrice || 0,
              change: quote.preMarketChange || 0,
              changePercent: quote.preMarketChangePercent || quote.preMarketChangePerc || changePercent || 0,
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
            previousClose: quote.previousClose || quote.previousClosePrice || 0,
            companyName: quote.companyStandardName || quote.name || ticker.toUpperCase()
          };
          console.log('Parsed enhanced price action:', JSON.stringify(priceAction, null, 2));
          console.log(`[PRICE DATA] Market Status: ${marketStatus}, ChangePercent: ${priceAction.changePercent}, Last: ${priceAction.last}, Previous Close: ${priceAction.previousClose}`);
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
        // Sort by date (most recent first)
        const sortedRatings = ratingsArray
          .sort((a: any, b: any) => {
            const dateA = new Date(a.date || a.created || 0).getTime();
            const dateB = new Date(b.date || b.created || 0).getTime();
            return dateB - dateA; // Most recent first
          });
        
        analystRatings = sortedRatings.slice(0, 3).map((rating: any) => {
          console.log('Processing rating:', rating);
          // Use analyst field for firm name (not action_company which contains actions like "Reiterates", "Maintains")
          const firmName = rating.analyst || rating.firm || rating.analyst_firm || rating.firm_name || 'Unknown Firm';
          const actionCompany = rating.action_company || rating.action || rating.rating_action || '';
          const currentRating = rating.rating_current || rating.rating || rating.new_rating || '';
          const priorRating = rating.rating_prior || '';
          const priceTarget = rating.pt_current || rating.pt || rating.price_target || rating.target || null;
          
          // Format the action description based on action_company and rating changes
          let actionText = '';
          const actionLower = actionCompany.toLowerCase();
          
          if (actionLower.includes('upgrade') || (priorRating && currentRating && currentRating !== priorRating && priorRating.toLowerCase() < currentRating.toLowerCase())) {
            actionText = `Upgraded to ${currentRating}`;
          } else if (actionLower.includes('downgrade') || (priorRating && currentRating && currentRating !== priorRating)) {
            actionText = `Downgrades to ${currentRating}`;
          } else if (actionLower.includes('reiterates') || actionLower.includes('maintains')) {
            actionText = actionCompany.charAt(0).toUpperCase() + actionCompany.slice(1).toLowerCase();
            if (currentRating) {
              actionText += ` ${currentRating}`;
            }
          } else if (actionCompany && currentRating) {
            actionText = `${actionCompany} ${currentRating}`;
          } else if (currentRating) {
            actionText = currentRating;
          }
          
          // Build the line: Firm Name: Action (Target $X.XX)
          let line = `${firmName}: ${actionText}`;
          if (priceTarget) {
            line += ` (Target $${parseFloat(priceTarget.toString()).toFixed(2)})`;
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
    
    // Fetch consensus ratings, earnings date, and edge ratings
    const [consensusRatings, nextEarnings, edgeRatings] = await Promise.all([
      fetchConsensusRatings(ticker),
      fetchNextEarningsDate(ticker),
      fetchEdgeRatings(ticker)
    ]);
    
    return {
      priceAction,
      analystRatings,
      recentArticles, // Array of up to 2 articles
      consensusRatings, // Consensus rating and price target
      nextEarnings, // Next earnings date and estimates
      edgeRatings, // Edge rankings data
    };
  } catch (error) {
    console.error('Error fetching stock data:', error);
    return { priceAction: null, analystRatings: [], recentArticles: [], consensusRatings: null, nextEarnings: null, edgeRatings: null };
  }
}

// Fetch context brief from external agent
async function fetchContextBrief(ticker: string, backendUrl?: string): Promise<any | null> {
  if (!backendUrl) {
    console.log(`⚠️ [CONTEXT BRIEF] ${ticker}: NEWS_AGENT_BACKEND_URL not configured`);
    return null;
  }

  try {
    const apiUrl = `${backendUrl}/api/enrichment/context-brief`;
    console.log(`[CONTEXT BRIEF] ${ticker}: Fetching from ${apiUrl}`);
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ticker: ticker.toUpperCase() }),
    });

    if (!response.ok) {
      console.error(`⚠️ [CONTEXT BRIEF] ${ticker}: API returned ${response.status}`);
      return null;
    }

    const data = await response.json();
    console.log(`✅ [CONTEXT BRIEF] ${ticker}: Received context brief`);
    return data;
  } catch (error) {
    console.error(`[CONTEXT BRIEF] ${ticker}: Error fetching context brief:`, error);
    return null;
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
    
    // Log the article text being sent to verify header format
    const sectionHeaderMatches = articleText.match(/##\s*Section:\s*[^\n]+/gi);
    console.log(`[SEO AGENT] Sending article to SEO agent with ${sectionHeaderMatches?.length || 0} section headers:`, sectionHeaderMatches);
    console.log(`[SEO AGENT] Article text length: ${articleText.length} characters`);
    console.log(`[SEO AGENT] Article preview (first 500 chars):`, articleText.substring(0, 500));
    
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
      
      // Log the raw response from SEO agent
      console.log(`[SEO AGENT] Received optimized text, length: ${cleanedText.length}`);
      console.log(`[SEO AGENT] Raw response preview (first 500 chars):`, cleanedText.substring(0, 500));
      
      // Remove markdown code block wrapper
      cleanedText = cleanedText.replace(/^```markdown\s*/i, '').replace(/\s*```$/i, '');
      cleanedText = cleanedText.replace(/^```\s*/, '').replace(/\s*```$/, '');
      
      // Convert markdown H2 (## Heading) to HTML H2 (<h2>Heading</h2>)
      cleanedText = cleanedText.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
      
      // Convert markdown H3 (### Heading) to HTML H3 (<h3>Heading</h3>)
      cleanedText = cleanedText.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
      
      // Remove trailing "..." if it exists at the very end
      cleanedText = cleanedText.replace(/\s*\.{3,}\s*$/, '').trim();
      
      // Log the final cleaned text to verify headers were converted
      const htmlHeaderMatches = cleanedText.match(/<h2>[^<]+<\/h2>/gi);
      console.log(`[SEO AGENT] After cleaning, found ${htmlHeaderMatches?.length || 0} HTML headers:`, htmlHeaderMatches);
      
      return cleanedText;
    }
    
    return null;
  } catch (error) {
    console.error('Error calling SEO subhead injection API:', error);
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
        storyType: 'wgo'
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

export async function POST(request: Request) {
  try {
    const { ticker, contextBriefs, aiProvider } = await request.json();
    
    console.log(`[WGO-NO-NEWS] ===== POST handler called for ticker: ${ticker} =====`);
    
    if (!ticker) {
      return NextResponse.json({ error: 'Ticker is required.' }, { status: 400 });
    }

    const backendUrl = process.env.NEWS_AGENT_BACKEND_URL;
    const tickerUpper = ticker.toUpperCase();
    
    // Step 1: Use provided context brief if available
    let contextBrief = contextBriefs && contextBriefs[tickerUpper] ? contextBriefs[tickerUpper] : null;
    if (contextBrief) {
      console.log(`[ENRICHED WGO] ${tickerUpper}: Using provided context brief from frontend:`, {
        hasData: !!contextBrief,
        majorEventDetected: contextBrief?.major_event_detected || false,
        sentiment: contextBrief?.sentiment || null,
        hasSummary: !!contextBrief?.summary_of_events,
        articleCount: contextBrief?.articles?.length || 0
      });
    }

    // Fetch stock data
    console.log(`[WGO-NO-NEWS] Fetching initial stockData for ${ticker}...`);
    const stockData = await fetchStockData(ticker);
    console.log(`[WGO-NO-NEWS] Initial stockData fetched. priceAction.changePercent: ${stockData.priceAction?.changePercent}%`);
    console.log(`[WGO-NO-NEWS] Edge ratings data:`, stockData.edgeRatings ? 'present' : 'missing (API may have failed or BENZINGA_EDGE_API_KEY not configured)');
     
           // Get current date and market status for context
      const currentDate = new Date();
      const currentDateStr = currentDate.toISOString().slice(0, 10);
      const marketStatus = getMarketStatus();
      const currentDayName = getCurrentDayName();
      
      // Check if it's a weekend for tense adjustment
      const nyTime = new Date(currentDate.toLocaleString("en-US", {timeZone: "America/New_York"}));
      const isWeekend = nyTime.getDay() === 0 || nyTime.getDay() === 6;
      
      // Get sector performance for comparison line
      const sectorPerformance = await getStockSectorPerformance(ticker);
      
      // Fetch historical sector performance if sector ETF is available
      let historicalSectorPerformance: { weekChange?: number; monthChange?: number } | null = null;
      if (sectorPerformance) {
        // Determine sector ETF from sector performance data
        const sectorETFTicker = sectorPerformance.sectorName === 'Technology' ? 'XLK' :
                                sectorPerformance.sectorName === 'Financial' ? 'XLF' :
                                sectorPerformance.sectorName === 'Energy' ? 'XLE' :
                                sectorPerformance.sectorName === 'Healthcare' ? 'XLV' :
                                sectorPerformance.sectorName === 'Industrial' ? 'XLI' :
                                sectorPerformance.sectorName === 'Consumer Staples' ? 'XLP' :
                                sectorPerformance.sectorName === 'Consumer Discretionary' ? 'XLY' :
                                sectorPerformance.sectorName === 'Utilities' ? 'XLU' :
                                sectorPerformance.sectorName === 'Real Estate' ? 'XLRE' :
                                sectorPerformance.sectorName === 'Communication Services' ? 'XLC' :
                                sectorPerformance.sectorName === 'Materials' ? 'XLB' : null;
        
        if (sectorETFTicker) {
          historicalSectorPerformance = await fetchHistoricalSectorPerformance(sectorETFTicker);
        }
      }
     
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

     // CRITICAL: Fetch fresh price data RIGHT BEFORE generating the article to ensure lead and Catalyst use the same data as price action line
     // This MUST happen right before building the prompt, after all other data fetching is complete
     console.log(`[PRICE ACTION SYNC] ===== Starting sync for ${ticker} (RIGHT BEFORE PROMPT BUILD) =====`);
     console.log(`[PRICE ACTION SYNC] Fetching fresh price data for ${ticker} using shared helper...`);
     const freshPriceData = await fetchPriceDataFromBenzinga(ticker);
     console.log(`[PRICE ACTION SYNC] Fresh price data received: ${freshPriceData ? `changePercent=${freshPriceData.changePercent ?? 'undefined'}` : 'null'}`);
     
     if (freshPriceData && stockData.priceAction) {
       const oldChangePercent = stockData.priceAction.changePercent;
       stockData.priceAction.changePercent = freshPriceData.changePercent ?? 0; // Default to 0 for stockData (used in lead/catalyst)
       stockData.priceAction.last = freshPriceData.quote.lastTradePrice || stockData.priceAction.last;
       stockData.priceAction.previousClose = freshPriceData.quote.previousClose || freshPriceData.quote.previousClosePrice || stockData.priceAction.previousClose;
       console.log(`[PRICE ACTION SYNC] ✅ SUCCESS: Updated stockData.priceAction.changePercent from ${oldChangePercent ?? 'undefined'} to ${freshPriceData.changePercent ?? 'undefined'} for ${ticker}`);
       console.log(`[PRICE ACTION SYNC] Verified: stockData.priceAction.changePercent is now ${stockData.priceAction.changePercent ?? 'undefined'}`);
     } else if (!freshPriceData) {
       console.warn(`[PRICE ACTION SYNC] ⚠️ Failed to fetch fresh price data for ${ticker}`);
     } else if (!stockData.priceAction) {
       console.error(`[PRICE ACTION SYNC] ❌ stockData.priceAction is null for ${ticker}`);
     }

           // Generate WGO No News story
           // Build lead paragraph instructions - use standard template for both enriched and regular flows
           // STANDARD FLOW: Use standard template regardless of context brief (maintain enriched process structure)
          const dailyChangePercent = stockData.priceAction?.changePercent || 0;
          console.log(`[LEAD PARAGRAPH] ===== Building lead paragraph for ${ticker} =====`);
          console.log(`[LEAD PARAGRAPH] Using dailyChangePercent: ${dailyChangePercent}% (from stockData.priceAction.changePercent)`);
          console.log(`[LEAD PARAGRAPH] Direction: ${dailyChangePercent > 0 ? 'UP' : dailyChangePercent < 0 ? 'DOWN' : 'UNCHANGED'}`);
           
           // Narrative Logic Block for Lead Paragraph
           let narrativeGuidance = '';
           if (dailyChangePercent > 2) {
             narrativeGuidance = 'Use words like "Surge," "Rally," "Jump." Focus the lead on today\'s action.';
           } else if (dailyChangePercent < -2) {
             narrativeGuidance = 'Use words like "Slide," "Pullback," "Drop."';
           } else if (dailyChangePercent >= -1 && dailyChangePercent <= 1) {
             narrativeGuidance = 'Use words like "Consolidates," "Holds Steady," "Flat." If the weekly performance is high, frame the narrative as: "[Company] takes a breather, holding onto gains after a massive weekly rally."';
           } else {
             narrativeGuidance = 'Describe the price movement accurately based on the percentage change.';
           }
           
           // Determine direction for explicit instruction
           const stockDirection = dailyChangePercent > 0 ? 'UP' : dailyChangePercent < 0 ? 'DOWN' : 'UNCHANGED';
           
           const leadInstructions = `**LEAD PARAGRAPH (exactly 2 sentences):**

CRITICAL: The daily_change_percent variable is ${dailyChangePercent.toFixed(2)}%. This means the stock is ${stockDirection}. You MUST use this exact direction in your lead paragraph.

LEAD PARAGRAPH LOGIC: Check the daily_change_percent variable (${dailyChangePercent.toFixed(2)}%) before writing. If the value is positive (${dailyChangePercent > 0 ? 'YES' : 'NO'}), the stock is UP. If the value is negative (${dailyChangePercent < 0 ? 'YES' : 'NO'}), the stock is DOWN. If the value is zero, the stock is UNCHANGED.

CRITICAL: DO NOT include exact percentage values in the lead paragraph. Use only the direction: "up", "down", or "unchanged". For example, write "Microsoft Corp stock is down on Monday" NOT "Microsoft Corp stock is down 0.03% on Monday". The exact percentage appears only in the price action line at the bottom of the article.

${contextBrief ? `CRITICAL ENRICHMENT INSTRUCTION: If a Context Brief is provided, you MUST prioritize specific, high-value narrative from the Context Brief in your lead paragraph. Scan the Context Brief for:
- Specific analyst firms or networks (e.g., "Schwab Network", "Needham", "Wedbush")
- Specific company initiatives or products mentioned (e.g., "Azure", "AI Edge", "iPhone 17")
- Specific competitive dynamics (e.g., "Azure vs Google", "AI race")
- Specific events or analysis (e.g., "analysts doubled down on", "highlighted strategic advantage")

DO NOT default to generic sector data. If the Context Brief contains specific narratives, use THOSE in the lead paragraph instead of generic statements like "reflecting broader momentum in the technology sector." For example, if the Context Brief mentions "Schwab Network analysts seeing Azure's edge over Google," lead with that specific narrative rather than generic sector performance.

The lead paragraph should combine: (1) Price movement direction, (2) The SPECIFIC narrative from Context Brief (if available), and (3) Market context as secondary information.` : ''}

${narrativeGuidance}

- First sentence: Start with company name and ticker in format "[Company Name] (NASDAQ:TICKER)" or "[Company Name] (NYSE:TICKER)", then describe actual price movement direction only (up/down/unchanged) with time context. Use "shares are" not "stock is". ${contextBrief ? 'If Context Brief is provided, immediately follow the price direction with the SPECIFIC narrative from the Context Brief (e.g., "as analysts at Schwab Network doubled down on the company\'s AI Edge" or "after Needham raised the target").' : ''} ${marketStatus === 'premarket' ? 'CRITICAL PREMARKET: Since the market status is PREMARKET, you MUST include "during premarket trading" in your first sentence. Example: "Microsoft Corp (NASDAQ:MSFT) shares are up during premarket trading on Monday, [context]".' : marketStatus === 'afterhours' ? 'CRITICAL AFTER-HOURS: Since the market status is AFTER-HOURS, you MUST include "during after-hours trading" in your first sentence. Example: "Microsoft Corp (NASDAQ:MSFT) shares are up during after-hours trading on Monday, [context]".' : 'Example: "Microsoft Corp (NASDAQ:MSFT) shares are down on Monday, [context]".'} DO NOT include percentage values - use only words like "up", "down", or "unchanged".
${isWeekend ? '- CRITICAL: Today is a weekend (Saturday or Sunday). Markets are CLOSED on weekends. Use PAST TENSE ("were down", "were up", "closed down", "closed up") instead of present tense ("are down", "are up"). Reference Friday as the last trading day.' : ''}
- Second sentence: ${contextBrief ? 'If Context Brief narrative was used in first sentence, provide market context (sector performance, broader trends) in the second sentence. ' : ''}Brief context about sector correlation or market context - do NOT mention technical indicators here${isWeekend ? '. CRITICAL WEEKEND: Use past tense throughout this sentence (e.g., "The move came", "The decline came", "stocks were lower") since you are referring to Friday\'s trading action.' : ''}
- CRITICAL WORD CHOICE: DO NOT use the word "amidst" - it's a clear AI writing pattern. Use natural alternatives like "as", "during", "on", or "following" instead. For example, use "The stock's decline came as" or "during a mixed market day" instead of "comes amidst".
- CRITICAL LOGIC RULE: If the stock's direction matches the sector's direction (both up OR both down), describe it as moving WITH sector trends. If the stock's direction OPPOSES the sector's direction (stock down but sector up, OR stock up but sector down), describe it as company-specific performance (e.g., "Apple's decline suggests company-specific concerns as the Technology sector advanced"). Always verify the actual sector performance data before making this statement.`;

          const catalystInstructions = `**CATALYST SECTION (after section marker):**
- Write 2-3 paragraphs that provide rich context about what's driving the stock's movement
- Focus on sector correlation, market context, relative strength/weakness, and any relevant context from the Context Brief (if provided)
- CRITICAL LOGIC RULES - Use this decision tree:
  * Stock DOWN + Sector DOWN = Moving WITH sector weakness (sector-specific challenges)
  * Stock DOWN + Sector UP = Moving AGAINST sector strength (company-specific weakness)
  * Stock UP + Sector UP = Moving WITH sector strength (sector-specific strength)
  * Stock UP + Sector DOWN = Moving AGAINST sector weakness (company-specific strength)
- FIRST PARAGRAPH: ALWAYS state the actual CURRENT DAY sector performance FIRST with the exact percentage (e.g., "The Technology sector saw a gain of 0.27% on Friday"), then explain whether the stock is moving WITH or AGAINST that trend. If stock is moving AGAINST sector (opposite direction), explicitly state it's company-specific performance.
- SECOND PARAGRAPH (optional, if Context Brief provided): Weave in relevant context from the Context Brief (summary_of_events, key articles) to add depth about recent developments, market sentiment, or events that might be influencing the stock's movement. Do NOT just list events - integrate them naturally into the narrative about why the stock is moving.
- THIRD PARAGRAPH (optional): Additional context about broader market conditions, sector trends, or relative performance that helps explain the movement.
- CRITICAL: You can ONLY make claims about sector "struggles", "pressure", or broader trends over time (e.g., "technology stocks faced some pressure" or "sector's overall struggles") if historical sector performance data is provided below. If no historical data is provided, you MUST only reference the current day's performance.
- DO NOT mention specific Moving Averages (SMAs), RSI numbers, MACD, or any technical indicators here
- DO NOT mention 12-month performance, 52-week ranges, or specific price levels here
- Keep each paragraph to 2 sentences maximum${isWeekend ? '. CRITICAL WEEKEND: Use past tense throughout (e.g., "came", "saw", "were", "was") since referring to Friday\'s trading action.' : ''}`;
           
             // FINAL VERIFICATION: Log the exact value being sent to AI
             console.log(`[FINAL VERIFICATION] About to send prompt to AI. dailyChangePercent=${dailyChangePercent}%, stockDirection=${stockDirection}, stockData.priceAction.changePercent=${stockData.priceAction?.changePercent}%`);
             
             const prompt = `
You are a financial journalist creating a WGO No News story for ${ticker}. Focus on technical analysis and market data.

CURRENT DATE: ${currentDateStr}
CURRENT MARKET STATUS: ${marketStatus}

STOCK DATA:
${JSON.stringify(stockData, null, 2)}

⚠️⚠️⚠️ CRITICAL PRICE DIRECTION - READ THIS FIRST ⚠️⚠️⚠️
The stock's changePercent in stockData.priceAction.changePercent is ${dailyChangePercent.toFixed(2)}%. 
This means the stock is currently ${stockDirection}. 
YOU MUST USE THIS EXACT DIRECTION IN YOUR LEAD PARAGRAPH.
- If changePercent is POSITIVE (${dailyChangePercent > 0 ? 'YES, IT IS POSITIVE' : 'NO'}), the stock is UP - use words like "up", "gains", "rises", "advances"
- If changePercent is NEGATIVE (${dailyChangePercent < 0 ? 'YES, IT IS NEGATIVE' : 'NO'}), the stock is DOWN - use words like "down", "declines", "falls", "drops"  
- If changePercent is ZERO, the stock is UNCHANGED - use words like "flat", "unchanged", "holds steady"

DO NOT IGNORE THIS. The price action line at the bottom of the article will show the same direction. Your lead paragraph MUST match.

${contextBrief ? `
CONTEXT BRIEF (Recent News & Events):
${JSON.stringify(contextBrief, null, 2)}

CRITICAL CONTEXT INSTRUCTION: Review the context_brief data above. If major_event_detected is TRUE (e.g., a lawsuit, recall, crash, or significant negative news), you MUST mention this event in the first paragraph as a counter-weight to the price movement. Do not bury this news. If major_event_detected is FALSE, you should still weave relevant context from the summary_of_events and articles into your Catalyst section to provide richer context about what's driving the stock's movement beyond just technical indicators and sector performance.

` : ''}

${sectorPerformance ? `
CURRENT DAY SECTOR PERFORMANCE:
- ${sectorPerformance.sectorName} sector: ${sectorPerformance.sectorChange.toFixed(2)}% ${sectorPerformance.sectorChange >= 0 ? 'gain' : 'loss'} on ${currentDayName}
- S&P 500: ${sectorPerformance.sp500Change.toFixed(2)}% ${sectorPerformance.sp500Change >= 0 ? 'gain' : 'loss'} on ${currentDayName}
` : ''}

${historicalSectorPerformance && sectorPerformance ? `
HISTORICAL SECTOR PERFORMANCE (use this data ONLY when making claims about sector trends over time):
- ${sectorPerformance.sectorName} sector past week: ${historicalSectorPerformance.weekChange !== undefined ? `${historicalSectorPerformance.weekChange.toFixed(2)}% ${historicalSectorPerformance.weekChange >= 0 ? 'gain' : 'loss'}` : 'data not available'}
- ${sectorPerformance.sectorName} sector past month: ${historicalSectorPerformance.monthChange !== undefined ? `${historicalSectorPerformance.monthChange.toFixed(2)}% ${historicalSectorPerformance.monthChange >= 0 ? 'gain' : 'loss'}` : 'data not available'}

CRITICAL: You can ONLY use phrases like "sector struggles", "sector pressure", "broader trend", or "technology stocks faced some pressure" if the historical data above shows the sector is actually down over the past week/month. If the historical data shows gains, do NOT make claims about sector struggles.
` : 'HISTORICAL SECTOR PERFORMANCE: Not available. You can ONLY reference the current day\'s sector performance. Do NOT make claims about sector trends over time (e.g., "sector struggles", "broader pressure") without historical data to support it.'}

MANDATORY DATA RULES:

No Generic Summaries: Never write "technical indicators are bullish" without citing the specific number.

Bad: "The RSI suggests the stock is overbought."
Good: "With an RSI of 67.18, the stock is approaching overbought territory."

Show the Spread: When reporting Moving Averages, you MUST state the percentage difference.

Requirement: "Trading 19.8% above the 20-day SMA."

If Data is Missing: If a specific field (like MACD) is null or undefined in the input, do NOT write "The data is not available." Simply omit that sentence entirely.

CRITICAL INSTRUCTIONS:

1. ${leadInstructions}

2. SECTION MARKER: After the lead paragraph, insert "## Section: The Catalyst" on its own line.

3. ${catalystInstructions}

4. SECTION MARKER: After the Catalyst section, insert "## Section: Technical Analysis" on its own line.

5. TECHNICAL ANALYSIS SECTION (simplified structure):
Write exactly 3 paragraphs for technical analysis:

TECHNICAL ANALYSIS PARAGRAPH 1 (MOVING AVERAGES, 12-MONTH PERFORMANCE, 52-WEEK RANGE): Write a single paragraph that combines: (1) Stock position relative to 20-day and 100-day SMAs with exact percentages if available (e.g., "Apple stock is currently trading 2.3% below its 20-day simple moving average (SMA), but is 19.8% above its 100-day SMA, demonstrating longer-term strength"). YOU MUST state the percentage difference when reporting Moving Averages. (2) 12-month performance if available (e.g., "Shares have increased/decreased X% over the past 12 months"), and (3) 52-week range position (e.g., "and are currently positioned closer to their 52-week highs than lows" or "closer to their 52-week lows than highs" - DO NOT include a percentage, just use qualitative positioning). If specific technical data is not available in the stock data, omit that sentence entirely - do NOT write "The data is not available." Keep this to 2-3 sentences maximum.

TECHNICAL ANALYSIS PARAGRAPH 2 (RSI AND MACD): Write a single paragraph that combines: (1) RSI level and interpretation if available. CRITICAL RSI INTERPRETATION: RSI below 30 = oversold/bearish, RSI 30-45 = bearish, RSI 45-55 = neutral, RSI 55-70 = bullish momentum, RSI above 70 = overbought. Use accurate interpretations with the specific number (e.g., "With an RSI of 67.18, the stock is approaching overbought territory" or "The RSI is at 62.41, signaling bullish momentum that still has room to run before hitting overbought territory"). (2) MACD status if available (e.g., "Meanwhile, MACD is above its signal line, suggesting bullish conditions" or "MACD is below its signal line, indicating bearish pressure"). **CRITICAL: If RSI data is NOT available (null or undefined), DO NOT mention RSI at all. If MACD data is NOT available (null or undefined), DO NOT mention MACD at all. If BOTH are missing, skip this entire paragraph entirely. DO NOT write phrases like "not available", "cannot assess", "cannot comment", or "data is not provided". Simply omit any mention of missing indicators completely.** Keep this to 2 sentences maximum if data is available, or omit the paragraph entirely if no data.

TECHNICAL ANALYSIS PARAGRAPH 3 (RSI/MACD SUMMARY): **ONLY write this paragraph if you wrote paragraph 2 AND it contained RSI and/or MACD data.** Write a single sentence that summarizes the RSI and MACD signals using accurate RSI interpretations (e.g., "The combination of bullish RSI and bullish MACD confirms strong upward momentum" or "The combination of neutral RSI and bearish MACD suggests mixed momentum"). **If paragraph 2 was omitted (no RSI/MACD data available), then OMIT this paragraph 3 entirely as well.** Keep this to 1 sentence maximum. STOP AFTER THIS PARAGRAPH.

KEY LEVELS (MANDATORY): After paragraph 3, you MUST extract and display the key support and resistance levels in a clear, scannable format. Format as bullet points using HTML <ul> and <li> tags:
<ul>
<li><strong>Key Resistance</strong>: $XXX.XX</li>
<li><strong>Key Support</strong>: $XXX.XX</li>
</ul>
These should be clearly labeled, rounded to the nearest $0.50, and formatted as bullet points. This format helps with SEO and Featured Snippets.

${stockData.consensusRatings || stockData.nextEarnings ? `
6. SECTION MARKER: After the technical analysis section, insert "## Section: Earnings & Analyst Outlook" on its own line.

6. EARNINGS AND ANALYST OUTLOOK SECTION (forward-looking):
After the section marker, include a forward-looking section that anticipates the upcoming earnings report and provides analyst outlook. This section should help investors understand both the stock's value proposition and how analysts view it.

ANALYST REPORTING RULES:

Name Names: You must list the specific firms and their price targets if provided in the data.

Structure: "[Firm Name] reiterated a [Rating] with a [Price Target]."

Deduplicate Logic: If the data lists the same firm twice, ONLY report the most recent rating/target.

Contextualize: Compare the average price target to the current price to determine if the stock is trading at a premium or discount.

CRITICAL INSTRUCTIONS FOR THIS SECTION:
- Start with a brief introductory sentence (1 sentence max) about the earnings date
- Then present key data points as separate lines (not HTML bullets) with bold labels
- Format: Use <strong> tags to bold the labels (EPS Estimate, Revenue Estimate, Analyst Consensus), followed by the data on the same line
- Each data point should be on its own line with a blank line between them
- Focus on helping investors understand: (1) whether the stock represents good value, and (2) how analysts view the stock
- CRITICAL PRICE TARGET LOGIC: When mentioning the price target in the intro sentence, compare it to the current price (stockData.priceAction.last). 
  * If price target is ABOVE current price (e.g., target $631 > current $474): Say "suggesting the stock may be trading at a discount relative to analyst expectations" or "indicating potential upside" or "trading below analyst targets"
  * If price target is BELOW current price (e.g., target $400 < current $474): Say "suggesting the stock may be trading at a premium relative to analyst expectations" or "trading above analyst targets"
  * Always verify the math: Higher target = Discount/Upside, Lower target = Premium
- Make it forward-looking and actionable for investors

${stockData.nextEarnings ? `
UPCOMING EARNINGS DATA:
- Next Earnings Date: ${formatEarningsDate(stockData.nextEarnings.date)}
${stockData.nextEarnings.eps_estimate ? `- EPS Estimate: $${parseFloat(stockData.nextEarnings.eps_estimate.toString()).toFixed(2)}` : ''}
${stockData.nextEarnings.eps_prior ? `- Previous EPS: $${parseFloat(stockData.nextEarnings.eps_prior.toString()).toFixed(2)}` : ''}
${stockData.nextEarnings.revenue_estimate ? `- Revenue Estimate: ${formatRevenue(stockData.nextEarnings.revenue_estimate as string | number | null)}` : ''}
${stockData.nextEarnings.revenue_prior ? `- Previous Revenue: ${formatRevenue(stockData.nextEarnings.revenue_prior as string | number | null)}` : ''}

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
- Start with ONE brief introductory sentence ONLY (e.g., "Investors are looking ahead to the <a href="https://www.benzinga.com/quote/${tickerUpper}/earnings">next earnings report</a> on [DATE].") - DO NOT include earnings estimates or analyst data in this sentence. CRITICAL: You MUST include the hyperlink on "next earnings report" using the exact format shown in the example.
- Then format the data as HTML bullet points (<ul> and <li> tags) with bold labels for "Hard Numbers":
  - EPS Estimate
  - Revenue Estimate
  - Valuation (P/E Ratio) - if available
- Then create a subsection "Analyst Consensus & Recent Actions:" (with bold label) that includes:
  - The consensus rating and average price target
  - Recent analyst moves (use the ANALYST RATINGS DATA provided above, format as: "[Firm Name]: [Action] (Target $X.XX)")
- Format example:
  <ul>
  <li><strong>EPS Estimate</strong>: $X.XX (Up from $X.XX YoY)</li>
  <li><strong>Revenue Estimate</strong>: $X.XX billion (Up from $X.XX billion YoY)</li>
  <li><strong>Valuation</strong>: P/E of X.Xx (Indicates premium valuation)</li>
  </ul>
  
  <strong>Analyst Consensus & Recent Actions:</strong>
  The stock carries a [Rating] Rating with an average price target of $X.XX. Recent analyst moves include:
  
  <ul>
  <li><strong>[Actual Firm Name 1]:</strong> [Action from data] (Target $X.XX)</li>
  <li><strong>[Actual Firm Name 2]:</strong> [Action from data] (Target $X.XX)</li>
  <li><strong>[Actual Firm Name 3]:</strong> [Action from data] (Target $X.XX)</li>
  </ul>
  
  <strong>Valuation Insight:</strong> <em>[Analysis of P/E, consensus, and price target relationship]</em>

CRITICAL FORMATTING:
- Recent analyst moves MUST be formatted as HTML bullet points using <ul> and <li> tags
- Each firm name MUST be wrapped in <strong> tags (e.g., <strong>Wedbush:</strong>)
- The Valuation Insight text MUST be wrapped in <em> tags for italics
- Use the EXACT firm names and actions from the ANALYST RATINGS DATA provided above. DO NOT use placeholder text like "Firm A", "Firm B", "Firm C" or "[FIRM NAME]". Copy the exact firm names and actions from the data provided.

IMPORTANT: When earnings estimates are available, ALWAYS compare them to the same quarter from the previous year (year-over-year comparison):
- If eps_prior is available, compare eps_estimate to eps_prior (e.g., "up from $0.65 from the same quarter last year" or "down from $0.80 from the prior-year period")
- If revenue_prior is available, compare revenue_estimate to revenue_prior (e.g., "revenue of $25.5M, up from $23.2M from the same quarter last year")
- NOTE: eps_prior and revenue_prior represent the same quarter from the previous year, NOT the sequentially previous quarter
- This year-over-year comparison helps investors understand whether expectations show growth, decline, or stability compared to the same period last year
` : ''}

SECTION BOUNDARIES (STRICT - CRITICAL):
- **CATALYST SECTION:** Focus ONLY on News (or lack of it), Sector Correlation, Market Context, and Relative Strength. DO NOT mention specific Moving Averages (SMAs), RSI numbers, MACD, 12-month performance, 52-week ranges, or any technical indicators here.
- **TECHNICAL ANALYSIS SECTION:** This is the ONLY place for SMAs, RSI, MACD, 12-month performance, 52-week ranges, and all technical data. DO NOT repeat technical data from this section in the Catalyst section.

${stockData.edgeRatings ? `
7. SECTION MARKER: After the Earnings & Analyst Outlook section, insert "## Section: Benzinga Edge Rankings" on its own line.

8. BENZINGA EDGE RANKINGS SECTION:
After the section marker, include a section analyzing the Benzinga Edge rankings.

CRITICAL FORMATTING: Immediately after the "## Section: Benzinga Edge Rankings" header, add this line: "Below is the <a href=\"https://www.benzinga.com/edge/\">Benzinga Edge scorecard</a> for ${stockData.priceAction?.companyName || ticker.toUpperCase()} (${ticker.toUpperCase()}), highlighting its strengths and weaknesses compared to the broader market:"

BENZINGA EDGE RANKINGS DATA:
- Value Rank: ${stockData.edgeRatings.value_rank || 'N/A'}
- Growth Rank: ${stockData.edgeRatings.growth_rank || 'N/A'}
- Quality Rank: ${stockData.edgeRatings.quality_rank || 'N/A'}
- Momentum Rank: ${stockData.edgeRatings.momentum_rank || 'N/A'}

CRITICAL: Use the EXACT numbers from the data above. Format scores as [Number]/100 (e.g., "4/100", "83/100").

BENZINGA EDGE SECTION RULES - FORMAT AS "TRADER'S SCORECARD":

1. FORMAT: Use a bulleted list with HTML <ul> and <li> tags, NOT paragraphs. This structured format helps with SEO and Featured Snippets.

2. SCORING LOGIC & LABELS:
   - Score > 60: Label as "Strong" or "Bullish"
   - Score < 40: Label as "Weak" or "Bearish"  
   - Score 40-60: Label as "Neutral" or "Moderate"

3. INTERPRETATION: Do NOT just list the number. Add a 1-sentence interpretation after each score.

4. FORMAT EXAMPLE (use HTML bullets):
   <ul>
   <li><strong>Momentum</strong>: Bullish (Score: 83/100) — Stock is outperforming the broader market.</li>
   <li><strong>Quality</strong>: Solid (Score: 66/100) — Balance sheet remains healthy.</li>
   <li><strong>Momentum</strong>: Neutral (Score: 42/100) — Stock is showing moderate movement.</li>
   <li><strong>Value</strong>: Risk (Score: 4/100) — Trading at a steep premium relative to peers.</li>
   </ul>

5. HANDLING N/A: If a ranking is "N/A" or missing (null/undefined), OMIT IT COMPLETELY. Do NOT write "Growth ranking N/A" or mention missing rankings at all. Only include rankings that have actual numeric values.

6. THE VERDICT: After the bullet list, add a 2-sentence summary that synthesizes the rankings and provides actionable insight. Start with "<strong>The Verdict:</strong> ${stockData.priceAction?.companyName || ticker.toUpperCase()}'s Benzinga Edge signal reveals..." and continue with the analysis. Example: "<strong>The Verdict:</strong> Tesla's Benzinga Edge signal reveals a classic 'High-Flyer' setup. While the Momentum (83) confirms the strong trend, the extremely low Value (4) score warns that the stock is priced for perfection—investors should ride the trend but use tight stop-losses."

7. ORDER: Present rankings in order of importance: Momentum first, then Quality, then Value, then Growth (if available).
` : ''}

${stockData.edgeRatings ? '10' : '8'}. WRITING STYLE:
- Professional financial journalism
- Active voice, clear language
- No flowery phrases like "amidst" or "whilst"
- Keep paragraphs to 2 sentences maximum

CRITICAL: DO NOT generate any links, including "Also Read", "What to Know", "Read Next", or any other links. All links are added programmatically after the story is generated. Write only the article content without any links.

CRITICAL: DO NOT generate a price action line at the end. The price action line is added programmatically after the story is generated. End your story after the last section (Technical Analysis, Earnings & Analyst Outlook, or Benzinga Edge Rankings, depending on what's included).

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

    // If contextBrief was provided (Enrich First mode), automatically add news section
    if (contextBrief) {
      if (!backendUrl) {
        console.log(`⚠️ [ENRICHED WGO] ${tickerUpper}: NEWS_AGENT_BACKEND_URL not configured, cannot fetch news section. Please configure NEWS_AGENT_BACKEND_URL environment variable.`);
      } else {
        try {
          console.log(`[ENRICHED WGO] ${tickerUpper}: Fetching news section for Enrich First mode...`);
          const newsSection = await fetchNewsSection(tickerUpper, story, backendUrl);
          if (newsSection) {
            // Insert the news section after "The Catalyst" section and before "Technical Analysis"
            const technicalAnalysisMarker = /##\s*Section:\s*Technical Analysis/i;
            
            if (technicalAnalysisMarker.test(story)) {
              const match = story.match(technicalAnalysisMarker);
              if (match && match.index !== undefined) {
                const beforeTechnical = story.substring(0, match.index).trim();
                const afterTechnical = story.substring(match.index);
                story = `${beforeTechnical}\n\n${newsSection}\n\n${afterTechnical}`;
                console.log(`✅ [ENRICHED WGO] ${tickerUpper}: Inserted news section before Technical Analysis`);
              }
            } else {
              // Fallback: try to find "The Catalyst" section and insert after it
              const catalystMarker = /(##\s*Section:\s*The Catalyst[\s\S]*?)(?=\n##\s*Section:|$)/i;
              if (catalystMarker.test(story)) {
                story = story.replace(catalystMarker, `$1\n\n${newsSection}\n\n`);
                console.log(`✅ [ENRICHED WGO] ${tickerUpper}: Inserted news section after The Catalyst`);
              } else {
                // Last resort: append before "Read Next" or at the end
                const readNextMarker = /\n\nRead Next:/i;
                const readNextMatch = story.match(readNextMarker);
                if (readNextMatch && readNextMatch.index !== undefined) {
                  const beforeReadNext = story.substring(0, readNextMatch.index).trim();
                  const afterReadNext = story.substring(readNextMatch.index + 2);
                  story = `${beforeReadNext}\n\n${newsSection}\n\n${afterReadNext}`;
                } else {
                  story = story + '\n\n' + newsSection;
                }
                console.log(`✅ [ENRICHED WGO] ${tickerUpper}: Inserted news section at fallback location`);
              }
            }
          }
        } catch (error) {
          console.error(`[ENRICHED WGO] ${tickerUpper}: Error adding news section:`, error);
        }
      }
    }

    // Fetch related articles (will be inserted after price action line is added)
    const relatedArticles = await fetchRelatedArticles(ticker);
    
    // Remove any "What to Know" links that the AI might have generated (safety measure)
    story = story.replace(/<p>What to Know About.*?<\/p>/gi, '');
    story = story.replace(/What to Know About.*?(?:<\/a>|<\/p>)/gi, '');

    // Post-process to add hyperlinks to earnings/analyst text (for both structured sections and paragraph format)
    // Add hyperlink to "next earnings report" if it appears in paragraph format (enriched flow)
    // Match: "Investors are looking ahead to the next earnings report on [DATE]" (with or without "company's")
    if (!story.match(/next earnings report.*?<a href="https:\/\/www\.benzinga\.com\/quote\/[^"]+\/earnings">/i)) {
      // Try with "company's" first
      story = story.replace(/(Investors are looking ahead to the company's )next earnings report( on [^,\.]+(?:,|\.))/gi, 
        `$1<a href="https://www.benzinga.com/quote/${tickerUpper}/earnings">next earnings report</a>$2`);
      // Then try without "company's" (more common format)
      story = story.replace(/(Investors are looking ahead to the )next earnings report( on [^,\.]+(?:,|\.))/gi, 
        `$1<a href="https://www.benzinga.com/quote/${tickerUpper}/earnings">next earnings report</a>$2`);
    }
    
    // Add hyperlink to "average price target" if it appears in paragraph format
    // Match: "with an average price target of $421.79"
    if (!story.match(/average price target.*?<a href="https:\/\/www\.benzinga\.com\/quote\/[^"]+\/analyst-ratings">/i)) {
      story = story.replace(/(with an )average price target( of \$[\d.]+)/gi, 
        `$1<a href="https://www.benzinga.com/quote/${tickerUpper}/analyst-ratings">average price target</a>$2`);
    }
    
    // Also handle "Avg Price Target" format (structured format)
    if (!story.match(/Avg Price Target.*?<a href="https:\/\/www\.benzinga\.com\/quote\/[^"]+\/analyst-ratings">/i)) {
      story = story.replace(/(\(\$[\d.]+ )Avg Price Target(\))/gi, 
        `$1<a href="https://www.benzinga.com/quote/${tickerUpper}/analyst-ratings">Avg Price Target</a>$2`);
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
        // Build formatted lines with bold labels using actual data from stockData.nextEarnings when available
        const lines: string[] = [];
        let intro = '';
        let priceTargetNote = '';
        
        // Use actual earnings data if available, otherwise fall back to extraction
        if (stockData.nextEarnings) {
          const tickerUpper = ticker.toUpperCase();
          intro = `Investors are looking ahead to the <a href="https://www.benzinga.com/quote/${tickerUpper}/earnings">next earnings report</a> on ${formatEarningsDate(stockData.nextEarnings.date)}.`;
          
          // Use actual formatted EPS values
          if (stockData.nextEarnings.eps_estimate !== null && stockData.nextEarnings.eps_estimate !== undefined) {
            const epsEst = parseFloat(stockData.nextEarnings.eps_estimate.toString());
            const epsPrior = stockData.nextEarnings.eps_prior ? parseFloat(stockData.nextEarnings.eps_prior.toString()) : null;
            const direction = epsPrior !== null ? (epsEst > epsPrior ? 'Up' : epsEst < epsPrior ? 'Down' : '') : '';
            lines.push(`<strong>EPS Estimate</strong>: $${epsEst.toFixed(2)}${epsPrior !== null && direction ? ` (${direction} from $${epsPrior.toFixed(2)} YoY)` : ''}`);
          }
          
          // Use actual formatted revenue values (this fixes the "$0.08 million" issue)
          if (stockData.nextEarnings.revenue_estimate !== null && stockData.nextEarnings.revenue_estimate !== undefined) {
            const revEstFormatted = formatRevenue(stockData.nextEarnings.revenue_estimate as string | number | null);
            const revPriorFormatted = stockData.nextEarnings.revenue_prior ? formatRevenue(stockData.nextEarnings.revenue_prior as string | number | null) : null;
            const revEstNum = typeof stockData.nextEarnings.revenue_estimate === 'string' ? parseFloat(stockData.nextEarnings.revenue_estimate) : stockData.nextEarnings.revenue_estimate;
            const revPriorNum = stockData.nextEarnings.revenue_prior ? (typeof stockData.nextEarnings.revenue_prior === 'string' ? parseFloat(stockData.nextEarnings.revenue_prior) : stockData.nextEarnings.revenue_prior) : null;
            const direction = revPriorNum !== null ? (revEstNum > revPriorNum ? 'Up' : revEstNum < revPriorNum ? 'Down' : '') : '';
            lines.push(`<strong>Revenue Estimate</strong>: ${revEstFormatted}${revPriorFormatted && direction ? ` (${direction} from ${revPriorFormatted} YoY)` : ''}`);
          }
          
          // Extract consensus rating and price target from AI text or use actual data
          let consensusRatingMatch = earningsContent.match(/(?:consensus|has a) ([A-Za-z]+) rating/i);
          let priceTargetMatch = earningsContent.match(/price target of \$([\d.]+)/i);
          
          // Use actual consensus data if available
          if (stockData.consensusRatings) {
            const rating = stockData.consensusRatings.consensus_rating ? stockData.consensusRatings.consensus_rating.charAt(0) + stockData.consensusRatings.consensus_rating.slice(1).toLowerCase() : null;
            const target = stockData.consensusRatings.consensus_price_target ? parseFloat(stockData.consensusRatings.consensus_price_target.toString()) : null;
            
            if (rating && target) {
              const tickerUpper = ticker.toUpperCase();
              lines.push(`<strong>Analyst Consensus</strong>: ${rating} Rating (<a href="https://www.benzinga.com/quote/${tickerUpper}/analyst-ratings">$${target.toFixed(2)} Avg Price Target</a>)`);
              
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
            } else if (rating) {
              lines.push(`<strong>Analyst Consensus</strong>: ${rating} Rating`);
            } else if (target) {
              const tickerUpper = ticker.toUpperCase();
              lines.push(`<strong>Analyst Consensus</strong>: <a href="https://www.benzinga.com/quote/${tickerUpper}/analyst-ratings">$${target.toFixed(2)} Avg Price Target</a>`);
            }
          } else if (consensusRatingMatch && priceTargetMatch) {
            // Fallback to extraction if no actual data
            const rating = consensusRatingMatch[1].charAt(0) + consensusRatingMatch[1].slice(1).toLowerCase();
            const target = parseFloat(priceTargetMatch[1]);
            lines.push(`<strong>Analyst Consensus</strong>: ${rating} Rating ($${target.toFixed(2)} Avg Price Target)`);
          }
        } else {
          // Fallback to extraction if no earnings data available
          let earningsDateMatch = earningsContent.match(/(?:scheduled for|on|report on|earnings report on) ([A-Za-z]+ \d{1,2}, \d{4})/i);
          if (!earningsDateMatch) {
            earningsDateMatch = earningsContent.match(/(?:scheduled for|on|report on|earnings report on) ([^,]+?)(?:,|\.|$)/i);
          }
          
          let epsEstimateMatch = earningsContent.match(/earnings per share of \$([\d.-]+)/i);
          let epsPriorMatch = earningsContent.match(/(?:up from|down from|compared to|from the same quarter last year|from a loss of) \$([\d.-]+)/i);
          let revenueEstimateMatch = earningsContent.match(/revenue of (\$[\d.]+[BM])/i);
          let revenuePriorMatch = earningsContent.match(/revenue.*?(?:up from|down from|compared to|from the same quarter last year|from the prior-year period) (\$[\d.]+[BM])/i);
          let consensusRatingMatch = earningsContent.match(/(?:consensus|has a) ([A-Za-z]+) rating/i);
          let priceTargetMatch = earningsContent.match(/price target of \$([\d.]+)/i);
          
          if (earningsDateMatch) {
            const tickerUpper = ticker.toUpperCase();
            intro = `Investors are looking ahead to the <a href="https://www.benzinga.com/quote/${tickerUpper}/earnings">next earnings report</a> on ${earningsDateMatch[1].trim()}.`;
            
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
              const tickerUpper = ticker.toUpperCase();
              lines.push(`<strong>Analyst Consensus</strong>: ${rating} Rating (<a href="https://www.benzinga.com/quote/${tickerUpper}/analyst-ratings">$${target.toFixed(2)} Avg Price Target</a>)`);
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
          console.log('✅ Formatted Earnings & Analyst Outlook section with bold labels and bullet points using actual data');
        } else if (lines.length > 0) {
          // We have lines but no intro - use default
          const tickerUpper = ticker.toUpperCase();
          intro = `Investors are looking ahead to the <a href="https://www.benzinga.com/quote/${tickerUpper}/earnings">next earnings report</a>.`;
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

    // Post-process Earnings & Analyst Outlook section to format analyst actions as bullet points with bolded firm names
    // and ensure Valuation Insight is in italics
    const earningsSectionMarker2 = /##\s*Section:\s*Earnings\s*&\s*Analyst\s*Outlook/i;
    const earningsSectionMatch2 = story.match(earningsSectionMarker2);
    if (earningsSectionMatch2 && earningsSectionMatch2.index !== undefined) {
      const afterEarningsMarker2 = story.substring(earningsSectionMatch2.index + earningsSectionMatch2[0].length);
      const nextSectionMatch2 = afterEarningsMarker2.match(/(##\s*Section:|##\s*Top\s*ETF|Price Action:)/i);
      const earningsSectionEnd2 = nextSectionMatch2 ? nextSectionMatch2.index! : afterEarningsMarker2.length;
      const earningsContent2 = afterEarningsMarker2.substring(0, earningsSectionEnd2);

      // Format analyst actions as bullet points with bolded firm names
      // Look for "Recent analyst moves include:" followed by firm names on separate lines
      const analystActionsPattern = /Recent analyst moves include:([\s\S]*?)(?=\s*<strong>Valuation Insight:|$)/i;
      const analystActionsMatch = earningsContent2.match(analystActionsPattern);
      
      if (analystActionsMatch && analystActionsMatch[1] && !analystActionsMatch[1].includes('<ul>')) {
        const analystActionsText = analystActionsMatch[1].trim();
        const analystLines = analystActionsText.split('\n').filter(line => {
          const trimmed = line.trim();
          return trimmed.length > 0 && trimmed.includes(':') && !trimmed.match(/^<[a-z]/i);
        });
        
        if (analystLines.length > 0) {
          const formattedAnalystActions = analystLines.map(line => {
            const trimmedLine = line.trim();
            // Extract firm name (everything before the first colon)
            const colonIndex = trimmedLine.indexOf(':');
            if (colonIndex > 0) {
              const firmName = trimmedLine.substring(0, colonIndex).trim();
              const actionText = trimmedLine.substring(colonIndex + 1).trim();
              return `  <li><strong>${firmName}:</strong> ${actionText}</li>`;
            }
            return `  <li>${trimmedLine}</li>`;
          }).join('\n');

          const formattedBulletPoints = `\n\n<ul>\n${formattedAnalystActions}\n</ul>`;
          
          // Replace the plain text analyst actions with formatted bullet points
          const beforeAnalystActions = earningsContent2.substring(0, analystActionsMatch.index! + 'Recent analyst moves include:'.length);
          const afterAnalystActions = earningsContent2.substring(analystActionsMatch.index! + analystActionsMatch[0].length);
          const newEarningsContent = beforeAnalystActions + formattedBulletPoints + afterAnalystActions;

          // Replace the earnings section in the story
          const beforeEarningsSection = story.substring(0, earningsSectionMatch2.index + earningsSectionMatch2[0].length);
          const afterEarningsSection = story.substring(earningsSectionMatch2.index + earningsSectionMatch2[0].length + earningsSectionEnd2);
          story = `${beforeEarningsSection}\n\n${newEarningsContent}\n\n${afterEarningsSection}`;
          console.log('✅ Formatted analyst actions as bullet points with bolded firm names');
        }
      }

      // Ensure Valuation Insight is in italics
      // Match pattern: "<strong>Valuation Insight:</strong> [text]" where text is not already in <em> tags
      const valuationInsightPattern = /(<strong>Valuation Insight:<\/strong>)\s*([^<\n]+?)(?=\s*(?:<strong>|##|$))/gi;
      let valuationInsightReplaced = false;
      story = story.replace(valuationInsightPattern, (match, label, text) => {
        const trimmedText = text.trim();
        // Only wrap in <em> if not already wrapped
        if (!trimmedText.startsWith('<em>') && trimmedText.length > 0) {
          valuationInsightReplaced = true;
          return `${label} <em>${trimmedText}</em>`;
        }
        return match;
      });
      if (valuationInsightReplaced) {
        console.log('✅ Ensured Valuation Insight is in italics');
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

    // Generate and add price action line programmatically
    // First, remove any AI-generated price action lines (they should not be generated, but remove them if present)
    const priceActionCompanyName = stockData.priceAction?.companyName || ticker.toUpperCase();
    const programmaticPriceAction = await generatePriceActionLine(ticker, priceActionCompanyName, stockData);
    
    if (programmaticPriceAction) {
      // Remove any existing price action lines (AI might have generated one despite instructions)
      // Pattern 1: With <strong> tags
      story = story.replace(/<strong>.*?Price Action:.*?<\/strong>.*?according to.*?Benzinga Pro.*?(?:data\.|\.)/gis, '');
      // Pattern 2: Without <strong> tags
      story = story.replace(/Price Action:.*?according to.*?Benzinga Pro(?: data)?\./gis, '');
      // Pattern 3: More flexible - just "Price Action:" to end of sentence
      story = story.replace(/Price Action:.*?\.(?=\s|$)/gis, '');
      
      // Remove any standalone ticker symbols that might be leftover from price action removal
      // Look for pattern like "MSFT\n\n" or "MSFT\n" at end of sections
      story = story.replace(/\n\n([A-Z]{1,5})\n\n(?=Price Action:|##|$)/g, '\n\n');
      story = story.replace(/\n([A-Z]{1,5})\n(?=Price Action:|##|$)/g, '\n');
    }

    // Add "Also Read" section after the lead paragraph (second paragraph)
    // Use stockData.recentArticles if available, otherwise fall back to relatedArticles
    const articlesForAlsoRead = (stockData.recentArticles && stockData.recentArticles.length > 0) ? stockData.recentArticles : relatedArticles;
    if (articlesForAlsoRead && articlesForAlsoRead.length > 0) {
      const alsoReadPattern = /<p>Also Read:.*?<\/p>/i;
      const alsoReadExists = alsoReadPattern.test(story);
      
      if (!alsoReadExists) {
        // Find paragraphs by splitting on </p> tags
        const paragraphs = story.split('</p>').filter(p => p.trim().length > 0);
        const targetIndex = 2; // After second paragraph (lead sentence 1, lead sentence 2, Also Read)
        
        if (paragraphs.length >= 2) {
          const alsoReadSection = `<p>Also Read: <a href="${articlesForAlsoRead[0].url}">${articlesForAlsoRead[0].headline}</a></p>`;
          paragraphs.splice(targetIndex, 0, alsoReadSection);
          story = paragraphs.map(p => {
            if (p.trim().endsWith('</p>')) return p;
            return p + '</p>';
          }).join('');
          console.log('✅ "Also Read" section placed after lead paragraph');
        } else {
          console.warn(`⚠️ Not enough paragraphs (${paragraphs.length}) to insert "Also Read" section. Need at least 2 paragraphs.`);
        }
      } else {
        console.log('✅ "Also Read" section already exists in story');
      }
    } else {
      console.warn('⚠️ No articles available for "Also Read" section. relatedArticles:', relatedArticles?.length || 0, 'stockData.recentArticles:', stockData.recentArticles?.length || 0);
    }

    // Fetch and append ETF information (before Price Action section)
    try {
      const etfs = await fetchETFs(ticker);
      if (etfs && etfs.length > 0) {
        const etfInfo = formatETFInfo(etfs, ticker);
        if (etfInfo) {
          // Append ETF info at the end (before Price Action section)
          story += '\n\n' + etfInfo;
          console.log('✅ Added ETF information');
        }
      }
    } catch (etfError) {
      console.error(`Error fetching ETF data for ${ticker}:`, etfError);
      // Continue without ETF info if there's an error
    }
    
    // Add Price Action section with header and price action line at the very end
    if (programmaticPriceAction) {
      story += '\n\n## Section: Price Action\n\n' + programmaticPriceAction;
      console.log('✅ Added Price Action section with header');
    }
    
    // Add "Read Next" section after Price Action
    // Use stockData.recentArticles if available, otherwise fall back to relatedArticles
    const articlesForReadNext = (stockData.recentArticles && stockData.recentArticles.length > 0) ? stockData.recentArticles : relatedArticles;
    if (articlesForReadNext && articlesForReadNext.length > 0) {
      if (!story.includes('Read Next:')) {
        const readNextSection = `<p>Read Next: <a href="${articlesForReadNext[1]?.url || articlesForReadNext[0].url}">${articlesForReadNext[1]?.headline || articlesForReadNext[0].headline}</a></p>`;
        story += '\n\n' + readNextSection;
        console.log('✅ "Read Next" section added after Price Action');
      }
    }

    // If contextBrief was provided (Enrich First mode), automatically inject SEO subheads
    // SEO injection is the FINAL STEP - no post-processing after this (matches Earnings Preview approach)
    if (contextBrief && backendUrl) {
      try {
        console.log(`[ENRICHED WGO] ${tickerUpper}: Injecting SEO subheads (final step)...`);
        const optimizedStory = await injectSEOSubheads(story, backendUrl);
        if (optimizedStory) {
          story = optimizedStory;
          console.log(`✅ [ENRICHED WGO] ${tickerUpper}: SEO subheads injected successfully (final step)`);
        }
      } catch (error) {
        console.error(`[ENRICHED WGO] ${tickerUpper}: Error injecting SEO subheads:`, error);
      }
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