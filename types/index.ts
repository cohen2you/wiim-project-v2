import { ZodType, z } from 'zod';

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

// Fix: Make PromptTemplate generic on ZodType and infer input data type for prompt()
export interface PromptTemplate<
  InputSchema extends ZodType<any, any, any> = ZodType<any, any, any>
> {
  name: string;
  inputSchema: InputSchema;
  system: string;
  prompt: (input: z.infer<InputSchema>) => string; // Use inferred type here, NOT InputSchema itself
}
