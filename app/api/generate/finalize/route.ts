import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { preserveHyperlinks } from '../../../../lib/hyperlink-preservation';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Function to restore specific hyperlinks that were lost during AI processing
function restoreSpecificHyperlinks(originalText: string, newText: string): string {
  // Extract all hyperlinks from original text
  const originalLinks = originalText.match(/<a href="[^"]+">[^<]+<\/a>/g) || [];
  
  // If no original links, return new text
  if (originalLinks.length === 0) {
    return newText;
  }
  
  let restoredText = newText;
  
  console.log('Hyperlink restoration - Original links found:', originalLinks.length);
  
  // Restore each original link if it's missing
  for (const link of originalLinks) {
    if (!restoredText.includes(link)) {
      console.log('Missing link:', link);
      
      // Extract the URL and link text
      const urlMatch = link.match(/href="([^"]+)"/);
      const textMatch = link.match(/>([^<]+)</);
      
      if (urlMatch && textMatch) {
        const url = urlMatch[1];
        const linkText = textMatch[1];
        
        console.log('Trying to restore:', linkText, 'with URL:', url);
        
        // Try multiple strategies to restore the link
        
        // Strategy 1: Look for exact text match
        const exactRegex = new RegExp(`\\b${linkText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
        if (exactRegex.test(restoredText)) {
          console.log('Strategy 1 success - exact match found');
          restoredText = restoredText.replace(exactRegex, `<a href="${url}">${linkText}</a>`);
          continue;
        }
        
        // Strategy 2: Look for partial text match (for "Also Read:" links)
        if (linkText.includes('Also Read:')) {
          const partialText = linkText.replace('Also Read: ', '');
          const partialRegex = new RegExp(`\\b${partialText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
          if (partialRegex.test(restoredText)) {
            console.log('Strategy 2 success - partial match found for Also Read');
            restoredText = restoredText.replace(partialRegex, `<a href="${url}">${linkText}</a>`);
            continue;
          }
        }
        
        // Strategy 3: Look for similar text patterns
        const words = linkText.split(' ');
        if (words.length >= 3) {
          // Try to find 3 consecutive words
          for (let i = 0; i <= words.length - 3; i++) {
            const phrase = words.slice(i, i + 3).join(' ');
            const phraseRegex = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
            if (phraseRegex.test(restoredText)) {
              console.log('Strategy 3 success - phrase match found:', phrase);
              restoredText = restoredText.replace(phraseRegex, `<a href="${url}">${linkText}</a>`);
              break;
            }
          }
        }
        
        // Strategy 4: For "Also Read" links, try to insert them back
        if (linkText.includes('Also Read:')) {
          console.log('Strategy 4 - trying to reinsert Also Read link');
          // Find a good place to insert the Also Read link
          const lines = restoredText.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('What To Know:') || lines[i].includes('What Happened:')) {
              lines.splice(i + 1, 0, link);
              restoredText = lines.join('\n');
              console.log('Strategy 4 success - Also Read link reinserted');
              break;
            }
          }
        }
        
        // Strategy 5: For long headlines, try to find key words
        if (linkText.length > 50) {
          console.log('Strategy 5 - trying to find key words in long headline');
          const keyWords = linkText.split(' ').filter(word => word.length > 4);
          for (const word of keyWords.slice(0, 3)) { // Try first 3 long words
            const wordRegex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
            if (wordRegex.test(restoredText)) {
              console.log('Strategy 5 success - found key word:', word);
              restoredText = restoredText.replace(wordRegex, `<a href="${url}">${linkText}</a>`);
              break;
            }
          }
        }
        
        console.log('All strategies failed for:', linkText);
      }
    } else {
      console.log('Link already present:', link.substring(0, 50) + '...');
    }
  }
  
  const finalLinkCount = (restoredText.match(/<a href=/g) || []).length;
  console.log('Hyperlink restoration complete - Final link count:', finalLinkCount);
  
  // Final fallback: If we're still missing the Also Read link, manually insert it
  if (finalLinkCount < originalLinks.length) {
    const missingLinks = originalLinks.filter(link => !restoredText.includes(link));
    for (const missingLink of missingLinks) {
      if (missingLink.includes('Also Read:')) {
        console.log('Final fallback - manually inserting Also Read link');
        // Insert after the first paragraph or after "What To Know"
        const lines = restoredText.split('\n');
        let insertIndex = 1; // After first paragraph
        
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes('What To Know:') || lines[i].includes('What Happened:')) {
            insertIndex = i + 1;
            break;
          }
        }
        
        lines.splice(insertIndex, 0, missingLink);
        restoredText = lines.join('\n');
        console.log('Final fallback success - Also Read link inserted');
      }
    }
  }
  
  return restoredText;
}

