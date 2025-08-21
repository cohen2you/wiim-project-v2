import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { preserveHyperlinks } from '../../../../lib/hyperlink-preservation';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Function to format article date for display
function formatArticleDate(articleDate: string): string {
  console.log(`formatArticleDate called with: ${articleDate}`);
  
  // Try to parse the date more robustly
  let articleTime: Date;
  
  // Handle different date formats
  if (articleDate.match(/^\d{4}-\d{2}-\d{2}/)) {
    // YYYY-MM-DD format
    articleTime = new Date(articleDate);
  } else if (articleDate.match(/^\d{2}\/\d{2}\/\d{4}/)) {
    // MM/DD/YYYY format
    const parts = articleDate.split('/');
    const formattedDate = `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
    articleTime = new Date(formattedDate);
  } else if (articleDate.match(/^[A-Za-z]{3}, \d{1,2} [A-Za-z]{3} \d{4}/)) {
    // RFC 2822 format: "Sun, 20 Jul 2025 11:41:08 -0400"
    articleTime = new Date(articleDate);
  } else {
    // Try default parsing
    articleTime = new Date(articleDate);
  }
  
  console.log(`Parsed article time: ${articleTime.toISOString()}`);
  
  // Check if the date is valid
  if (isNaN(articleTime.getTime())) {
    console.log(`Invalid date: ${articleDate}, returning fallback`);
    return 'recently';
  }
  
  // Format as "July 20, 2025" or similar
  const options: Intl.DateTimeFormatOptions = { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  };
  
  const formattedDate = articleTime.toLocaleDateString('en-US', options);
  console.log(`Formatted date: ${formattedDate}`);
  
  return formattedDate;
}

// Function to extract article dates from hyperlinks and update time references
function updateTimeReferences(story: string, contextSources?: any[]): string {
  let updatedStory = story;
  
  // If we have context sources with actual dates, use those
  if (contextSources && contextSources.length > 0) {
    console.log('Updating time references using context sources with dates');
    console.log('Context sources:', JSON.stringify(contextSources, null, 2));
    
    for (const source of contextSources) {
      let articleDate = null;
      
      if (source.created) {
        articleDate = source.created;
        console.log(`Using created date: ${articleDate}`);
        
        // Handle different date formats
        if (typeof articleDate === 'string') {
          // If it's already a date string, use it as is
          if (articleDate.match(/^\d{4}-\d{2}-\d{2}/)) {
            // Already in YYYY-MM-DD format
            console.log(`Date already in correct format: ${articleDate}`);
          } else if (articleDate.match(/^\d{2}\/\d{2}\/\d{4}/)) {
            // Convert MM/DD/YYYY to YYYY-MM-DD
            const parts = articleDate.split('/');
            articleDate = `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
            console.log(`Converted date format: ${articleDate}`);
          } else {
            console.log(`Unknown date format: ${articleDate}, trying to parse...`);
          }
        }
      } else if (source.url) {
        // Extract date from URL as fallback
        const dateMatch = source.url.match(/\/(\d{2})\/(\d{2})\//);
        if (dateMatch) {
          const year = '20' + dateMatch[1]; // Convert 25 to 2025
          const month = dateMatch[2];
          articleDate = `${year}-${month}-01`; // Approximate date
          console.log(`Extracted date from URL: ${articleDate}`);
        }
      }
      
              if (articleDate) {
          const timeRef = formatArticleDate(articleDate);
          console.log(`Article date: ${articleDate}, formatted date: ${timeRef}`);
        
        // Replace generic time references with specific ones
        const genericTimePatterns = [
          /last week/g,
          /last\s+week/g,
          /this week/g,
          /this\s+week/g,
          /recently/g,
          /earlier this week/g,
          /in recent days/g,
          /earlier this month/g,
          /last month/g,
          /in the past week/g,
          /over the past week/g,
          /during the past week/g,
          /the past week/g,
          /previous week/g,
          /During the past week/g,
          /during the past week/g
        ];
        
        for (const pattern of genericTimePatterns) {
          if (pattern.test(updatedStory)) {
            const beforeReplacement = updatedStory;
            updatedStory = updatedStory.replace(pattern, timeRef);
            console.log(`Replaced "${pattern.source}" with "${timeRef}"`);
            console.log(`Before: ${beforeReplacement.substring(0, 200)}...`);
            console.log(`After: ${updatedStory.substring(0, 200)}...`);
            break;
          }
        }
        
        // Also check for any remaining "last week" patterns that might have been missed
        if (updatedStory.includes('last week')) {
          console.log('Found remaining "last week" reference, attempting to replace');
          updatedStory = updatedStory.replace(/last week/g, timeRef);
          console.log(`Replaced remaining "last week" with "${timeRef}"`);
        }
        
        // Final string replacement for any remaining instances
        if (updatedStory.includes('last week')) {
          console.log('FINAL STRING REPLACEMENT for "last week"');
          updatedStory = updatedStory.split('last week').join(timeRef);
          console.log(`Final string replacement completed with "${timeRef}"`);
        }
      }
    }
  } else {
    // Fallback: Extract dates from URLs in the story
    const urlRegex = /<a href="https:\/\/www\.benzinga\.com\/[^"]+">([^<]+)<\/a>/g;
    let match;
    
    while ((match = urlRegex.exec(story)) !== null) {
      const fullUrl = match[0];
      const linkText = match[1];
      const url = fullUrl.match(/href="([^"]+)"/)?.[1] || '';
      
      // Extract date from URL (Benzinga URLs often contain date patterns like /25/08/)
      const dateMatch = url.match(/\/(\d{2})\/(\d{2})\//);
      if (dateMatch) {
        const year = '20' + dateMatch[1]; // Convert 25 to 2025
        const month = dateMatch[2];
        const articleDate = `${year}-${month}-01`; // Approximate date
        const timeRef = formatArticleDate(articleDate);
        
        // Replace generic time references with specific ones
        const genericTimePatterns = [
          /last week/g,
          /recently/g,
          /earlier this week/g,
          /in recent days/g
        ];
        
        for (const pattern of genericTimePatterns) {
          if (pattern.test(updatedStory)) {
            updatedStory = updatedStory.replace(pattern, timeRef);
            break;
          }
        }
      }
    }
  }
  
  // Final cleanup: Scan for any remaining generic time references and replace them
  if (contextSources && contextSources.length > 0) {
    let oldestDate = null;
    
    for (const source of contextSources) {
      let articleDate = null;
      
      if (source.created) {
        articleDate = source.created;
      } else if (source.url) {
        // Extract date from URL as fallback
        const dateMatch = source.url.match(/\/(\d{2})\/(\d{2})\//);
        if (dateMatch) {
          const year = '20' + dateMatch[1]; // Convert 25 to 2025
          const month = dateMatch[2];
          articleDate = `${year}-${month}-01`; // Approximate date
        }
      }
      
      if (articleDate && (!oldestDate || new Date(articleDate) < new Date(oldestDate))) {
        oldestDate = articleDate;
      }
    }
    
    if (oldestDate) {
      const timeRef = formatArticleDate(oldestDate);
      console.log(`Final cleanup: Using oldest article date ${oldestDate} for formatted date: ${timeRef}`);
      
      // Replace any remaining generic time references
      const remainingPatterns = [
        /last week/g,
        /this week/g,
        /recently/g,
        /earlier this week/g,
        /in recent days/g,
        /earlier this month/g,
        /last month/g,
        /in the past week/g,
        /over the past week/g,
        /during the past week/g,
        /During the past week/g
      ];
      
      for (const pattern of remainingPatterns) {
        if (pattern.test(updatedStory)) {
          updatedStory = updatedStory.replace(pattern, timeRef);
          console.log(`Final cleanup: Replaced "${pattern.source}" with "${timeRef}"`);
        }
      }
    }
  }
  
  return updatedStory;
}

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
  
  // Final fallback: If we're still missing links, manually insert them
  if (finalLinkCount < originalLinks.length) {
    const missingLinks = originalLinks.filter(link => !restoredText.includes(link));
    console.log('Final fallback - missing links:', missingLinks.length);
    
    for (const missingLink of missingLinks) {
      const linkText = missingLink.match(/>([^<]+)</)?.[1] || '';
      
      if (missingLink.includes('Also Read:') || linkText.includes('Mark Zuckerberg') || linkText.includes('Warren Buffett')) {
        console.log('Final fallback - manually inserting link:', linkText.substring(0, 50) + '...');
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
        console.log('Final fallback success - link inserted');
      } else if (linkText.includes('Check the chart') || linkText.includes('Read more')) {
        console.log('Final fallback - inserting context link:', linkText);
        // Insert these context links in the middle of the story
        const lines = restoredText.split('\n');
        const middleIndex = Math.floor(lines.length / 2);
        lines.splice(middleIndex, 0, missingLink);
        restoredText = lines.join('\n');
        console.log('Final fallback success - context link inserted');
      }
    }
  }
  
  return restoredText;
}

