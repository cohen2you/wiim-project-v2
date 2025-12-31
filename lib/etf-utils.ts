// ETF utility functions for fetching ETF holdings data from Benzinga

export interface ETFHolder {
  id: number;
  fund_id: number;
  fund_name: string;
  fund_slug: string;
  fund_symbol?: string; // Ticker symbol from API
  fund_exchange?: string; // Exchange from API
  sharepercentage: string;
  etf_id: number | null;
  inception_date: string;
  marketcapital: string;
  ticker?: string; // Legacy field name
  symbol?: string; // Alternative field name
  exchange?: string; // Legacy field name
  [key: string]: unknown; // Allow for additional fields we might not know about
}

// Function to lookup ETF ticker by fund name using Benzinga quote API
export async function lookupETFTicker(fundName: string, stockTicker?: string): Promise<{ ticker?: string; exchange?: string } | null> {
  try {
    console.log(`Looking up ticker for ETF: ${fundName}`);
    
    // First, try to extract ticker from fund name if it's in parentheses
    // e.g., "ARK Space Exploration & Innovation ETF (ARKX)"
    const tickerInName = fundName.match(/\(([A-Z]+)\)/);
    if (tickerInName) {
      const ticker = tickerInName[1];
      console.log(`Found ticker in name: ${ticker}`);
      // Verify it's an ETF and get exchange info
      const quoteUrl = `https://api.benzinga.com/api/v2/quoteDelayed?token=${process.env.BENZINGA_API_KEY}&symbols=${ticker}`;
      const quoteRes = await fetch(quoteUrl);
      if (quoteRes.ok) {
        const quoteData = await quoteRes.json();
        const quote = quoteData && quoteData[ticker];
        if (quote) {
          console.log(`Verified ticker ${ticker} is an ETF on ${quote.bzExchange || quote.exchange}`);
          return { ticker, exchange: quote.bzExchange || quote.exchange };
        }
        // Even if quote lookup fails, return the ticker we found
        return { ticker };
      }
    }
    
    // For leveraged ETFs, try common patterns
    // GraniteShares leveraged ETFs have specific tickers
    if (stockTicker && fundName.toLowerCase().includes('graniteshares')) {
      const multiplierMatch = fundName.match(/(\d+(?:\.\d+)?)x/i);
      if (multiplierMatch) {
        const multiplier = parseFloat(multiplierMatch[1]);
        const stockCode = stockTicker.substring(0, 2).toUpperCase();
        const potentialTickers: string[] = [];
        
        if (multiplier === 2) {
          potentialTickers.push(`F${stockCode[0]}L`);
          potentialTickers.push(`F${stockCode}L`);
        } else if (multiplier === 1.5) {
          potentialTickers.push(`F${stockCode[0]}U`);
          potentialTickers.push(`F${stockCode}U`);
        }
        
        // Also try direct lookups for known META ETFs
        if (stockTicker.toUpperCase() === 'META') {
          if (multiplier === 2) {
            potentialTickers.unshift('FBL');
          } else if (multiplier === 1.5) {
            potentialTickers.unshift('FBU', 'FME');
          }
        }
        
        console.log(`Trying GraniteShares patterns for ${multiplier}x: ${potentialTickers.join(', ')}`);
        
        for (const potentialTicker of potentialTickers) {
          try {
            const quoteUrl = `https://api.benzinga.com/api/v2/quoteDelayed?token=${process.env.BENZINGA_API_KEY}&symbols=${potentialTicker}`;
            const quoteRes = await fetch(quoteUrl);
            if (quoteRes.ok) {
              const quoteData = await quoteRes.json();
              const quote = quoteData && quoteData[potentialTicker];
              if (quote) {
                console.log(`Checking ${potentialTicker}: type=${quote.type}, name=${quote.name}`);
                if (quote.type === 'ETF' || quote.description?.toLowerCase().includes('etf')) {
                  const quoteName = (quote.name || quote.description || '').toLowerCase();
                  const fundNameLower = fundName.toLowerCase();
                  const stockNameLower = stockTicker.toLowerCase();
                  
                  const isGraniteShares = quoteName.includes('graniteshares');
                  const matchesStock = quoteName.includes(stockNameLower) || fundNameLower.includes(stockNameLower);
                  const matchesMultiplier = quoteName.includes(`${multiplier}x`) || fundNameLower.includes(`${multiplier}x`);
                  
                  if (isGraniteShares && (matchesStock || matchesMultiplier)) {
                    console.log(`Found matching GraniteShares ETF ticker: ${potentialTicker} for ${fundName}`);
                    return { ticker: potentialTicker, exchange: quote.bzExchange || quote.exchange };
                  }
                }
              }
            }
          } catch (error) {
            continue;
          }
        }
      }
    }
    
    // Try extracting meaningful acronyms from the name
    const nameWords = fundName.split(/\s+/);
    const potentialTickers: string[] = [];
    
    for (const word of nameWords) {
      const cleanWord = word.replace(/[^A-Z0-9]/g, '').toUpperCase();
      if (cleanWord.length >= 2 && cleanWord.length <= 5 && /^[A-Z0-9]+$/.test(cleanWord)) {
        if (!['ETF', 'LONG', 'SHORT', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEAR', 'X', 'META'].includes(cleanWord)) {
          potentialTickers.push(cleanWord);
        }
      }
    }
    
    console.log(`Trying potential tickers: ${potentialTickers.slice(0, 5).join(', ')}`);
    
    // Try each potential ticker (limit to 5)
    for (const potentialTicker of potentialTickers.slice(0, 5)) {
      try {
        const quoteUrl = `https://api.benzinga.com/api/v2/quoteDelayed?token=${process.env.BENZINGA_API_KEY}&symbols=${potentialTicker}`;
        const quoteRes = await fetch(quoteUrl);
        if (quoteRes.ok) {
          const quoteData = await quoteRes.json();
          const quote = quoteData && quoteData[potentialTicker];
          if (quote && (quote.type === 'ETF' || quote.description?.toLowerCase().includes('etf'))) {
            console.log(`Found ETF ticker: ${potentialTicker} for ${fundName}`);
            return { ticker: potentialTicker, exchange: quote.bzExchange || quote.exchange };
          }
        }
      } catch {
        continue;
      }
    }
    
    console.log(`No ticker found for ${fundName}`);
    return null;
  } catch (error) {
    console.error(`Error looking up ETF ticker for ${fundName}:`, error);
    return null;
  }
}

// Function to fetch ETF holders from Benzinga API
export async function fetchETFs(symbol: string): Promise<Array<ETFHolder & { ticker?: string; exchange?: string }>> {
  try {
    const url = `https://www.benzinga.com/lavapress/api/get-top-holders/${symbol.toUpperCase()}`;
    console.log(`Fetching ETFs for ${symbol} from: ${url}`);
    
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`Failed to fetch ETFs for ${symbol}: ${res.status} ${res.statusText}`);
      return [];
    }
    
    const data = await res.json();
    if (!Array.isArray(data)) {
      console.error(`Invalid ETF data format for ${symbol}`);
      return [];
    }
    
    // Helper function to parse market cap string (e.g., "$3,224.44B" -> 3224.44)
    const parseMarketCap = (marketCapStr: string): number => {
      if (!marketCapStr) return 0;
      const cleaned = marketCapStr.replace(/[$,]/g, '').trim().toUpperCase();
      let multiplier = 1;
      let numStr = cleaned;
      
      if (cleaned.endsWith('T')) {
        multiplier = 1000; // Trillions to billions
        numStr = cleaned.slice(0, -1);
      } else if (cleaned.endsWith('B')) {
        multiplier = 1; // Already in billions
        numStr = cleaned.slice(0, -1);
      } else if (cleaned.endsWith('M')) {
        multiplier = 0.001; // Millions to billions
        numStr = cleaned.slice(0, -1);
      }
      
      const num = parseFloat(numStr);
      return isNaN(num) ? 0 : num * multiplier;
    };
    
    // Helper function to extract AUM from API response
    const extractAUM = (item: ETFHolder): number => {
      const aumFields = ['aum', 'assets_under_management', 'total_assets', 'net_assets', 'assets', 'fund_aum'];
      
      for (const field of aumFields) {
        if (item[field] !== undefined && item[field] !== null) {
          const value = item[field];
          if (typeof value === 'string' && value.trim() === '') continue;
          
          if (typeof value === 'string') {
            const parsed = parseMarketCap(value);
            if (parsed > 0) return parsed;
          } else if (typeof value === 'number' && value > 0) {
            return value > 10000 ? value / 1000000000 : value;
          }
        }
        
        // Check case-insensitive match
        const lowerField = field.toLowerCase();
        for (const key in item) {
          if (key.toLowerCase() === lowerField && item[key] !== undefined && item[key] !== null) {
            const value = item[key];
            if (typeof value === 'string' && value.trim() === '') continue;
            if (typeof value === 'string') {
              const parsed = parseMarketCap(value);
              if (parsed > 0) return parsed;
            } else if (typeof value === 'number' && value > 0) {
              return value > 10000 ? value / 1000000000 : value;
            }
          }
        }
      }
      return 0;
    };
    
    // Filter and process ETFs
    const allETFs = data
      .filter((item: ETFHolder) => item.fund_name && parseFloat(item.sharepercentage || '0') > 0)
      .map((item: ETFHolder) => {
        const directAUM = extractAUM(item);
        return {
          ...item,
          _parsedMarketCap: directAUM > 0 ? directAUM : parseMarketCap(item.marketcapital || ''),
          _aumFromAPI: directAUM > 0
        };
      });
    
    // For ETFs without AUM from API, look up actual ETF AUM from the Benzinga quote API
    const etfsNeedingLookup = allETFs.filter(etf => !etf._aumFromAPI || etf._parsedMarketCap === 0);
    
    // Look up actual ETF AUMs in parallel (limit to top 20)
    const aumLookups = await Promise.all(
      etfsNeedingLookup.slice(0, 20).map(async (etf) => {
        const ticker = etf.fund_symbol || etf.ticker || etf.symbol;
        if (!ticker) return { etf, aum: 0 };
        
        try {
          const quoteUrl = `https://api.benzinga.com/api/v2/quoteDelayed?token=${process.env.BENZINGA_API_KEY}&symbols=${ticker}`;
          const quoteRes = await fetch(quoteUrl);
          if (quoteRes.ok) {
            const quoteData = await quoteRes.json();
            const quote = quoteData && quoteData[ticker];
            if (quote) {
              let aum = 0;
              if (quote.marketcap) {
                aum = parseMarketCap(quote.marketcap);
              } else if (quote.sharesOutstanding && quote.lastTradePrice) {
                aum = (parseFloat(quote.sharesOutstanding) * parseFloat(quote.lastTradePrice)) / 1000000000;
              }
              return { etf, aum };
            }
          }
        } catch (error) {
          console.log(`Failed to lookup AUM for ${ticker}:`, error);
        }
        return { etf, aum: 0 };
      })
    );
    
    // Update AUMs in allETFs array
    aumLookups.forEach(({ etf, aum }) => {
      if (aum > 0) {
        const index = allETFs.findIndex(e => e.fund_id === etf.fund_id);
        if (index !== -1) {
          allETFs[index]._parsedMarketCap = aum;
          allETFs[index].marketcapital = `$${aum.toFixed(2)}B`;
        }
      }
    });
    
    // Also update marketcapital for ETFs that had AUM from API
    allETFs.forEach(etf => {
      if (etf._aumFromAPI && etf._parsedMarketCap > 0) {
        etf.marketcapital = `$${etf._parsedMarketCap.toFixed(2)}B`;
      }
    });
    
    // Sort by market cap (largest first) and take top 3
    const sortedETFs = allETFs.sort((a, b) => {
      if (a._parsedMarketCap > 0 && b._parsedMarketCap > 0) {
        return b._parsedMarketCap - a._parsedMarketCap;
      }
      if (a._parsedMarketCap > 0) return -1;
      if (b._parsedMarketCap > 0) return 1;
      return parseFloat(b.sharepercentage || '0') - parseFloat(a.sharepercentage || '0');
    });
    
    const etfs = sortedETFs
      .slice(0, 3)
      .map((etf) => {
        const { _parsedMarketCap, _aumFromAPI, ...rest } = etf;
        return rest;
      });
    
    // Lookup tickers for each ETF
    const etfsWithTickers = await Promise.all(
      etfs.map(async (etf: ETFHolder) => {
        const ticker = etf.fund_symbol || etf.ticker || etf.symbol;
        const exchange = etf.fund_exchange || etf.exchange;
        
        // If ticker and exchange are already in the API response, use them directly
        if (ticker && exchange) {
          return {
            ...etf,
            ticker: ticker,
            exchange: exchange
          };
        }
        
        // Fall back to lookup logic if not in API response
        const tickerInfo = await lookupETFTicker(etf.fund_name, symbol);
        return {
          ...etf,
          ticker: tickerInfo?.ticker || ticker,
          exchange: tickerInfo?.exchange || exchange
        };
      })
    );
    
    console.log(`Found ${etfsWithTickers.length} ETFs for ${symbol}`);
    return etfsWithTickers;
  } catch (error) {
    console.error(`Error fetching ETFs for ${symbol}:`, error);
    return [];
  }
}

