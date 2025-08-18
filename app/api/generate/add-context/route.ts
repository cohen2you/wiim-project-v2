import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const BENZINGA_API_KEY = process.env.BENZINGA_API_KEY!;
const BZ_NEWS_URL = 'https://api.benzinga.com/api/v2/news';

async function fetchRecentArticles(ticker: string): Promise<any[]> {
  try {
    // Strategy 1: Recent ticker-specific articles (48 hours)
    const dateFrom48h = new Date();
    dateFrom48h.setDate(dateFrom48h.getDate() - 2);
    const dateFrom48hStr = dateFrom48h.toISOString().slice(0, 10);
    
    const recentUrl = `${BZ_NEWS_URL}?token=${BENZINGA_API_KEY}&tickers=${encodeURIComponent(ticker)}&items=30&fields=headline,title,created,body,url,channels&accept=application/json&displayOutput=full&dateFrom=${dateFrom48hStr}`;
    
    console.log(`Searching for recent ${ticker} articles (48 hours)...`);
    const recentRes = await fetch(recentUrl, {
      headers: { Accept: 'application/json' },
    });
    
    if (recentRes.ok) {
      const recentData = await recentRes.json();
      if (Array.isArray(recentData) && recentData.length > 0) {
        const recentArticles = filterAndProcessArticles(recentData, false);
        console.log(`Found ${recentArticles.length} recent articles for ${ticker}`);
        
        if (recentArticles.length >= 2) {
          console.log('Using recent ticker-specific articles');
          return recentArticles.slice(0, 2);
        }
      }
    }
    
    // Strategy 2: Movers articles from past month (avoiding insights URLs)
    const dateFrom30d = new Date();
    dateFrom30d.setDate(dateFrom30d.getDate() - 30);
    const dateFrom30dStr = dateFrom30d.toISOString().slice(0, 10);
    
    const moversUrl = `${BZ_NEWS_URL}?token=${BENZINGA_API_KEY}&tickers=${encodeURIComponent(ticker)}&items=100&fields=headline,title,created,body,url,channels&accept=application/json&displayOutput=full&dateFrom=${dateFrom30dStr}`;
    
    console.log(`Searching for movers articles for ${ticker} (30 days)...`);
    const moversRes = await fetch(moversUrl, {
      headers: { Accept: 'application/json' },
    });
    
    if (moversRes.ok) {
      const moversData = await moversRes.json();
      if (Array.isArray(moversData) && moversData.length > 0) {
        const moversArticles = filterAndProcessArticles(moversData, true);
        console.log(`Found ${moversArticles.length} movers articles for ${ticker}`);
        
        if (moversArticles.length >= 2) {
          console.log('Using movers articles');
          return moversArticles.slice(0, 2);
        }
      }
    }
    
    // Strategy 3: SPY market articles (24 hours)
    const dateFrom24h = new Date();
    dateFrom24h.setDate(dateFrom24h.getDate() - 1);
    const dateFrom24hStr = dateFrom24h.toISOString().slice(0, 10);
    
    const spyUrl = `${BZ_NEWS_URL}?token=${BENZINGA_API_KEY}&tickers=SPY&items=20&fields=headline,title,created,body,url,channels&accept=application/json&displayOutput=full&dateFrom=${dateFrom24hStr}`;
    
    console.log('Searching for SPY market articles (24 hours)...');
    const spyRes = await fetch(spyUrl, {
      headers: { Accept: 'application/json' },
    });
    
    if (spyRes.ok) {
      const spyData = await spyRes.json();
      if (Array.isArray(spyData) && spyData.length > 0) {
        const spyArticles = filterAndProcessArticles(spyData, false);
        console.log(`Found ${spyArticles.length} SPY articles`);
        
        if (spyArticles.length >= 2) {
          console.log('Using SPY market articles as fallback');
          return spyArticles.slice(0, 2);
        }
      }
    }
    
    console.log('No suitable articles found from any strategy');
    return [];
  } catch (error) {
    console.error('Error fetching recent articles:', error);
    return [];
  }
}

