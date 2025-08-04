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

    // Intelligently integrate the articles into the existing story
    const prompt = `
You are a professional financial journalist. Take the existing technical story and intelligently integrate content from two recent Benzinga articles to enhance the narrative with relevant news context.

EXISTING TECHNICAL STORY (DO NOT CHANGE THE BASIC STRUCTURE):
${currentArticle}

ARTICLE 1 TO INTEGRATE:
Headline: ${relatedArticles[0].headline}
Content: ${relatedArticles[0].body}
URL: ${relatedArticles[0].url}

ARTICLE 2 TO INTEGRATE:
Headline: ${relatedArticles[1].headline}
Content: ${relatedArticles[1].body}
URL: ${relatedArticles[1].url}

TASK: Enhance the existing story by thoughtfully integrating content from both articles:

1. **CONTENT INTEGRATION**:
   - You may add AT MOST TWO SHORT SENTENCES (no more than 20 words each) of content from each Benzinga article (maximum four sentences total)
   - The added information must be thoughtfully woven into the existing data-driven narrative, not just appended or inserted as blocks
   - The integration should support or enhance the technical analysis, not distract from it
   - Do NOT add standalone lines, new paragraphs, or sentences whose sole purpose is to contain a hyperlink (e.g., 'Read more about X here.' or 'Explore Y here.' are strictly forbidden)
   - Hyperlinks must be embedded naturally within otherwise meaningful sentences

2. **HYPERLINK PLACEMENT**:
   - Add exactly 2 hyperlinks using the provided URLs
   - Each hyperlink must be embedded NATURALLY within a sentence (never as its own line)
   - Place one hyperlink in the FIRST or SECOND paragraph (near the top of the story)
   - Place one hyperlink in a middle paragraph (paragraphs 3-5)
   - Use HTML format: <a href="URL">relevant phrase</a>
   - DO NOT place both hyperlinks at the bottom of the story
   - Distribute hyperlinks throughout the content for better user experience

3. **INTEGRATION GUIDELINES**:
   - Maintain the technical focus while adding news context
   - Keep the existing structure and flow
   - Add or enhance sentences with relevant news content, but keep the story concise
   - Make the integration feel natural and seamless
   - Do not create separate 'Also Read' or 'Read Next' sections
   - Preserve the price action line at the bottom
   - CRITICAL: Place hyperlinks in the top/middle sections, NOT at the bottom
   - Ensure hyperlinks are distributed throughout the story for better engagement
   - MAINTAIN THE TWO-SENTENCE PER PARAGRAPH RULE: No paragraph should exceed two sentences

4. **CONTENT SELECTION**:
   - Choose the most relevant and impactful information from each article
   - Focus on facts, quotes, and insights that enhance the technical story
   - Avoid repetitive or conflicting information
   - Prioritize information that explains or supports the price action

5. **WRITING STYLE**:
   - Maintain professional journalistic tone
   - Keep paragraphs concise and impactful
   - Use active voice and strong verbs
   - Ensure smooth transitions between technical analysis and news content
   - The final story should remain concise and focused on the data-driven narrative

Enhance the existing story by integrating the article content and adding the hyperlinks naturally.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2500,
      temperature: 0.3, // Lower temperature for more consistent integration
    });

    const enhancedArticle = completion.choices[0].message?.content?.trim() || '';

    if (!enhancedArticle) {
      return NextResponse.json({ error: 'Failed to enhance article with context.' }, { status: 500 });
    }

    return NextResponse.json({ 
      updatedArticle: enhancedArticle,
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