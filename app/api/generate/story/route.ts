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
    
    console.log('Fetching related articles for ticker:', ticker);
    console.log('Benzinga API URL:', url);
    console.log('BENZINGA_API_KEY available:', !!BENZINGA_API_KEY);
    console.log('BENZINGA_API_KEY length:', BENZINGA_API_KEY ? BENZINGA_API_KEY.length : 0);
    
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    
    if (!res.ok) {
      const errorText = await res.text();
      console.error('Benzinga API error:', errorText);
      console.error('Benzinga API status:', res.status);
      console.error('Benzinga API headers:', Object.fromEntries(res.headers.entries()));
      return [];
    }
    
    const data = await res.json();
    console.log('Benzinga API response:', data);
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
          console.log('Filtering out press release:', item.headline || item.title);
          return false;
        }
        
        // Exclude insights URLs
        if (item.url && item.url.includes('/insights/')) {
          console.log('Filtering out insights URL:', item.headline || item.title);
          return false;
        }
        
        // Exclude the current article URL if provided
        if (excludeUrl && item.url === excludeUrl) {
          console.log('Filtering out current article URL:', item.headline || item.title);
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
    
    console.log('Filtered related articles:', relatedArticles);
    
    // If no related articles found, create a fallback
    if (relatedArticles.length === 0) {
      console.log('No related articles found, using fallback');
      relatedArticles.push({
        headline: 'Market Analysis',
        url: 'https://www.benzinga.com/markets',
        created: new Date().toISOString()
      });
    }
    
    // Ensure we always have at least one article for hyperlinking
    console.log('Final related articles for hyperlinking:', relatedArticles);
    
    return relatedArticles;
  } catch (error) {
    console.error('Error fetching related articles:', error);
    console.error('BENZINGA_API_KEY available:', !!BENZINGA_API_KEY);
    return [];
  }
}

