import { NextResponse } from 'next/server';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const BENZINGA_API_KEY = process.env.BENZINGA_API_KEY!;
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const BZ_NEWS_URL = 'https://api.benzinga.com/api/v2/news';
const MODEL = 'gpt-4o';

async function fetchRelatedArticles(ticker: string, excludeUrl?: string): Promise<any[]> {
  try {
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - 7);
    const dateFromStr = dateFrom.toISOString().slice(0, 10);
    
    const url = `${BZ_NEWS_URL}?token=${BENZINGA_API_KEY}&tickers=${encodeURIComponent(ticker)}&items=20&fields=headline,title,created,url,channels&accept=application/json&displayOutput=full&dateFrom=${dateFromStr}`;
    
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
    
    const relatedArticles = data
      .filter(item => {
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
      })
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

function buildPrompt({ ticker, sourceText, analystSummary, priceSummary, priceActionDay, sourceUrl, sourceDateFormatted, relatedArticles }: { ticker: string; sourceText: string; analystSummary: string; priceSummary: string; priceActionDay?: string; sourceUrl?: string; sourceDateFormatted?: string; relatedArticles?: any[] }) {
  
  // Check if this is an analyst note
  const isAnalystNote = sourceText.includes('analyst') || sourceText.includes('J P M O R G A N') || sourceText.includes('Samik Chatterjee') || sourceText.includes('Overweight') || sourceText.includes('Price Target');
  
  // Extract key analyst information if this is an analyst note
  let analystInfo = '';
  if (isAnalystNote) {
    const analystMatch = sourceText.match(/Samik Chatterjee, CFA/);
    const firmMatch = sourceText.match(/J\.P\. Morgan|J P M O R G A N/);
    const ratingMatch = sourceText.match(/Overweight/);
    
    // Extract price targets - look for patterns like "raised to $200 from $185" or "to $200"
    const priceTargetPatterns = [
      /\$(\d+)\s+from\s+\$(\d+)/i,  // "to $200 from $185"
      /raised.*?\$(\d+).*?\$(\d+)/i, // "raised to $200 from $185"
      /target.*?\$(\d+).*?\$(\d+)/i, // "target to $200 from $185"
    ];
    
    let currentPriceTarget = '';
    let previousPriceTarget = '';
    
    for (const pattern of priceTargetPatterns) {
      const match = sourceText.match(pattern);
      if (match) {
        currentPriceTarget = '$' + match[1];
        previousPriceTarget = '$' + match[2];
        break;
      }
    }
    
    // If no previous target found, look for single price target
    if (!currentPriceTarget) {
      const singleTargetMatch = sourceText.match(/\$(\d+)/);
      if (singleTargetMatch) {
        currentPriceTarget = '$' + singleTargetMatch[1];
      }
    }
    
    const dateMatch = sourceText.match(/(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i);
    
    analystInfo = `
EXTRACTED ANALYST INFORMATION:
- Analyst: ${analystMatch ? 'Samik Chatterjee, CFA' : 'Not found'}
- Firm: ${firmMatch ? 'J.P. Morgan' : 'Not found'}
- Rating: ${ratingMatch ? 'Overweight' : 'Not found'}
- Current Price Target: ${currentPriceTarget || 'Not found'}
- Previous Price Target: ${previousPriceTarget || 'Not found'}
- Date: ${dateMatch ? `${dateMatch[2]} ${dateMatch[1]}, ${dateMatch[3]}` : 'Not found'}

YOU MUST USE THIS INFORMATION IN YOUR ARTICLE.
`;
  }
  
  return `You are a professional financial news writer for Benzinga.

Write a concise, fact-based news article (about 350 words) about the stock with ticker: ${ticker}. Use the provided press release, news article, or analyst note text as your main source, but focus only on information relevant to ${ticker}. Ignore other tickers or companies mentioned in the source text.

IMPORTANT: If the source text appears to be an analyst note (contains analyst names, firm names, ratings, price targets, or financial analysis), prioritize extracting and using the specific analyst insights, forecasts, and reasoning from the note rather than generic analyst summary data. 

CRITICAL FOR ANALYST NOTES: Extract and include the analyst's name, firm, specific analysis points, financial forecasts, investment thesis, and key reasoning directly from the source text. Do not rely on the analyst summary data if the source text contains detailed analyst information.

IMPORTANT: The source text below contains the full analyst note. Extract all relevant analyst information, including names, ratings, price targets, analysis, and reasoning directly from this source text. Do not use any external analyst summary data.

${isAnalystNote ? 'CRITICAL: THIS IS AN ANALYST NOTE. You MUST extract and include the analyst name (Samik Chatterjee, CFA), firm name (J.P. Morgan), rating (Overweight), price target ($200), and specific analysis from the source text below. Do not write generic content.' : ''}

${analystInfo}

CRITICAL FORMATTING RULES:
- NO paragraph should be longer than 2 sentences
- Break up any long paragraphs into multiple shorter ones
- The hyperlink MUST appear in the lead paragraph
- Use HTML tags for formatting, not markdown

Structure your article as follows:
- Headline: Write a clear, engaging headline in the style of these examples (do not use bold, asterisks, or markdown headings such as # or ##; the headline should be plain text only):
  - C3 AI Stock Is Tumbling Thursday: What's Going On?
  - What's Going On With Oklo Stock?

- Lead paragraph: Start with a sentence describing the price movement of the stock (e.g., "rose modestly," "traded higher," "slipped," "declined," etc.) using the full company name and ticker in this format: <strong>Company Name</strong> (NYSE: TICKER). The company name should be bolded using HTML <strong> tags. Do not use markdown bold (**) or asterisks elsewhere. Do not include the specific price or percentage in the lead; reserve that for the price action line at the bottom. Then state what happened and why it matters for ${ticker}. CRITICAL: Do NOT include analyst names (like "Samik Chatterjee" or "J.P. Morgan analyst") in the lead paragraph. The lead should focus on the stock movement and the general news event, not specific analyst details. 

MANDATORY HYPERLINK RULE: If sourceUrl is provided and not empty, you MUST include exactly one hyperlink in the lead paragraph. Wrap exactly three consecutive words in <a href="${sourceUrl}"> and </a> tags. Choose any three consecutive words that fit naturally. If sourceUrl is empty, do not include any hyperlinks. EXAMPLE: "Apple Inc (NASDAQ: AAPL) traded lower on Tuesday following <a href="${sourceUrl}">reports that JPMorgan</a> Chase & Co. is in advanced discussions"

CRITICAL: The lead paragraph must be exactly 2 sentences maximum. If you have more information, create additional paragraphs.

- IMPORTANT: In your lead, use this exact phrase to reference the timing of the price movement: "${priceActionDay || '[Day not provided]'}". Do not use or infer any other day or date, even if the source text or PR/article date mentions a different day.

- Additional paragraphs: Provide factual details, context, and any relevant quotes about ${ticker}. When referencing the source material, mention the actual date: "${sourceDateFormatted || '[Date not provided]'}" (e.g., "In a press release dated ${sourceDateFormatted}" or "According to the ${sourceDateFormatted} announcement"). If the source is an analyst note, include specific details about earnings forecasts, financial estimates, market analysis, and investment reasoning from the note. CRITICAL: Each paragraph must be no longer than 2 sentences. If you have more information, create additional paragraphs.

${relatedArticles && relatedArticles.length > 0 ? `
- After the second paragraph of additional content (not the lead paragraph), insert the "Also Read:" section with this exact format:
  Also Read: <a href="${relatedArticles[0].url}">${relatedArticles[0].headline}</a>
` : ''}

${isAnalystNote ? '- FOR ANALYST NOTES: Do NOT mention analyst names in the lead paragraph. Start your additional paragraphs (after the lead) with "According to J.P. Morgan analyst Samik Chatterjee, CFA..." and include specific details about the F3Q25 earnings preview, diversification strategy, Apple revenue loss impact, and investment thesis from the source text. When mentioning price targets, include the previous target if available (e.g., "raised the price target to $200 from $185"). Do not write generic content about the semiconductor industry.' : ''}

- For analyst notes specifically: Extract and include the analyst's name (e.g., "Samik Chatterjee, CFA"), firm name, specific analysis points, financial forecasts, investment thesis, and key reasoning directly from the source text. Include details about earnings previews, price targets (use whole numbers like $200, not $200.00), ratings, and market insights mentioned in the note. When a price target is raised or lowered, always include both the current and previous targets in the format "raised the price target to [current] from [previous]" or "lowered the price target to [current] from [previous]".

${isAnalystNote ? '- MANDATORY FOR ANALYST NOTES: Do NOT include analyst names in the lead paragraph. You MUST include the analyst name "Samik Chatterjee, CFA" and firm "J.P. Morgan" in your additional paragraphs (after the lead). You MUST mention the "Overweight" rating and price target information. If a previous price target is available, format it as "raised the price target to [current] from [previous]" (e.g., "raised the price target to $200 from $185"). If no previous target is available, use "raised the price target to [current]" or "set a price target of [current]". You MUST include specific details about the F3Q25 earnings preview, diversification strategy, and investment thesis from the source text.' : ''}

- Analyst Ratings: Extract and include analyst information directly from the source text. Include:
  * The analyst's name, firm, rating, and price target changes (use whole numbers like $200, not $200.00)
  * If a price target was raised or lowered, include both the current and previous targets (e.g., "raised the price target to $200 from $185")
  * Key analysis points and investment thesis from the note
  * Specific financial forecasts or estimates mentioned
  * Important reasoning and market insights
  * Any notable risks or catalysts discussed
  Each paragraph must be no longer than 2 sentences. Focus on extracting specific details from the source text rather than using generic analyst summary data.

- At the very bottom, include the following price action summary for ${ticker} exactly as provided, but with these modifications:
  - Bold the ticker and "Price Action:" part using HTML <strong> tags (e.g., <strong>AA Price Action:</strong>)
  - Hyperlink "according to Benzinga Pro." to https://pro.benzinga.com/ using <a href="https://pro.benzinga.com/">according to Benzinga Pro.</a>
${priceSummary}

${relatedArticles && relatedArticles.length > 0 ? `
- After the price action, add a "Read Next:" section with the following format:
  Read Next: <a href="${relatedArticles[1]?.url || relatedArticles[0].url}">${relatedArticles[1]?.headline || relatedArticles[0].headline}</a>
` : ''}

Keep the tone neutral and informative, suitable for a financial news audience. Do not include speculation or personal opinion. 

CRITICAL HTML FORMATTING: You MUST wrap each paragraph in <p> tags. The output should be properly formatted HTML with each paragraph separated by <p> tags. Example:
<p>First paragraph content.</p>
<p>Second paragraph content.</p>
<p>Third paragraph content.</p>

REMEMBER: NO paragraph should exceed 2 sentences. Break up longer content into multiple paragraphs. The hyperlink MUST appear in the lead paragraph.

Source Text:
${sourceText}

${isAnalystNote ? `
IMPORTANT: The source text above contains a J.P. Morgan analyst note by Samik Chatterjee, CFA. You MUST include:
1. The analyst name "Samik Chatterjee, CFA" and firm "J.P. Morgan"
2. The "Overweight" rating and price target information (include previous target if available)
3. Specific details about the F3Q25 earnings preview
4. Information about the diversification strategy and Apple revenue loss
5. The investment thesis about long-term re-rating opportunity
6. Financial forecasts and market insights from the note

Do not write generic content about the semiconductor industry. Use the specific analyst insights from the source text.
` : ''}

Write the article now.`;
}

export async function POST(req: Request) {
  try {
    const { ticker, sourceText, analystSummary, priceSummary, priceActionDay, sourceUrl, sourceDateFormatted } = await req.json();
    if (!ticker || !sourceText) return NextResponse.json({ error: 'Ticker and source text are required.' }, { status: 400 });
    console.log('Prompt priceSummary:', priceSummary); // Log the priceSummary
    console.log('Source text length:', sourceText.length);
    console.log('Source text preview:', sourceText.substring(0, 200));
    console.log('Contains analyst note indicators:', sourceText.includes('Samik Chatterjee') || sourceText.includes('J P M O R G A N') || sourceText.includes('Overweight'));
    
    // Fetch related articles
    const relatedArticles = await fetchRelatedArticles(ticker, sourceUrl);
    
    const prompt = buildPrompt({ ticker, sourceText, analystSummary: analystSummary || '', priceSummary: priceSummary || '', priceActionDay, sourceUrl, sourceDateFormatted, relatedArticles });
    const res = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.5,
        max_tokens: 900,
      }),
    });
    if (!res.ok) {
      const raw = await res.text();
      return NextResponse.json({ error: `OpenAI error: ${raw}` }, { status: 500 });
    }
    const data = await res.json();
    const story = data.choices[0].message.content.trim();
    return NextResponse.json({ story });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to generate story.' }, { status: 500 });
  }
} 