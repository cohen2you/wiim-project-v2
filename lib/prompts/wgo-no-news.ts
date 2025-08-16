export const getWGONoNewsPrompt = ({
  ticker,
  stockData,
}: {
  ticker: string;
  stockData: any;
}) => `
You are a financial journalist creating a WGO No News story for ${ticker}. This story should cover trending stocks, focusing on technical analysis, analyst sentiment, and key data points.

STOCK DATA:
${JSON.stringify(stockData, null, 2)}

STORY REQUIREMENTS:

1. HEADLINE: Use format "[Company] Stock Is Trending [Day]: What's Going On?" or "[Company] Stock Launches To New All-Time Highs: What's Going On?" for new highs

2. ARTICLE STRUCTURE:
- Opening paragraph: Compelling hook that draws readers in + engaging narrative about what's driving the stock
- "What To Know" section: Key data points (growth rankings, revenue metrics)
- Recent events/partnerships/announcements
- Analyst commentary and price target updates
- Price action section with technical details

3. CONTENT GUIDELINES:
- Focus on what's driving the momentum
- Include technical indicators (RSI, moving averages, support/resistance)
- Mention analyst ratings and price targets
- Include volume analysis and short interest if relevant
- Reference upcoming catalysts (earnings, events, etc.)
- Use professional but accessible tone
- Avoid flowery language like "amidst," "amid," "whilst," etc.
- Avoid phrases like "In summary," "To summarize," "In conclusion," etc.
- Avoid phrases like "despite the absence of," "in the absence of," "without specific news catalysts," etc.
- Keep paragraphs short and impactful
- Include current session price movement
- LEAD PARAGRAPH REQUIREMENTS:
  * Start with a compelling hook that makes readers want to continue
  * Avoid robotic language like "is experiencing notable volatility" or "recently trading down"
  * Use engaging, human language that tells a story
  * Focus on the narrative - what's happening and why it matters
  * Include the stock movement naturally within the story, not as a dry report
  * Make it sound like a real journalist wrote it, not an AI

4. DATA INTEGRATION:
- Include revenue growth metrics when available
- Reference analyst ratings and price targets
- Include technical price levels and YTD performance
- Mention social media/event mentions if relevant

5. TONE: Professional but accessible, focus on "what's driving the momentum"

Generate a complete WGO No News story following this structure.`; 