// Helper function to filter and process articles
function filterAndProcessArticles(data: any[], prioritizeMovers: boolean): any[] {
  // Filter out press releases and insights URLs
  const prChannelNames = ['press releases', 'press-releases', 'pressrelease'];
  const normalize = (str: string) => str.toLowerCase().replace(/[-_]/g, ' ');
  
  let articles = data
    .filter(item => {
      // Exclude press releases
      if (Array.isArray(item.channels) && item.channels.some((ch: any) => 
        typeof ch.name === 'string' && prChannelNames.includes(normalize(ch.name))
      )) {
        return false;
      }
      
      // Exclude insights URLs
      if (item.url && item.url.includes('/insights/')) {
        return false;
      }
      
      return true;
    })
    .map((item: any) => ({
      headline: item.headline || item.title || '[No Headline]',
      body: item.body || '',
      url: item.url,
      created: item.created,
      isMovers: item.url && item.url.includes('/trading-ideas/movers'),
    }))
    .filter(item => {
      // Ensure substantial content and valid URL
      return item.body && item.body.length > 50 && item.url;
    });
  
  // Sort articles based on strategy
  if (prioritizeMovers) {
    // For movers strategy: prioritize movers articles, then by date
    articles.sort((a, b) => {
      if (a.isMovers && !b.isMovers) return -1;
      if (!a.isMovers && b.isMovers) return 1;
      
      const dateA = new Date(a.created || 0);
      const dateB = new Date(b.created || 0);
      return dateB.getTime() - dateA.getTime();
    });
  } else {
    // For other strategies: sort by date only
    articles.sort((a, b) => {
      const dateA = new Date(a.created || 0);
      const dateB = new Date(b.created || 0);
      return dateB.getTime() - dateA.getTime();
    });
  }
  
     return articles;
 }



