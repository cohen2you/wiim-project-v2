import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { ticker, scrapedContent, scrapedUrl } = await req.json();

    if (!ticker || !scrapedContent) {
      return NextResponse.json({ error: 'Ticker and scraped content are required' }, { status: 400 });
    }

    // Get company name and exchange info
    const companyNames: { [key: string]: string } = {
      'NVDA': 'Nvidia Corp.',
      'META': 'Meta Platforms Inc.',
      'AAPL': 'Apple Inc.',
      'MSFT': 'Microsoft Corp.',
      'GOOGL': 'Alphabet Inc.',
      'AMZN': 'Amazon.com Inc.',
      'TSLA': 'Tesla Inc.',
      'NFLX': 'Netflix Inc.',
      'AMD': 'Advanced Micro Devices Inc.',
      'INTC': 'Intel Corp.'
    };
    
    const companyName = companyNames[ticker.toUpperCase()] || ticker.toUpperCase();
    const companyNameFormatted = `${companyName} (NASDAQ: ${ticker.toUpperCase()})`;
    
    // Get current day
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const today = new Date();
    const currentDay = today.getDay();
    const tradingDay = days[currentDay];

    // Clean the scraped content to extract only the relevant article text
    let cleanContent = scrapedContent;
    
    // Remove all the navigation and website structure
    const patternsToRemove = [
      /Benzinga.*?Login/gs,
      /Register.*?Services/gs,
      /News.*?Crypto/gs,
      /Research.*?Tools/gs,
      /Free.*?Portfolio/gs,
      /Calculators.*?Screeners/gs,
      /Stock.*?Recent/gs,
      /Markets.*?read/gs,
      /by.*?Follow/gs,
      /Zinger.*?Points/gs,
      /Get more.*?opportunity\./gs,
      /Add Comment.*?Score/gs,
      /Locked.*?Score/gs,
      /Benzinga.*?Score/gs,
      /Edge.*?Overview/gs,
      /Momentum.*?Overview/gs,
      /Also Read.*?Momentum/gs,
      /Big Money.*?$/gs,
      /España.*?Français/gs,
      /My Account.*?Login/gs,
      /Get Benzinga.*?Events/gs,
      /Premarket.*?Contribute/gs,
      /Our Services.*?Crypto/gs,
      /Earnings.*?Crypto/gs,
      /M&A.*?Crypto/gs,
      /Buybacks.*?Crypto/gs,
      /Legal.*?Crypto/gs,
      /Interviews.*?Crypto/gs,
      /Management.*?Crypto/gs,
      /Offerings.*?Crypto/gs,
      /IPOs.*?Crypto/gs,
      /Insider.*?Crypto/gs,
      /Biotech.*?Crypto/gs,
      /FDA.*?Crypto/gs,
      /Politics.*?Crypto/gs,
      /Healthcare.*?Crypto/gs,
      /Pre-Market.*?Crypto/gs,
      /After Hours.*?Crypto/gs,
      /Movers.*?Crypto/gs,
      /ETFs.*?Crypto/gs,
      /Forex.*?Crypto/gs,
      /Commodities.*?Crypto/gs,
      /Binary.*?Crypto/gs,
      /Options.*?Crypto/gs,
      /Bonds.*?Crypto/gs,
      /Futures.*?Crypto/gs,
      /CME.*?Crypto/gs,
      /Global.*?Crypto/gs,
      /Economics.*?Crypto/gs,
      /Mining.*?Crypto/gs,
      /Previews.*?Crypto/gs,
      /Small-Cap.*?Crypto/gs,
      /Real Estate.*?Crypto/gs,
      /Penny.*?Crypto/gs,
      /Digital.*?Crypto/gs,
      /Securities.*?Crypto/gs,
      /Volatility.*?Crypto/gs,
      /From The Press.*?Crypto/gs,
      /Jim Cramer.*?Crypto/gs,
      /Rumors.*?Crypto/gs,
      /Whisper.*?Crypto/gs,
      /Index.*?Crypto/gs,
      /Stock of the Day.*?Crypto/gs,
      /Best Stocks.*?Crypto/gs,
      /Best Penny.*?Crypto/gs,
      /Best S&P.*?Crypto/gs,
      /Best Swing.*?Crypto/gs,
      /Best Blue.*?Crypto/gs,
      /Best High-Volume.*?Crypto/gs,
      /Best Small.*?Crypto/gs,
      /Best Stocks to Day.*?Crypto/gs,
      /Best REITs.*?Crypto/gs,
      /Money.*?Crypto/gs,
      /Investing.*?Crypto/gs,
      /Cryptocurrency.*?Crypto/gs,
      /Mortgage.*?Crypto/gs,
      /Insurance.*?Crypto/gs,
      /Yield.*?Crypto/gs,
      /Personal.*?Crypto/gs,
      /Finance.*?Crypto/gs,
      /Startup.*?Crypto/gs,
      /Real Estate Investing.*?Crypto/gs,
      /Prop Trading.*?Crypto/gs,
      /Credit.*?Crypto/gs,
      /Cards.*?Crypto/gs,
      /Stock Brokers.*?Crypto/gs,
      /Research.*?Crypto/gs,
      /My Stocks.*?Crypto/gs,
      /Tools.*?Crypto/gs,
      /Free Benzinga.*?Crypto/gs,
      /Calendars.*?Crypto/gs,
      /Analyst Ratings.*?Crypto/gs,
      /Conference.*?Crypto/gs,
      /Dividend.*?Crypto/gs,
      /Economic.*?Crypto/gs,
      /Guidance.*?Crypto/gs,
      /IPO.*?Crypto/gs,
      /SPAC.*?Crypto/gs,
      /Stock Split.*?Crypto/gs,
      /Trade Ideas.*?Crypto/gs,
      /Free Stock.*?Crypto/gs,
      /Insider Trades.*?Crypto/gs,
      /Trade Idea.*?Crypto/gs,
      /Analyst Ratings.*?Crypto/gs,
      /Unusual Options.*?Crypto/gs,
      /Heatmaps.*?Crypto/gs,
      /Free Newsletter.*?Crypto/gs,
      /Government.*?Crypto/gs,
      /Perfect Stock.*?Crypto/gs,
      /Easy Income.*?Crypto/gs,
      /Short Interest.*?Crypto/gs,
      /Most Shorted.*?Crypto/gs,
      /Largest Increase.*?Crypto/gs,
      /Largest Decrease.*?Crypto/gs,
      /Calculators.*?Crypto/gs,
      /Margin.*?Crypto/gs,
      /Forex Profit.*?Crypto/gs,
      /100x Options.*?Crypto/gs,
      /Screeners.*?Crypto/gs,
      /Stock Screener.*?Crypto/gs,
      /Top Momentum.*?Crypto/gs,
      /Top Quality.*?Crypto/gs,
      /Top Value.*?Crypto/gs,
      /Top Growth.*?Crypto/gs,
      /Recent.*?Crypto/gs,
      /August.*?read/gs,
      /Chandrima.*?Follow/gs,
      /Key Points.*?opportunity\./gs,
      /Add Comment.*?Score/gs,
      /Locked.*?Score/gs,
      /Benzinga Rankings.*?Score/gs,
      /Reveal Full.*?Score/gs,
      /Edge Rankings.*?Overview/gs,
      /Momentum.*?Overview/gs,
      /Price Trend.*?Overview/gs,
      /Short.*?Overview/gs,
      /Medium.*?Overview/gs,
      /Long.*?Overview/gs,
      /Overview.*?Overview/gs,
      /Also Read.*?Momentum/gs,
      /Big Money.*?$/gs
    ];
    
    // Apply all removal patterns
    patternsToRemove.forEach(pattern => {
      cleanContent = cleanContent.replace(pattern, '');
    });
    
    // Clean up whitespace and formatting
    cleanContent = cleanContent
      .replace(/\\n+/g, ' ') // Replace multiple newlines with spaces
      .replace(/\\s+/g, ' ') // Replace multiple spaces with single space
      .replace(/\\s+/g, ' ') // Replace multiple spaces with single space
      .trim();
    
    // If the content is still too long or contains too much navigation, extract just the main article
    if (cleanContent.length > 1000 || cleanContent.includes('Benzinga')) {
      // Try to find the main article content
      const articleMatch = cleanContent.match(/(World index provider|MSCI|The revisions|The three largest|On the side of emerging markets).*?(?=Also Read|Big Money|$)/s);
      if (articleMatch) {
        cleanContent = articleMatch[0];
      }
    }
    
    // Debug logging
    console.log('Original content length:', scrapedContent.length);
    console.log('Cleaned content length:', cleanContent.length);
    console.log('Cleaned content preview:', cleanContent.substring(0, 200) + '...');

    // Determine source type and hyperlink instructions
    let hyperlinkInstructions = '';
    if (scrapedUrl) {
      const isBenzinga = scrapedUrl.includes('benzinga.com') || scrapedUrl.includes('benzinga');
      if (isBenzinga) {
        hyperlinkInstructions = `- HYPERLINK: In the second paragraph, naturally hyperlink relevant text to the source URL. Do NOT mention "Benzinga" - just hyperlink existing text naturally. Format as: <a href="${scrapedUrl}" target="_blank">[relevant text]</a>`;
             } else {
         // Extract domain for other sources
         const urlObj = new URL(scrapedUrl);
         const domain = urlObj.hostname.replace('www.', '');
         const sourceName = domain.split('.')[0].toUpperCase();
         hyperlinkInstructions = `- HYPERLINK: In the second paragraph, include "According to ${sourceName}" with "According" hyperlinked to the source URL. Format as: <a href="${scrapedUrl}" target="_blank">According</a> to ${sourceName}`;
       }
    }

    const prompt = `You are a financial journalist creating a news story about ${ticker}. 

IMPORTANT: You must create a NEW, ORIGINAL story based on the information provided. DO NOT return the raw scraped content or copy it directly.

Based on the following cleaned article content, create a complete news story with the EXACT structure:

1. HEADLINE: Format as "[Company] Stock Is Trending ${tradingDay}: What's Going On?" (no quotes, no bold formatting)
2. LEAD PARAGRAPH: ${companyNameFormatted} + movement + time context + day of the week (exactly 2 sentences)
3. MAIN CONTENT: 2-3 paragraphs incorporating the key information from the article (2 sentences max per paragraph)

Article Content:
${cleanContent}

REQUIRED FORMAT:
- Headline: [Company] Stock Is Trending ${tradingDay}: What's Going On?
- Lead: Use exact format "${companyNameFormatted}" + general movement + ${tradingDay}
- Content: Professional financial journalism style
- Paragraphs: Separate with double line breaks (\\n\\n)
- No quotes around any content
- No bold formatting
- Keep paragraphs to 2 sentences maximum
- Focus on the key news and financial implications
- Do NOT include any website navigation, menus, or promotional content
- DO NOT copy the original text - write a new story based on the information
${hyperlinkInstructions}

Generate the complete story with this exact structure:`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
             messages: [
         {
           role: "system",
           content: "You are a professional financial journalist writing for a financial news website. You must create properly structured news stories with headlines, lead paragraphs, and main content. Never return raw scraped content - always create a new, well-formatted story based on the information provided."
         },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 1500,
    });

    const story = completion.choices[0]?.message?.content?.trim();

    if (!story) {
      return NextResponse.json({ error: 'Failed to generate story' }, { status: 500 });
    }

    return NextResponse.json({ story });
  } catch (error: any) {
    console.error('Error generating base story:', error);
    return NextResponse.json({ error: 'Failed to generate base story' }, { status: 500 });
  }
}