export async function POST(request: Request) {
  try {
    const { ticker, existingStory } = await request.json();
    
    if (!ticker || !existingStory) {
      return NextResponse.json({ error: 'Ticker and existing story are required.' }, { status: 400 });
    }

    // Extract the price action line from the story
    let tickerFromPrice: string;
    let priceDirection: string;
    let priceChangePercent: string;
    
    // Try the primary pattern first
    const priceActionMatch = existingStory.match(/([A-Z]+) Price Action:.*?([A-Z]+) shares were (up|down|fell|rose).*?(\d+\.?\d*)%/i);
    
    if (priceActionMatch) {
      [, tickerFromPrice, , priceDirection, priceChangePercent] = priceActionMatch;
    } else {
      // Try a more flexible pattern
      const flexibleMatch = existingStory.match(/([A-Z]+) Price Action:.*?(up|down|fell|rose).*?(\d+\.?\d*)%/i);
      
      if (!flexibleMatch) {
        console.error('Could not find price action in story. Story excerpt:', existingStory.substring(existingStory.length - 200));
        return NextResponse.json({ error: 'Could not find price action information in the story.' }, { status: 400 });
      }
      
      [, tickerFromPrice, priceDirection, priceChangePercent] = flexibleMatch;
    }
    
    // Determine if the stock went up or down
    const isUp = priceDirection === 'up' || priceDirection === 'rose';
    const isDown = priceDirection === 'down' || priceDirection === 'fell';
    
    if (!isUp && !isDown) {
      return NextResponse.json({ error: 'Could not determine price direction from price action.' }, { status: 400 });
    }

    // Get current day name
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const currentDay = days[new Date().getDay()];

    // Create a comprehensive prompt for finalizing the story
    const finalizePrompt = `
You are a senior financial editor tasked with SIGNIFICANTLY improving a news article. Your job is to make MAJOR editorial improvements while preserving ALL essential content.

EXISTING STORY:
${existingStory}

PRICE ACTION INFORMATION:
- Stock direction: ${isUp ? 'UP' : 'DOWN'}
- Change: ${priceChangePercent}%
- Ticker: ${tickerFromPrice}
- Current day: ${currentDay}

CRITICAL EDITORIAL IMPROVEMENTS REQUIRED:
1. **BREAK UP LONG PARAGRAPHS**: Split any paragraph longer than 2 sentences into multiple paragraphs
2. **ENHANCE SENTENCE STRUCTURE**: Rewrite sentences to be more engaging and varied
3. **IMPROVE WORD CHOICE**: Replace generic words with more specific, impactful language
4. **CREATE BETTER TRANSITIONS**: Add smooth connections between paragraphs and ideas
5. **MAKE TECHNICAL ANALYSIS CLEARER**: Simplify complex financial concepts for retail investors
6. **REMOVE REDUNDANCY**: Eliminate repetitive phrases and unnecessary words
7. **USE ACTIVE VOICE**: Convert passive voice to active voice where appropriate
8. **ENHANCE READABILITY**: Make the story more conversational and engaging
9. **IMPROVE FLOW**: Create logical progression from lead to conclusion
10. **MAINTAIN PROFESSIONAL TONE**: Keep it professional but accessible

SPECIFIC REQUIREMENTS:
- **MANDATORY PARAGRAPH BREAKS**: You MUST break up any paragraph longer than 2 sentences into multiple paragraphs
- **Lead Paragraph**: Must match the price action direction and include the correct trading day
- **Weekend Fix**: Replace Saturday/Sunday with Friday (or the most recent trading day)
- **Hyperlink Preservation**: ALL existing hyperlinks must remain intact and functional
- **Price Action Line**: Must remain at the bottom of the story
- **Analyst Ratings**: Must remain with firm names and dates
- **Context Articles**: Must remain with hyperlinks
- **Story Flow**: Improve transitions between paragraphs and ideas
- **Clarity**: Make complex financial concepts more accessible
- **Writing Quality**: Enhance sentence structure and word choice while preserving all facts
- **ACTIVE VOICE**: Convert passive voice to active voice
- **VARIED SENTENCE STRUCTURE**: Use different sentence lengths and structures
- **REMOVE REDUNDANCY**: Eliminate repetitive phrases and unnecessary words

CRITICAL PRESERVATION RULES:
- PRESERVE ALL EXISTING HYPERLINKS - Do not remove, modify, or change any <a href="...">text</a> tags
- PRESERVE THE PRICE ACTION LINE - Keep it at the bottom of the story
- PRESERVE ALL ANALYST RATINGS - Keep firm names, ratings, price targets, and dates
- PRESERVE ALL CONTEXT ARTICLE REFERENCES - Keep hyperlinks to context articles
- Fix any Saturday/Sunday references to Friday (or most recent trading day)
- Match the lead paragraph to the price action direction
- Improve the overall writing quality and flow
- Keep all factual information accurate

LEAD PARAGRAPH IMPROVEMENTS:
- Make the lead more direct and engaging
- Avoid repetitive phrases like "strong buying volume and positive momentum"
- Use more specific, impactful language
- Keep it concise but informative
- Make it sound more human and less AI-generated

EDITORIAL STYLE:
- Conversational but professional
- Clear and engaging for retail investors
- Avoid jargon when possible
- Smooth transitions between ideas
- Logical flow from lead to conclusion
- Active voice preferred
- Concise sentences (2 sentences max per paragraph)

LENGTH REDUCTION STRATEGY:
- Remove redundant phrases and unnecessary words
- Combine similar ideas into single sentences
- Eliminate repetitive information
- Streamline transitions
- Keep all essential facts, numbers, and data points
- Maintain all hyperlinks and references

Return the finalized, editorially improved story that is 350-400 words while preserving ALL essential content:`;

    const finalizeCompletion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: finalizePrompt }],
      max_tokens: 2500,
      temperature: 0.3,
    });

    const finalizedStory = finalizeCompletion.choices[0].message?.content?.trim() || existingStory;

    // Enhanced hyperlink preservation - restore specific hyperlinks that were lost
    const finalStory = restoreSpecificHyperlinks(existingStory, finalizedStory);

    // Verify that essential content was preserved AFTER hyperlink restoration
    const originalHyperlinkCount = (existingStory.match(/<a href=/g) || []).length;
    const finalHyperlinkCount = (finalStory.match(/<a href=/g) || []).length;
    const hasPriceAction = finalStory.includes('Price Action:');
    const hasAnalystRatings = finalStory.includes('Analyst sentiment') || finalStory.includes('rating with $') || finalStory.includes('maintaining') && finalStory.includes('rating');
    
    console.log('Finalize verification:');
    console.log(`- Original hyperlinks: ${originalHyperlinkCount}`);
    console.log(`- Final hyperlinks: ${finalHyperlinkCount}`);
    console.log(`- Has price action line: ${hasPriceAction}`);
    console.log(`- Has analyst ratings: ${hasAnalystRatings}`);
    console.log(`- Final word count: ${finalStory.split(' ').length}`);
    
    // Only return original if we're missing more than 1 hyperlink after restoration
    if (finalHyperlinkCount < originalHyperlinkCount - 1) {
      console.warn(`Finalize: Missing ${originalHyperlinkCount - finalHyperlinkCount} hyperlinks after restoration, returning original story`);
      return NextResponse.json({ 
        story: existingStory,
        originalStory: existingStory,
        priceDirection: isUp ? 'up' : 'down',
        priceChangePercent: priceChangePercent,
        warning: 'Finalization was skipped to preserve essential content'
      });
    }
    
    // If we're only missing 1 hyperlink, accept the improved version
    if (finalHyperlinkCount < originalHyperlinkCount) {
      console.warn(`Finalize: Missing 1 hyperlink but accepting improved version for better writing quality`);
    }

    return NextResponse.json({ 
      story: finalStory,
      originalStory: existingStory,
      priceDirection: isUp ? 'up' : 'down',
      priceChangePercent: priceChangePercent
    });
  } catch (error: any) {
    console.error('Error finalizing story:', error);
    return NextResponse.json({ error: error.message || 'Failed to finalize story.' }, { status: 500 });
  }
} 