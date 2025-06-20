export interface StorySection {
  title: string;
  content: string;
}

export interface StockData {
  ticker: string;
  currentPrice: number;
  percentChange: number;
  sp500Comparison: number;
  oneMonthChange: number;
  oneYearChange: number;
}

export interface PromptTemplate {
  prompt: string;
  variables: Record<string, any>;
}