export async function POST(request: Request) {
  try {
    const { ticker, existingStory } = await request.json();
    
    if (!ticker || !existingStory) {
      return NextResponse.json({ error: 'Ticker and existing story are required.' }, { status: 400 });
    }

    // Fetch two recent articles for context
    const recentArticles = await fetchRecentArticles(ticker);
    
    if (recentArticles.length === 0) {
      return NextResponse.json({ error: 'No recent articles found for context.' }, { status: 404 });
    }

    // Validate that we have at least 2 articles with valid URLs
    const validArticles = recentArticles.filter(article => article.url && article.headline && article.body);
    
    console.log(`Valid articles found: ${validArticles.length}`);
    validArticles.forEach((article, index) => {
      console.log(`Article ${index + 1}: ${article.headline} - URL: ${article.url ? 'Yes' : 'No'}`);
    });
    
        if (validArticles.length < 2) {
      return NextResponse.json({ 
        error: `Insufficient articles with valid URLs. Found ${validArticles.length} valid articles, need at least 2.` 
      }, { status: 404 });
    }

    // Ensure we have exactly 2 articles for the context
    const articlesForContext = validArticles.slice(0, 2);

    console.log('Articles being used for context:');
    articlesForContext.forEach((article, index) => {
      console.log(`Article ${index + 1}:`);
      console.log(`- Headline: ${article.headline}`);
      console.log(`- URL: ${article.url}`);
      console.log(`- Content length: ${article.body?.length || 0}`);
    });

    // Prepare article data for the prompt
    const articlesData = articlesForContext.map((article, index) => 
      `Article ${index + 1}:
Headline: ${article.headline}
Content: ${article.body}
URL: ${article.url}`
    ).join('\n\n');

    // Generate enhanced story with integrated context
    let prompt = `
You are a financial journalist. You have an existing story and two recent news articles about the same ticker. Your task is to intelligently integrate content from these articles into the existing story.

EXISTING STORY:
${existingStory}

RECENT ARTICLES:
${articlesData}

CRITICAL TASK: You MUST integrate content from BOTH articles with EXACTLY 2 hyperlinks total.

INSTRUCTIONS:
1. Review the existing story and identify where to integrate content from the two articles
2. Place ONE hyperlink from Article 1 in the FIRST or SECOND paragraph of the story
3. Place ONE hyperlink from Article 2 in a MIDDLE paragraph (paragraphs 3-5) of the story
4. Each integration should be MAXIMUM 2 sentences from each article source
5. Weave the content naturally into existing paragraphs - do NOT create standalone hyperlink lines
6. Use this exact hyperlink format: <a href="[URL]">[three word phrase]</a>
7. Maintain the two-sentence-per-paragraph rule throughout
8. Focus on technical data, market context, or relevant business developments
9. Make the integrations feel natural and enhance the story's flow
10. Do NOT reference "recent articles" or similar phrases - just embed the hyperlinks naturally
11. Ensure all prices are formatted to exactly 2 decimal places
12. DO NOT use phrases like "according to Benzinga" or "according to recent reports" - these are awkward since this is for Benzinga
13. Integrate the content directly without attribution phrases

MANDATORY HYPERLINK REQUIREMENTS:
- Article 1 URL: ${articlesForContext[0].url} - MUST be used in paragraph 1 or 2
- Article 2 URL: ${articlesForContext[1].url} - MUST be used in paragraph 3, 4, or 5
- Both hyperlinks must be embedded naturally in the text
- YOU MUST INCLUDE EXACTLY 2 HYPERLINKS - ONE FROM EACH ARTICLE
- DO NOT SKIP EITHER ARTICLE - BOTH MUST BE USED
- If you only include 1 hyperlink, you have failed the task

HYPERLINK INTEGRATION RULES:
- Integrate content naturally without attribution phrases
- Avoid phrases like "according to Benzinga", "according to recent reports", "as reported", "as mentioned"
- Present information directly as factual content
- Use descriptive phrases like "recent hedge fund activity", "market developments", "sector trends", "company performance"
- DO NOT use phrases that sound like citations or attributions
- Make the hyperlinks feel like natural parts of the sentence, not added references

CRITICAL RULES:
- Article 1 hyperlink goes in paragraph 1 or 2
- Article 2 hyperlink goes in paragraph 3, 4, or 5
- Maximum 2 sentences per article integration
- No standalone hyperlink lines
- Maintain existing story structure and flow
- Format all prices to exactly 2 decimal places
- PRESERVE ALL EXISTING HYPERLINKS - Do not remove or modify any existing hyperlinks in the story
- The final story must contain ALL original hyperlinks PLUS the 2 new ones

VERIFICATION: Before submitting, count your hyperlinks. You must have exactly 2 NEW integrated hyperlinks PLUS all existing hyperlinks from the original story.

HYPERLINK EXAMPLES:
❌ WRONG: "Berkshire Hathaway reduced its stake as reported"
❌ WRONG: "TSMC's performance declined as mentioned"
✅ CORRECT: "Berkshire Hathaway reduced its stake in recent hedge fund activity"
✅ CORRECT: "TSMC's performance declined amid market developments"

Return the complete enhanced story with integrated context:`;

    let enhancedStory = '';
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
      attempts++;
      console.log(`Attempt ${attempts} to generate story with both hyperlinks...`);
      
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2000,
        temperature: 0.7,
      });

      enhancedStory = completion.choices[0].message?.content?.trim() || '';

      if (!enhancedStory) {
        return NextResponse.json({ error: 'Failed to generate enhanced story.' }, { status: 500 });
      }

      // Debug: Count hyperlinks in the result
      const hyperlinkCount = (enhancedStory.match(/<a href=/g) || []).length;
      const hasArticle1 = enhancedStory.includes(articlesForContext[0].url);
      const hasArticle2 = enhancedStory.includes(articlesForContext[1].url);
      
      // Count existing hyperlinks from the original story
      const existingHyperlinkCount = (existingStory.match(/<a href=/g) || []).length;
      const totalExpectedHyperlinks = existingHyperlinkCount + 2; // Original + 2 new ones
      
      console.log(`Enhanced story hyperlink count: ${hyperlinkCount}`);
      console.log(`Original story hyperlink count: ${existingHyperlinkCount}`);
      console.log(`Expected total hyperlinks: ${totalExpectedHyperlinks}`);
      console.log(`Article 1 URL appears: ${hasArticle1}`);
      console.log(`Article 2 URL appears: ${hasArticle2}`);
      
      // Check if both new hyperlinks are present AND all existing hyperlinks are preserved
      if (hyperlinkCount >= totalExpectedHyperlinks && hasArticle1 && hasArticle2) {
        console.log(`Success! Both new hyperlinks included and existing hyperlinks preserved on attempt ${attempts}`);
        break;
      } else {
        console.log(`Attempt ${attempts} failed - missing hyperlinks or lost existing ones. Retrying...`);
        if (attempts < maxAttempts) {
          // Add a more explicit instruction for the retry
          const retryPrompt = prompt + `\n\nCRITICAL RETRY INSTRUCTION: Your previous response was missing required hyperlinks or lost existing ones. You MUST include EXACTLY 2 NEW hyperlinks - one from each article. Article 1 URL: ${articlesForContext[0].url} and Article 2 URL: ${articlesForContext[1].url}. Both must be present in the final story. MOST IMPORTANTLY: You MUST PRESERVE ALL EXISTING HYPERLINKS from the original story. Do not remove or modify any existing hyperlinks.`;
          prompt = retryPrompt;
        }
      }
    }
    
         // If we still don't have both hyperlinks after all attempts, try a more natural approach
     if (!enhancedStory.includes(articlesForContext[0].url) || !enhancedStory.includes(articlesForContext[1].url)) {
       console.log('Falling back to natural hyperlink integration...');
       
       // Check if we lost existing hyperlinks
       const existingHyperlinkCount = (existingStory.match(/<a href=/g) || []).length;
       const currentHyperlinkCount = (enhancedStory.match(/<a href=/g) || []).length;
       
       if (currentHyperlinkCount < existingHyperlinkCount) {
         console.log('WARNING: Lost existing hyperlinks during AI processing. Restoring original story and adding new hyperlinks naturally.');
         enhancedStory = existingStory; // Restore original story to preserve existing hyperlinks
       }
       
       // Split the story into paragraphs
       const paragraphs = enhancedStory.split('\n\n').filter(p => p.trim());
       
       if (paragraphs.length >= 2) {
         // For Article 1: Find a natural place in the first or second paragraph
         const targetParagraph1 = paragraphs.length >= 2 ? 1 : 0;
         let paragraph1 = paragraphs[targetParagraph1];
         
         // Look for natural integration points in the first paragraph
         const integrationPoints1 = [
           { pattern: /(shares have been|stock has been|company has been)/i, replacement: `$1 <a href="${articlesForContext[0].url}">amid recent developments</a>` },
           { pattern: /(performance throughout|rally has extended|surge has continued)/i, replacement: `$1 <a href="${articlesForContext[0].url}">with strong momentum</a>` },
           { pattern: /(analysts expressing|market sentiment|investor confidence)/i, replacement: `$1 <a href="${articlesForContext[0].url}">in the sector</a>` }
         ];
         
         let integrated1 = false;
         for (const point of integrationPoints1) {
           if (point.pattern.test(paragraph1)) {
             paragraph1 = paragraph1.replace(point.pattern, point.replacement);
             integrated1 = true;
             break;
           }
         }
         
         // If no natural point found, add at the end of the sentence before the last period
         if (!integrated1) {
           const sentences = paragraph1.split('.');
           if (sentences.length > 1) {
             const lastSentence = sentences[sentences.length - 2];
             if (lastSentence.trim()) {
               sentences[sentences.length - 2] = lastSentence + ` <a href="${articlesForContext[0].url}">amid recent developments</a>`;
               paragraph1 = sentences.join('.');
             }
           }
         }
         
         // For Article 2: Find a natural place in middle paragraphs
         const targetParagraph2 = Math.min(3, paragraphs.length - 1);
         let paragraph2 = paragraphs[targetParagraph2];
         
         const integrationPoints2 = [
           { pattern: /(market conditions|trading activity|sector performance)/i, replacement: `$1 <a href="${articlesForContext[1].url}">shows continued strength</a>` },
           { pattern: /(valuation outlook|price targets|analyst ratings)/i, replacement: `$1 <a href="${articlesForContext[1].url}">reflect market sentiment</a>` },
           { pattern: /(execution risks|inherent challenges|market dynamics)/i, replacement: `$1 <a href="${articlesForContext[1].url}">in the current environment</a>` }
         ];
         
         let integrated2 = false;
         for (const point of integrationPoints2) {
           if (point.pattern.test(paragraph2)) {
             paragraph2 = paragraph2.replace(point.pattern, point.replacement);
             integrated2 = true;
             break;
           }
         }
         
         // If no natural point found, add at the end of the sentence before the last period
         if (!integrated2) {
           const sentences = paragraph2.split('.');
           if (sentences.length > 1) {
             const lastSentence = sentences[sentences.length - 2];
             if (lastSentence.trim()) {
               sentences[sentences.length - 2] = lastSentence + ` <a href="${articlesForContext[1].url}">amid market developments</a>`;
               paragraph2 = sentences.join('.');
             }
           }
         }
         
         // Update the paragraphs
         paragraphs[targetParagraph1] = paragraph1;
         paragraphs[targetParagraph2] = paragraph2;
         
         enhancedStory = paragraphs.join('\n\n');
         console.log('Natural hyperlink integration completed');
       }
     }

    // Return the enhanced story with integrated context
    const finalStory = enhancedStory;
    
    return NextResponse.json({ 
      story: finalStory,
      contextSources: articlesForContext.map(article => ({
        headline: article.headline,
        url: article.url
      }))
    });
  } catch (error: any) {
    console.error('Error adding context:', error);
    return NextResponse.json({ error: error.message || 'Failed to add context.' }, { status: 500 });
  }
}

 