function buildPrompt({ ticker, sourceText, analystSummary, priceSummary, priceActionDay, sourceUrl, sourceDateFormatted, relatedArticles, includeCTA, ctaText, includeSubheads, subheadTexts }: { ticker: string; sourceText: string; analystSummary: string; priceSummary: string; priceActionDay?: string; sourceUrl?: string; sourceDateFormatted?: string; relatedArticles?: any[]; includeCTA?: boolean; ctaText?: string; includeSubheads?: boolean; subheadTexts?: string[] }) {
  
  // Check if this is an analyst note - look for common patterns
  const isAnalystNote = 
    (sourceText.match(/analyst.*note|analyst.*report|analyst.*research/i) && 
     (sourceText.match(/price target|rating|overweight|buy|hold|sell|underweight/i))) ||
    (sourceText.match(/[A-Z][a-z]+ [A-Z][a-z]+.*(?:CFA|analyst)/) && 
     sourceText.match(/(?:J\.P\. Morgan|JPMorgan|JP Morgan|Morgan Stanley|Goldman Sachs|Bank of America|Wells Fargo|Citigroup|Barclays|Deutsche Bank|UBS|Credit Suisse)/i) &&
     sourceText.match(/(?:price target|rating|overweight|buy|hold|sell|underweight)/i));
  
  // Extract key analyst information if this is an analyst note
  let analystInfo = '';
  if (isAnalystNote) {
    // Try to extract analyst name - look for patterns like "Name, Title" or "Name from Firm"
    let analystName = '';
    const analystPatterns = [
      /([A-Z][a-z]+ [A-Z][a-z]+),?\s*(?:CFA|analyst|Analyst)/,  // "Samik Chatterjee, CFA" or "John Smith, analyst"
      /([A-Z][a-z]+ [A-Z][a-z]+)\s+from\s+[A-Z]/,  // "John Smith from JPMorgan"
      /analyst\s+([A-Z][a-z]+ [A-Z][a-z]+)/i,  // "analyst John Smith"
    ];
    
    for (const pattern of analystPatterns) {
      const match = sourceText.match(pattern);
      if (match && match[1]) {
        analystName = match[1];
        break;
      }
    }
    
    // Fallback to specific known analyst if pattern matching fails
    if (!analystName && sourceText.includes('Samik Chatterjee')) {
      analystName = 'Samik Chatterjee';
    }
    
    const firmMatch = sourceText.match(/J\.P\. Morgan|J P M O R G A N|JPMorgan|JP Morgan/i);
    const ratingMatch = sourceText.match(/(Overweight|Buy|Hold|Sell|Underweight|Neutral|Positive|Negative)/i);
    
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
- Firm: ${firmMatch ? firmMatch[0] : 'Not found'}
- Analyst: ${analystName || 'Not found'}
- Rating: ${ratingMatch ? ratingMatch[1] : 'Not found'}
- Current Price Target: ${currentPriceTarget || 'Not found'}
- Previous Price Target: ${previousPriceTarget || 'Not found'}
- Date: ${dateMatch ? `${dateMatch[2]} ${dateMatch[1]}, ${dateMatch[3]}` : 'Not found'}

YOU MUST USE THIS INFORMATION IN YOUR ARTICLE. Include both firm name and analyst name when available.
`;
  }
  
     return `You are a professional financial news writer for Benzinga.

Write a concise, fact-based news article (about 350 words) about the stock with ticker: ${ticker}. Use the provided press release, news article, or analyst note text as your main source, but focus only on information relevant to ${ticker}. Ignore other tickers or companies mentioned in the source text.

${isAnalystNote ? `
CRITICAL: THIS IS AN ANALYST NOTE. You MUST create a narrative-driven article with a compelling investment thesis story. The article should flow like a story, not a list of facts.

NARRATIVE STRUCTURE FOR ANALYST NOTES:
1. Opening: Start with a bold, thematic statement that captures the investment thesis (similar to "Amazon's investment case heading into 2026 is no longer about e-commerce dominance"). This should set up the main narrative arc. Include the firm name and analyst name when available, along with key data points (rating, price target) woven naturally into the narrative.

2. Thematic Subheads: Organize content into 2-4 thematic subheads that tell a story (e.g., "AWS Re-Acceleration", "AI Beyond The Cloud", "Margin Expansion Back In Focus"). Each subhead should represent a major theme or pillar of the investment thesis.

3. Narrative Flow: Write in a conversational, story-driven style. Each section should build on the previous one, creating a cohesive narrative arc. Use transitions that connect ideas naturally. Paragraphs can be longer (3-4 sentences) when needed to maintain narrative flow, but keep them focused and readable.

4. Data Integration: Weave in key data points (ratings, price targets, financial forecasts) naturally within the narrative. Don't just list them - integrate them into the story. Always include both firm name and analyst name when available (e.g., "JPMorgan's Samik Chatterjee says..." or "According to JPMorgan analyst Samik Chatterjee...").

5. Closing: End with a strong, memorable closing line that ties back to the opening thesis (e.g., "Retail built Amazon. AI and margin discipline may define its next decade.").

TONE: Write with authority and insight, like you're explaining a compelling investment story to a sophisticated reader. Be conversational but professional. Use active voice. Make it engaging and readable.
` : ''}

${analystInfo}

CRITICAL FORMATTING RULES:
${isAnalystNote ? `- For ANALYST NOTES: Paragraphs can be 3-4 sentences when needed to maintain narrative flow, but keep them focused and readable
- Use thematic subheads to organize content (format as standalone lines with proper spacing)
- The hyperlink MUST appear in the lead paragraph
- Use HTML tags for formatting, not markdown` : `- NO paragraph should be longer than 2 sentences
- Break up any long paragraphs into multiple shorter ones
- The hyperlink MUST appear in the lead paragraph
- Use HTML tags for formatting, not markdown`}

Structure your article as follows:
- Headline: Write a clear, engaging headline in the style of these examples (do not use bold, asterisks, or markdown headings such as # or ##; the headline should be plain text only):
  - C3 AI Stock Is Tumbling Thursday: What's Going On?
  - What's Going On With Oklo Stock?

- Lead paragraph: ${isAnalystNote ? `For ANALYST NOTES: Start with a bold, thematic opening that captures the investment thesis (e.g., "Amazon's investment case heading into 2026 is no longer about e-commerce dominance. JPMorgan says the real upside sits in AWS acceleration, AI-led share gains, and a margin story that's finally beginning to show discipline."). Include the firm name and analyst name when available, along with key data points (rating, price target) woven naturally. Use the full company name and ticker in this format: <strong>Company Name</strong> (NYSE: TICKER). The company name should be bolded using HTML <strong> tags. Do not use markdown bold (**) or asterisks elsewhere. The lead should set up the narrative arc, not just state price movement. IMPORTANT: Do NOT use the word "today" in the lead paragraph. Use the exact time reference provided in priceActionDay if relevant.` : `Start with a sentence describing the ACTUAL price movement of the stock based on the price data provided. Use the exact movement from the price summary (e.g., if price summary shows "down 1.61%", say "traded lower" or "declined"; if it shows "up 2.5%", say "rose" or "traded higher"). Use the full company name and ticker in this format: <strong>Company Name</strong> (NYSE: TICKER). The company name should be bolded using HTML <strong> tags. Do not use markdown bold (**) or asterisks elsewhere. Do not include the specific price or percentage in the lead; reserve that for the price action line at the bottom. Then state what happened and why it matters for ${ticker}. IMPORTANT: Do NOT use the word "today" in the lead paragraph. Use the exact time reference provided in priceActionDay. CRITICAL: The lead MUST mention the actual price movement (up, down, unchanged) but NOT the specific percentage - reserve the percentage for the price action line at the bottom.`} 

CRITICAL HYPERLINK REQUIREMENT: You MUST include exactly one hyperlink in the lead paragraph. ${relatedArticles && relatedArticles.length > 0 ? `Use this specific article: "${relatedArticles[0].headline}" at URL: ${relatedArticles[0].url}. Choose any three consecutive words from your lead paragraph and wrap them in <a href="${relatedArticles[0].url}"> and </a> tags. EXAMPLE: "Apple Inc (NASDAQ: AAPL) traded lower ${priceActionDay || 'this morning'} following <a href="${relatedArticles[0].url}">reports that JPMorgan</a> Chase & Co. is in advanced discussions"` : 'If no related articles are available, choose any three consecutive words and link to a Benzinga topic page using <a href="https://www.benzinga.com/markets"> and </a> tags.'} The hyperlink CANNOT link to the source URL. THIS IS MANDATORY - YOUR LEAD PARAGRAPH MUST CONTAIN ONE HYPERLINK. DO NOT FORGET TO INCLUDE THE HYPERLINK IN THE LEAD PARAGRAPH.

CRITICAL: The lead paragraph must be exactly 2 sentences maximum. If you have more information, create additional paragraphs.

EXAMPLE LEAD PARAGRAPH FORMAT:
<p><strong>Apple Inc.</strong> (NASDAQ: AAPL) traded lower ${priceActionDay || 'this morning'} following <a href="${relatedArticles && relatedArticles.length > 0 ? relatedArticles[0].url : 'https://www.benzinga.com/markets'}">reports that JPMorgan</a> Chase & Co. is in advanced discussions. The stock's decline comes amid broader market volatility and concerns about the tech sector's performance.</p>

- IMPORTANT: In your lead, use this exact phrase to reference the timing of the price movement: "${priceActionDay || '[Day not provided]'}". Do not use or infer any other day or date, even if the source text or PR/article date mentions a different day. DO NOT use the word "today" - use the exact time reference provided in priceActionDay.

- Additional paragraphs: ${isAnalystNote ? `For ANALYST NOTES: Build a narrative story with thematic sections. Organize content into 2-4 thematic subheads that tell a cohesive story (e.g., "AWS Re-Acceleration", "AI Beyond The Cloud", "Margin Expansion Back In Focus"). Each section should build on the previous one. Paragraphs can be 3-4 sentences when needed to maintain narrative flow, but keep them focused. Weave in key data points (ratings, price targets, financial forecasts) naturally within the narrative. Always include both firm name and analyst name when available. Use transitions that connect ideas naturally. End with a strong closing line that ties back to the opening thesis.` : `Provide factual details, context, and any relevant quotes about ${ticker}. When referencing the source material, mention the actual date: "${sourceDateFormatted || '[Date not provided]'}" (e.g., "In a press release dated ${sourceDateFormatted}" or "According to the ${sourceDateFormatted} announcement"). CRITICAL: Each paragraph must be no longer than 2 sentences. If you have more information, create additional paragraphs.`}

SOURCE URL HYPERLINK: If sourceUrl is provided, the first sentence of the additional content (after the lead paragraph) must include a three-word anchor linking to the source URL. Use the format "according to <a href="${sourceUrl}">Benzinga</a>" or similar attribution. EXAMPLE: "According to <a href="${sourceUrl}">Benzinga Pro</a>, the company announced..."

${includeCTA && ctaText ? `
- CTA Integration: After the lead paragraph, insert the following CTA exactly as provided:
  ${ctaText}
` : ''}

${includeSubheads && subheadTexts && subheadTexts.length > 0 ? `
- Subhead Integration: Insert the following subheads at strategic points throughout the article (after approximately 20%, 50%, and 80% of the content):
  ${subheadTexts.map((subhead, index) => `${index + 1}. ${subhead}`).join('\n  ')}
  
  Format each subhead as a standalone line with proper spacing before and after.
` : isAnalystNote ? `
- Thematic Subheads: Create 2-4 thematic subheads that organize the narrative (e.g., "AWS Re-Acceleration", "AI Beyond The Cloud", "Margin Expansion Back In Focus"). Each subhead should represent a major theme or pillar of the investment thesis. Format each subhead as a standalone line with proper spacing before and after. Do not use HTML heading tags - just plain text with spacing.
` : ''}

${relatedArticles && relatedArticles.length > 1 ? `
- After the second paragraph of additional content (not the lead paragraph), insert the "Also Read:" section with this exact format:
  Also Read: <a href="${relatedArticles[1].url}">${relatedArticles[1].headline}</a>
` : ''}

${isAnalystNote ? `
- FOR ANALYST NOTES - NARRATIVE REQUIREMENTS:
  * Include both firm name AND analyst name when available (e.g., "JPMorgan's Samik Chatterjee says..." or "According to JPMorgan analyst Samik Chatterjee...")
  * Organize content into 2-4 thematic subheads that tell a cohesive story
  * Each thematic section should build on the previous one, creating a narrative arc
  * Weave in key data points naturally: rating, price targets (use whole numbers like $200, not $200.00), financial forecasts
  * When a price target was raised or lowered, include both current and previous: "raised the price target to [current] from [previous]" (e.g., "raised the price target to $200 from $185")
  * Include specific analysis points, investment thesis, and key reasoning from the source text
  * Use transitions that connect ideas naturally ("That shift...", "Importantly...", "Despite...")
  * End with a strong closing line that ties back to the opening thesis
  * Paragraphs can be 3-4 sentences when needed for narrative flow, but keep them focused
` : `
- Analyst Ratings (for non-analyst-note articles): Extract and include analyst information directly from the source text. Include:
  * Firm name and analyst name when available
  * Rating and price target changes (use whole numbers like $200, not $200.00)
  * If a price target was raised or lowered, include both the current and previous targets (e.g., "raised the price target to $200 from $185")
  * Key analysis points and investment thesis from the note
  * Specific financial forecasts or estimates mentioned
  * Important reasoning and market insights
  * Any notable risks or catalysts discussed
  Each paragraph must be no longer than 2 sentences. Focus on extracting specific details from the source text rather than using generic analyst summary data.
`}

- At the very bottom, include the following price action summary for ${ticker} exactly as provided, but with these modifications:
  - Bold the ticker and "Price Action:" part using HTML <strong> tags (e.g., <strong>AA Price Action:</strong>)
  - Hyperlink "according to Benzinga Pro." to https://pro.benzinga.com/ using <a href="https://pro.benzinga.com/">according to Benzinga Pro.</a>
${priceSummary}

${relatedArticles && relatedArticles.length > 2 ? `
- After the price action, add a "Read Next:" section with the following format:
  Read Next: <a href="${relatedArticles[2].url}">${relatedArticles[2].headline}</a>
` : ''}

Keep the tone neutral and informative, suitable for a financial news audience. Do not include speculation or personal opinion. 

CRITICAL HTML FORMATTING: You MUST wrap each paragraph in <p> tags. The output should be properly formatted HTML with each paragraph separated by <p> tags. Example:
<p>First paragraph content.</p>
<p>Second paragraph content.</p>
<p>Third paragraph content.</p>

${isAnalystNote ? `REMEMBER: For ANALYST NOTES, create a narrative-driven story with thematic subheads. Paragraphs can be 3-4 sentences when needed for narrative flow. Include both firm name and analyst name. End with a strong closing line. THE HYPERLINK MUST APPEAR IN THE LEAD PARAGRAPH - THIS IS MANDATORY.` : `REMEMBER: NO paragraph should exceed 2 sentences. Break up longer content into multiple paragraphs. THE HYPERLINK MUST APPEAR IN THE LEAD PARAGRAPH - THIS IS MANDATORY.`}

Source Text:
${sourceText}

${isAnalystNote ? `
IMPORTANT: The source text above contains an analyst note. You MUST create a narrative-driven article that:

1. Opens with a bold, thematic statement capturing the investment thesis
2. Includes both firm name AND analyst name when available (e.g., "JPMorgan's Samik Chatterjee says..." or "According to JPMorgan analyst Samik Chatterjee...")
3. Organizes content into 2-4 thematic subheads that tell a cohesive story
4. Weaves in key data points naturally: rating, price targets (include previous target if available), financial forecasts
5. Builds a narrative arc where each section connects to the next
6. Includes specific analysis points, investment thesis, and key reasoning from the source text
7. Ends with a strong closing line that ties back to the opening thesis
8. Uses conversational, story-driven language while remaining factual and professional

CRITICAL: Write like you're telling a compelling investment story, not listing facts. Make it engaging and readable while maintaining accuracy.
` : ''}

FINAL REMINDER: Your lead paragraph MUST contain exactly one hyperlink. The hyperlink must be in the lead paragraph, not in any other section.

Write the article now.`;
}

export async function POST(req: Request) {
  try {
    const { ticker, sourceText, analystSummary, priceSummary, priceActionDay, sourceUrl, sourceDateFormatted, includeCTA, ctaText, includeSubheads, subheadTexts } = await req.json();
    if (!sourceText) return NextResponse.json({ error: 'Source text is required.' }, { status: 400 });
    if (!ticker) return NextResponse.json({ error: 'Ticker is required.' }, { status: 400 });
    console.log('Prompt priceSummary:', priceSummary); // Log the priceSummary
    console.log('Source text length:', sourceText.length);
    console.log('Source text preview:', sourceText.substring(0, 200));
    console.log('Is analyst note:', (sourceText.includes('Samik Chatterjee') && sourceText.includes('J P M O R G A N')) || 
                                   (sourceText.includes('analyst') && sourceText.includes('J.P. Morgan') && sourceText.includes('Overweight')));
    
    // Fetch related articles
    const relatedArticles = await fetchRelatedArticles(ticker, sourceUrl);
    console.log('Related articles fetched:', relatedArticles);
    console.log('Number of related articles:', relatedArticles.length);
    if (relatedArticles.length > 0) {
      console.log('First related article:', relatedArticles[0]);
    }
    
    const prompt = buildPrompt({ ticker, sourceText, analystSummary: analystSummary || '', priceSummary: priceSummary || '', priceActionDay, sourceUrl, sourceDateFormatted, relatedArticles, includeCTA, ctaText, includeSubheads, subheadTexts });
    console.log('Prompt includes related articles:', relatedArticles.length > 0);
    if (relatedArticles.length > 0) {
      console.log('Prompt will use article:', relatedArticles[0].headline);
    }
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