// Helper function to format exchange code to readable name
function formatExchangeName(exchangeCode: string | null | undefined): string {
  if (!exchangeCode) return 'NASDAQ'; // Default fallback
  
  const exchangeNames: { [key: string]: string } = {
    'XNAS': 'NASDAQ',
    'XNYS': 'NYSE',
    'XASE': 'AMEX',
    'ARCX': 'ARCA',
    'ARCA': 'ARCA', // Handle both ARCX and ARCA
    'BATS': 'BATS',
    'EDGX': 'EDGX',
    'EDGA': 'EDGA'
  };
  
  // Check if it's already a readable name
  const upperCode = exchangeCode.toUpperCase();
  if (exchangeNames[upperCode]) {
    return exchangeNames[upperCode];
  }
  
  // If it looks like a readable name already, clean it up
  if (upperCode.includes('NYSE ARCA')) {
    return 'ARCA';
  }
  if (upperCode.includes('NASDAQ')) {
    return 'NASDAQ';
  }
  if (upperCode.includes('ARCA')) {
    return 'ARCA';
  }
  
  return exchangeCode;
}

// Function to format ETF information as a section with subhead and bulleted list
export function formatETFInfo(etfs: Array<ETFHolder & { ticker?: string; exchange?: string }>): string {
  if (!etfs || etfs.length === 0) {
    return '';
  }
  
  // Format each ETF as a bullet point with bold name, ticker, and weight
  // Use HTML list format for WordPress compatibility
  const etfBullets = etfs.map((etf) => {
    const fundName = etf.fund_name || '';
    const ticker = etf.ticker || etf.fund_symbol || etf.symbol || '';
    const exchangeCode = etf.exchange || etf.fund_exchange || '';
    const exchange = formatExchangeName(exchangeCode);
    const weight = parseFloat(etf.sharepercentage || '0').toFixed(2);
    
    // Format: <li><strong>ETF Name</strong> (EXCHANGE:TICKER): X.XX% Weight</li>
    // This ensures proper bullet formatting when copied to WordPress
    if (ticker && exchange) {
      return `<li><strong>${fundName}</strong> (${exchange}:${ticker}): ${weight}% Weight</li>`;
    } else if (ticker) {
      return `<li><strong>${fundName}</strong> (${ticker}): ${weight}% Weight</li>`;
    } else {
      // Fallback if no ticker
      return `<li><strong>${fundName}</strong>: ${weight}% Weight</li>`;
    }
  });
  
  // Build insight sentence about why ETF holdings matter
  const totalWeight = etfs.reduce((sum, etf) => sum + parseFloat(etf.sharepercentage || '0'), 0);
  let insight = '';
  
  if (totalWeight > 15) {
    insight = `With significant weighting across these ETFs, the stock's performance can impact investors tracking these funds, making it important for ETF investors to monitor the company's moves.`;
  } else if (totalWeight > 5) {
    insight = `These holdings represent meaningful positions that can influence ETF performance, making the stock's movements relevant for investors in these funds.`;
  } else {
    insight = `These ETF holdings provide institutional backing and can contribute to trading volume, making them relevant for investors tracking fund performance.`;
  }
  
  // Return as a section with subhead, bulleted list (using HTML <ul> for WordPress), and insight
  return `\n\n## Top ETF Exposure\n\n<ul>\n${etfBullets.join('\n')}\n</ul>\n\n${insight}`;
}