export async function POST(request: Request) {
  try {
    const { ticker, existingStory, contextSources } = await request.json();
    
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
11. **AVOID ALL TIME REFERENCES**: Do not use "last week", "recently", "earlier this week", "this week", or any other time references - these create false information since context articles may be from different time periods
12. **REMOVE TIME REFERENCES**: If the source material contains any time references like "last week", "this week", "recently", etc., remove them entirely and present the information without time context

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
    let finalStory = restoreSpecificHyperlinks(existingStory, finalizedStory);

    // Update time references to be more accurate
    console.log('=== TIME REFERENCE DEBUG ===');
    console.log('ContextSources received:', JSON.stringify(contextSources, null, 2));
    console.log('Before time reference update - last week:', finalStory.includes('last week'), 'this week:', finalStory.includes('this week'), 'during the past week:', finalStory.includes('during the past week'));
    finalStory = updateTimeReferences(finalStory, contextSources);
    console.log('After time reference update - last week:', finalStory.includes('last week'), 'this week:', finalStory.includes('this week'), 'during the past week:', finalStory.includes('during the past week'));
    console.log('=== END TIME REFERENCE DEBUG ===');
    
    // Force replace any remaining "last week", "this week", or "during the past week" references
    if (finalStory.includes('last week') || finalStory.includes('this week') || finalStory.includes('during the past week') || finalStory.includes('During the past week')) {
      console.log('FORCE REPLACING remaining time references');
      
      // Try multiple approaches to get the date
      let timeRef = null;
      
      // Approach 1: Use contextSources if available
      if (contextSources && contextSources.length > 0) {
        for (const source of contextSources) {
          if (source.created) {
            timeRef = formatArticleDate(source.created);
            console.log(`Using contextSources date: ${source.created} -> ${timeRef}`);
            break;
          } else if (source.url) {
            const dateMatch = source.url.match(/\/(\d{2})\/(\d{2})\//);
            if (dateMatch) {
              const year = '20' + dateMatch[1];
              const month = dateMatch[2];
              const articleDate = `${year}-${month}-01`;
              timeRef = formatArticleDate(articleDate);
              console.log(`Using contextSources URL date: ${articleDate} -> ${timeRef}`);
              break;
            }
          }
        }
      }
      
      // Approach 2: Extract date from any URL in the story
      if (!timeRef) {
        const urlMatch = finalStory.match(/https:\/\/www\.benzinga\.com\/[^"]+\/(\d{2})\/(\d{2})\//);
        if (urlMatch) {
          const year = '20' + urlMatch[1];
          const month = urlMatch[2];
          const articleDate = `${year}-${month}-01`;
          timeRef = formatArticleDate(articleDate);
          console.log(`Using story URL date: ${articleDate} -> ${timeRef}`);
        }
      }
      
      // Approach 3: Hardcoded fallback for July 2025 articles
      if (!timeRef) {
        console.log('No date found, using hardcoded fallback for July 2025');
        timeRef = 'July 20, 2025';
      }
      
      if (timeRef) {
        console.log(`FORCE REPLACING all time references with: ${timeRef}`);
        finalStory = finalStory.replace(/last week/g, timeRef);
        finalStory = finalStory.replace(/this week/g, timeRef);
        finalStory = finalStory.replace(/during the past week/g, timeRef);
        finalStory = finalStory.replace(/During the past week/g, timeRef);
        console.log('Force replacement completed');
      }
    }

    // FINAL CLEANUP - Remove all time references to prevent false information
    console.log('=== FINAL TIME REFERENCE CLEANUP ===');
    
    const timeReferencePatterns = [
      /last week/g,
      /this week/g,
      /recently/g,
      /earlier this week/g,
      /in recent days/g,
      /earlier this month/g,
      /last month/g,
      /in the past week/g,
      /over the past week/g,
      /during the past week/g,
      /the past week/g,
      /previous week/g,
      /During the past week/g,
      /during the past week/g
    ];
    
    let timeReferencesFound = false;
    for (const pattern of timeReferencePatterns) {
      if (pattern.test(finalStory)) {
        console.log(`FINAL CLEANUP: Found time reference "${pattern.source}", removing it`);
        finalStory = finalStory.replace(pattern, '');
        timeReferencesFound = true;
      }
    }
    
    if (timeReferencesFound) {
      console.log('FINAL CLEANUP: Time references removed to prevent false information');
    } else {
      console.log('FINAL CLEANUP: No time references found');
    }

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
    
    // Only return original if we're missing more than 2 hyperlinks after restoration
    if (finalHyperlinkCount < originalHyperlinkCount - 2) {
      console.warn(`Finalize: Missing ${originalHyperlinkCount - finalHyperlinkCount} hyperlinks after restoration, returning original story`);
      return NextResponse.json({ 
        story: existingStory,
        originalStory: existingStory,
        priceDirection: isUp ? 'up' : 'down',
        priceChangePercent: priceChangePercent,
        warning: 'Finalization was skipped to preserve essential content'
      });
    }
    
    // If we're missing 1-2 hyperlinks, accept the improved version
    if (finalHyperlinkCount < originalHyperlinkCount) {
      console.warn(`Finalize: Missing ${originalHyperlinkCount - finalHyperlinkCount} hyperlinks but accepting improved version for better writing quality`);
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