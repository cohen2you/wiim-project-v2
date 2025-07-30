import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const BENZINGA_API_KEY = process.env.BENZINGA_API_KEY!;
const BZ_NEWS_URL = 'https://api.benzinga.com/api/v2/news';

async function fetchRecentArticle(ticker: string, excludeUrl?: string): Promise<any | null> {
  try {
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - 7);
    const dateFromStr = dateFrom.toISOString().slice(0, 10);
    
    const url = `${BZ_NEWS_URL}?token=${BENZINGA_API_KEY}&tickers=${encodeURIComponent(ticker)}&items=10&fields=headline,title,created,body,url,channels&accept=application/json&displayOutput=full&dateFrom=${dateFromStr}`;
    
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    
    if (!res.ok) {
      console.error('Benzinga API error:', await res.text());
      return null;
    }
    
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    
    // Filter out press releases and the current article URL
    const prChannelNames = ['press releases', 'press-releases', 'pressrelease', 'pr'];
    const normalize = (str: string) => str.toLowerCase().replace(/[-_]/g, ' ');
    
    const recentArticles = data
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
        body: item.body || '',
        url: item.url,
        created: item.created,
      }))
      .filter(item => item.body && item.body.length > 100); // Ensure there's substantial content
    
    return recentArticles.length > 0 ? recentArticles[0] : null;
  } catch (error) {
    console.error('Error fetching recent article:', error);
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const { ticker, currentArticle } = await request.json();
    
    if (!ticker || !currentArticle) {
      return NextResponse.json({ error: 'Ticker and current article are required.' }, { status: 400 });
    }

    // Fetch a recent article for context
    const recentArticle = await fetchRecentArticle(ticker);
    
    if (!recentArticle) {
      return NextResponse.json({ error: 'No recent articles found for context.' }, { status: 404 });
    }

    // Generate condensed context using OpenAI
    const prompt = `
You are a financial journalist. Given the current article and a recent news article about the same ticker, create 2 very concise paragraphs that add relevant context to the current article.

Current Article:
${currentArticle}

Recent News Article:
Headline: ${recentArticle.headline}
Content: ${recentArticle.body}

Requirements:
1. Create exactly 2 paragraphs that provide additional context
2. Make the content relevant to the current article's topic
3. Keep each paragraph to EXACTLY 2 sentences maximum - no more, no less
4. You MUST include exactly one hyperlink ONLY in the FIRST paragraph using this exact format: <a href="${recentArticle.url}">[three word phrase]</a>
5. The SECOND paragraph should have NO hyperlinks
6. Make the content flow naturally with the current article
7. Focus on providing valuable context that enhances the reader's understanding
8. Use AP style and maintain a professional tone
9. Keep paragraphs short and impactful - aim for 1-2 sentences each
10. The hyperlink should be embedded within existing words in the text, not as "[source]" at the end
11. Choose relevant three-word phrases within the sentences to hyperlink, such as company names, key terms, or action phrases
12. CRITICAL: ONLY the first paragraph should contain exactly one hyperlink in the format specified above
13. Do NOT reference "a recent article" or similar phrases - just embed the hyperlink naturally in the existing sentence structure
14. Ensure proper spacing between paragraphs - add double line breaks between paragraphs

Write the 2 context paragraphs now:`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 300,
      temperature: 0.7,
    });

    const contextParagraphs = completion.choices[0].message?.content?.trim() || '';

    if (!contextParagraphs) {
      return NextResponse.json({ error: 'Failed to generate context.' }, { status: 500 });
    }

    // Ensure proper spacing between paragraphs
    const formattedContextParagraphs = contextParagraphs
      .replace(/\n\n+/g, '\n\n') // Normalize multiple line breaks to double
      .replace(/\n([^<])/g, '\n\n$1') // Ensure paragraphs are separated by double line breaks
      .replace(/([^>])\n\n([^<])/g, '$1\n\n$2'); // Ensure proper spacing around HTML tags

    // Insert context paragraphs above the price action line
    let updatedArticle = currentArticle;
    
    // Split the article into lines to find the price action section
    const lines = currentArticle.split('\n');
    const priceActionIndex = lines.findIndex((line: string) => 
      line.includes('Price Action:') || 
      line.includes('<strong>') && line.includes('Price Action:') ||
      line.includes('Price Action')
    );
    
    // Generate subhead first
    let contextSubhead = '';
    try {
      const contextSubheadPrompt = `
You are a top-tier financial journalist. Given the context that was just added to the article, create exactly 1 compelling subhead that introduces the context section.

The context section provides additional background information and relevant details about the ticker.

CONTEXT PARAGRAPHS TO BASE SUBHEAD ON:
${formattedContextParagraphs}

Requirements:
- Create exactly 1 standalone mini headline
- Make it 4-8 words maximum for maximum impact
- Make it highly engaging and clickable
- Focus on the context/additional information aspect
- Use strong, active language that conveys authority
- Capitalize the first letter of every word
- Make it relevant to the context being added
- Do NOT include quotes around the subhead
- Make it specific to the actual context content, not generic
- Base it on the specific details in the context paragraphs above
- The subhead should directly relate to the main topic discussed in the context paragraphs

Examples of good context subheads:
- "Regulatory Compliance Strategy"
- "App Store Policy Changes"
- "Investor Confidence Factors"
- "Market Positioning Tactics"
- "Competitive Edge Measures"

Create 1 subhead for the context section:`;

      const contextSubheadCompletion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: contextSubheadPrompt }],
        max_tokens: 50,
        temperature: 0.7,
      });

      contextSubhead = contextSubheadCompletion.choices[0].message?.content?.trim() || '';
      if (contextSubhead) {
        contextSubhead = contextSubhead.replace(/\*\*/g, '').replace(/^##\s*/, '').replace(/^["']|["']$/g, '').trim();
      }
    } catch (error) {
      console.error('Error generating context subhead:', error);
    }

    // Insert context and subhead together
    let updatedArticleWithSubheads = currentArticle;
    if (priceActionIndex !== -1) {
      // Insert context and subhead before the price action line
      const beforePriceAction = lines.slice(0, priceActionIndex).join('\n');
      const priceActionAndAfter = lines.slice(priceActionIndex).join('\n');
      const subheadSection = contextSubhead ? `${contextSubhead}\n\n\n${formattedContextParagraphs}` : formattedContextParagraphs;
      updatedArticleWithSubheads = `${beforePriceAction}\n\n${subheadSection}\n\n${priceActionAndAfter}`;
    } else {
      // If no price action found, add to the end
      const subheadSection = contextSubhead ? `${contextSubhead}\n\n\n${formattedContextParagraphs}` : formattedContextParagraphs;
      updatedArticleWithSubheads = `${currentArticle}\n\n${subheadSection}`;
    }
    
    return NextResponse.json({ 
      updatedArticle: updatedArticleWithSubheads,
      contextSource: {
        headline: recentArticle.headline,
        url: recentArticle.url
      }
    });
  } catch (error: any) {
    console.error('Error adding context:', error);
    return NextResponse.json({ error: error.message || 'Failed to add context.' }, { status: 500 });
  }
} 