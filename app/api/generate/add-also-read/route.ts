import { NextResponse } from 'next/server';
import { preserveHyperlinks, ensureProperPriceActionPlacement } from '../../../../lib/hyperlink-preservation';

const BENZINGA_API_KEY = process.env.BENZINGA_API_KEY!;
const BZ_NEWS_URL = 'https://api.benzinga.com/api/v2/news';

// Helper function to fetch additional market articles for Also Read and Read Next links
async function fetchAdditionalMarketArticles(): Promise<any[]> {
  try {
    const dateFrom24h = new Date();
    dateFrom24h.setDate(dateFrom24h.getDate() - 1);
    const dateFrom24hStr = dateFrom24h.toISOString().slice(0, 10);
    
    // Search for general market articles from the past 24 hours
    const marketUrl = `${BZ_NEWS_URL}?token=${BENZINGA_API_KEY}&items=20&fields=headline,title,created,body,url,channels&accept=application/json&displayOutput=full&dateFrom=${dateFrom24hStr}`;
    
    console.log('Fetching additional market articles for Also Read and Read Next links...');
    const marketRes = await fetch(marketUrl, {
      headers: { Accept: 'application/json' },
    });
    
    if (marketRes.ok) {
      const marketData = await marketRes.json();
      if (Array.isArray(marketData) && marketData.length > 0) {
        const marketArticles = filterAndProcessArticles(marketData);
        console.log(`Found ${marketArticles.length} additional market articles`);
        return marketArticles.slice(0, 2); // Need 2 articles for Also Read and Read Next
      }
    }
    
    return [];
  } catch (error) {
    console.error('Error fetching additional market articles:', error);
    return [];
  }
}

// Helper function to filter and process articles
function filterAndProcessArticles(data: any[]): any[] {
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
    }))
    .filter(item => {
      // Ensure substantial content and valid URL
      return item.body && item.body.length > 50 && item.url;
    })
    .sort((a, b) => {
      // Sort by date (newer first)
      const dateA = new Date(a.created || 0);
      const dateB = new Date(b.created || 0);
      return dateB.getTime() - dateA.getTime();
    });
  
  return articles;
}

// Helper function to remove existing Also Read and Read Next links
function removeExistingAlsoReadAndReadNextLinks(story: string): string {
  // Remove Also Read links (can be anywhere in the story)
  story = story.replace(/Also Read:.*?(?=\n\n|\n[A-Z]|$)/g, '');
  
  // Remove Read Next links (usually at the end)
  story = story.replace(/Read Next:.*?(?=\n\n|\n[A-Z]|$)/g, '');
  
  // Clean up any double line breaks that might be left
  story = story.replace(/\n\n\n+/g, '\n\n');
  
  return story.trim();
}

// Helper function to insert Also Read link midway through the article
function insertAlsoReadMidway(story: string, alsoReadLink: string): string {
  if (!alsoReadLink) return story;
  
  // Split the story into paragraphs (handle both \n\n and </p><p> patterns)
  let paragraphs: string[];
  
  if (story.includes('</p>')) {
    // HTML content - split by </p><p> or </p>\n<p>
    paragraphs = story.split(/<\/p>\s*<p[^>]*>/).filter(p => p.trim());
    // Clean up the first and last paragraphs
    if (paragraphs.length > 0) {
      paragraphs[0] = paragraphs[0].replace(/^<p[^>]*>/, '');
      paragraphs[paragraphs.length - 1] = paragraphs[paragraphs.length - 1].replace(/<\/p>$/, '');
    }
  } else {
    // Plain text content
    paragraphs = story.split('\n\n').filter(p => p.trim());
  }
  
  if (paragraphs.length <= 2) {
    // If story is too short, just add at the end
    return story + '\n\n' + alsoReadLink;
  }
  
  // Insert the Also Read link in the middle of the article
  // For stories with 3+ paragraphs, place it after the middle paragraph
  // For stories with 4+ paragraphs, place it after the second paragraph (more towards middle)
  const insertIndex = paragraphs.length >= 4 ? 2 : Math.floor(paragraphs.length / 2);
  const newParagraphs = [...paragraphs];
  newParagraphs.splice(insertIndex + 1, 0, alsoReadLink);
  
  // Reconstruct the story
  let result;
  if (story.includes('</p>')) {
    // HTML content - wrap in <p> tags
    result = newParagraphs.map(p => `<p>${p}</p>`).join('\n');
  } else {
    // Plain text content
    result = newParagraphs.join('\n\n');
  }
  
  // Verify we didn't lose any hyperlinks
  const originalHyperlinkCount = (story.match(/<a href=/g) || []).length;
  const newHyperlinkCount = (result.match(/<a href=/g) || []).length;
  
  if (newHyperlinkCount < originalHyperlinkCount) {
    // Fallback: just append at the end
    return story + '\n\n' + alsoReadLink;
  }
  
  return result;
}

export async function POST(request: Request) {
  try {
    const { ticker, story } = await request.json();
    
    if (!ticker || !story) {
      return NextResponse.json({ error: 'Ticker and story are required.' }, { status: 400 });
    }

    // Get separate articles for Also Read links
    const additionalArticles = await fetchAdditionalMarketArticles();
    
    // Add Also Read link
    const alsoReadArticle = additionalArticles.length > 0 ? additionalArticles[0] : null;
    const alsoReadLink = alsoReadArticle ? `Also Read: <a href="${alsoReadArticle.url}">${alsoReadArticle.headline}</a>` : '';
    
    // Add Read Next link
    const readNextArticle = additionalArticles.length > 1 ? additionalArticles[1] : (additionalArticles.length > 0 ? additionalArticles[0] : null);
    const readNextLink = readNextArticle ? `Read Next: <a href="${readNextArticle.url}">${readNextArticle.headline}</a>` : '';
    
    // Combine story with Also Read and Read Next links
    let completeStory = story;
    
    // Remove existing Also Read and Read Next links if they exist
    completeStory = removeExistingAlsoReadAndReadNextLinks(completeStory);
    
    // Insert Also Read link midway through the article
    if (alsoReadLink) {
      completeStory = insertAlsoReadMidway(completeStory, alsoReadLink);
    }
    
    // Ensure proper placement of Read Next link (price action will be handled by other APIs)
    completeStory = ensureProperPriceActionPlacement(completeStory, '', readNextLink);
    
    // Preserve existing hyperlinks
    const finalStory = preserveHyperlinks(story, completeStory);
    
    return NextResponse.json({ 
      story: finalStory,
      alsoReadLink,
      readNextLink
    });
  } catch (error: any) {
    console.error('Error adding Also Read link:', error);
    return NextResponse.json({ error: error.message || 'Failed to add Also Read link.' }, { status: 500 });
  }
} 