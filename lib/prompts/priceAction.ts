// lib/prompts/priceAction.ts

const POLYGON_API_KEY = process.env.POLYGON_API_KEY!;

async function fetchStockPrice(ticker: string) {
  const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${POLYGON_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch stock price for ${ticker}`);
  const data = await res.json();
  return data.results?.[0];
}

async function fetchSP500Price() {
  // Use SPY ETF as S&P 500 proxy
  const url = `https://api.polygon.io/v2/aggs/ticker/SPY/prev?adjusted=true&apiKey=${POLYGON_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch S&P 500 price');
  const data = await res.json();
  return data.results?.[0];
}

export async function fetchPriceActionText(ticker: string) {
  try {
    const stock = await fetchStockPrice(ticker);
    const sp500 = await fetchSP500Price();

    if (!stock || !sp500) {
      throw new Error('Missing price data');
    }

    const latestPrice = stock.c;
    const prevClose = stock.o; // or stock.pc depending on API
    const stockChangePercent = ((latestPrice - prevClose) / prevClose) * 100;

    const spLatestPrice = sp500.c;
    const spPrevClose = sp500.o;
    const spChangePercent = ((spLatestPrice - spPrevClose) / spPrevClose) * 100;

    return `Stock ${ticker} closed at $${latestPrice.toFixed(2)}, moving ${stockChangePercent.toFixed(2)}% since last close. ` +
      `The S&P 500 (SPY) changed ${spChangePercent.toFixed(2)}% over the same period.`;
  } catch (err) {
    console.error('Error fetching price action:', err);
    return `Price action data is currently unavailable for ${ticker}.`;
  }
}

// Optional prompt generator for AI narrative
export function getPriceActionPrompt(ticker: string, priceSummary: string) {
  return `
You are a financial journalist writing a Stock Price Action summary for ${ticker}.

Here is the raw price summary data:

${priceSummary}

Write a concise, engaging paragraph summarizing this price action and its significance compared to the S&P 500 over the past year.
`;
}
