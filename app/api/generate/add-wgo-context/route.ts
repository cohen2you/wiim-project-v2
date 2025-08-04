import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const BENZINGA_API_KEY = process.env.BENZINGA_API_KEY!;
const BZ_NEWS_URL = 'https://api.benzinga.com/api/v2/news';

async function fetchRelatedArticles(ticker: string, excludeUrl?: string): Promise<any[]> {
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
      return [];
    }
    
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return [];
    
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
        body: item.body || '',
        url: item.url,
        created: item.created,
      }))
      .filter(item => item.body && item.body.length > 100) // Ensure there's substantial content
      .slice(0, 2); // Get exactly 2 articles
    
    return relatedArticles;
  } catch (error) {
    console.error('Error fetching related articles:', error);
    return [];
  }
}

export async function POST(request: Request) {
  try {
    const { ticker, currentArticle } = await request.json();
    
    if (!ticker || !currentArticle) {
      return NextResponse.json({ error: 'Ticker and current article are required.' }, { status: 400 });
    }

    // Fetch related articles for context
    const relatedArticles = await fetchRelatedArticles(ticker);
    
    if (relatedArticles.length < 2) {
      return NextResponse.json({ error: 'Not enough related articles found for context.' }, { status: 404 });
    }

    // Add hyperlinks to the existing article
    const prompt = `
You are a professional financial journalist. Take the existing article and add exactly 2 hyperlinks to it using the provided related articles.

EXISTING ARTICLE (DO NOT CHANGE THE CONTENT, ONLY ADD HYPERLINKS):
${currentArticle}

RELATED ARTICLE 1:
Headline: ${relatedArticles[0].headline}
URL: ${relatedArticles[0].url}

RELATED ARTICLE 2:
Headline: ${relatedArticles[1].headline}
URL: ${relatedArticles[1].url}

TASK: Add exactly 2 hyperlinks to the existing article:
1. Add ONE hyperlink in the LEAD paragraph (first paragraph) using a 3-word phrase from Article 1
2. Add ONE hyperlink in a MIDDLE paragraph using a 3-word phrase from Article 2

HYPERLINK RULES:
- Use HTML format: <a href="URL">three word phrase</a>
- Choose relevant 3-word phrases that fit naturally in the existing sentences
- Do not change any existing content - only add the hyperlinks
- Do not add "Also Read" or "Read Next" sections
- Do not add any new text or sections
- Keep the exact same article structure and content
- The hyperlinks must be naturally embedded in existing sentences

EXAMPLE:
Original: "Meta Platforms Inc. traded higher in premarket trading on Monday as investors are optimistic about the company's strategic positioning."
Modified: "Meta Platforms Inc. traded higher in premarket trading on Monday as investors are optimistic about the company's <a href="URL">strategic positioning</a>."

Add the hyperlinks to the existing article now:`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1500,
      temperature: 0.3, // Lower temperature for more consistent results
    });

    const updatedArticle = completion.choices[0].message?.content?.trim() || '';

    if (!updatedArticle) {
      return NextResponse.json({ error: 'Failed to add hyperlinks to article.' }, { status: 500 });
    }

    return NextResponse.json({ 
      updatedArticle,
      relatedArticles: relatedArticles.map(article => ({
        headline: article.headline,
        url: article.url
      }))
    });
  } catch (error: any) {
    console.error('Error adding WGO context:', error);
    return NextResponse.json({ error: error.message || 'Failed to add WGO context.' }, { status: 500 });
  }
} 