import { NextResponse } from 'next/server';
import { aiProvider, AIProvider } from '@/lib/aiProvider';

// Programmatic H2 insertion for WGO Concise format
function insertH2sProgrammatically(articleText: string): string {
  // Find the position of "The Details" section
  const detailsMatch = articleText.match(/(The Details|## The Details)/i);
  if (!detailsMatch) {
    // No "The Details" section found, try AI approach
    return articleText;
  }
  
  const detailsIndex = detailsMatch.index || 0;
  const leadSection = articleText.substring(0, detailsIndex).trim();
  
  // Check if there are multiple paragraphs in the lead section
  const paragraphs = leadSection.split(/\n\n+/).filter(p => p.trim().length > 0);
  
  // If there's only the lead paragraph, insert H2s before "The Details"
  if (paragraphs.length <= 1) {
    // Generate H2s using AI for the lead content
    // For now, return original - we'll use AI for this
    return articleText;
  }
  
  // If there are multiple paragraphs, we can insert H2s between them
  // This will be handled by AI
  return articleText;
}

export async function POST(request: Request) {
  try {
    const { articleText } = await request.json();

    console.log('[SEO SUBHEADS] Request received');
    console.log('[SEO SUBHEADS] Article length:', articleText?.length || 0);
    console.log('[SEO SUBHEADS] Article preview:', articleText?.substring(0, 200) || 'N/A');

    if (!articleText || !articleText.trim()) {
      console.error('[SEO SUBHEADS] Error: Article text is required');
      return NextResponse.json(
        { error: 'Article text is required' },
        { status: 400 }
      );
    }

    // Check if this is a WGO Concise format (has "The Details" section)
    const isWGOConcise = articleText.includes('The Details') || articleText.includes('Technical & Market Profile');
    console.log('[SEO SUBHEADS] Is WGO Concise format:', isWGOConcise);
    
    // Use OpenAI as default provider for SEO optimization
    aiProvider.setProvider('openai');
    const currentProvider = aiProvider.getCurrentProvider();
    console.log('[SEO SUBHEADS] Using provider:', currentProvider);

    const prompt = isWGOConcise 
      ? `You are an SEO tag insertion tool. Your ONLY task is to add 2-3 HTML <h2> tags to this WGO Concise format article.

ABSOLUTE RULES:
1. DO NOT modify, rewrite, or change ANY existing text
2. DO NOT add new paragraphs or content
3. ONLY insert <h2>Your Heading</h2> tags
4. Preserve ALL structure including "The Details" and "Technical & Market Profile" sections exactly

WHERE TO ADD H2s FOR WGO CONCISE:
- Insert 2-3 H2s right after the Lead paragraph, even if "The Details" section comes immediately after
- Format: [Lead paragraph]\n\n<h2>First Heading</h2>\n\n<h2>Second Heading</h2>\n\nThe Details
- You may also insert 1 H2 before the bullet points in "The Details" section (after "The Details" header, before the first bullet)
- NEVER modify bullet points, tables, or section headers
- ALWAYS preserve "The Details" and "Technical & Market Profile" section headers exactly as they are

H2 FORMAT:
- <h2>4-8 Word SEO Heading</h2>
- Blank lines before and after
- Use keywords from the article

Article:
${articleText}

Return the EXACT article with ONLY <h2> tags inserted. No other changes.`
      : `You are an SEO optimization expert. Your ONLY task is to add HTML <h2> tags to the provided article. You MUST NOT modify, rewrite, or reformat ANY existing content.

ABSOLUTE RULES - NO EXCEPTIONS:
1. DO NOT change any existing text, paragraphs, or structure
2. DO NOT rewrite or rephrase any content
3. DO NOT add new paragraphs or content
4. DO NOT remove any existing content
5. ONLY add <h2>Your Heading</h2> tags between existing paragraphs
6. Preserve ALL existing formatting, bullet points, tables, and structure exactly as provided

WHERE TO ADD H2s:
- Add 2-3 H2s at natural content breakpoints
- Place H2s between paragraphs, not within them
- Ensure each H2 has content following it

H2 FORMAT:
- Use: <h2>Your Heading Text</h2>
- 4-8 words maximum
- SEO-friendly keywords
- Place on its own line with blank lines before and after

Article (DO NOT MODIFY - ONLY ADD H2 TAGS):
${articleText}

Return the EXACT same article with ONLY <h2> tags added between existing paragraphs. Do NOT change, rewrite, or reformat anything else.`;

    const systemPrompt = `You are an SEO optimization tool. Your ONLY function is to insert HTML <h2> tags into articles. 

ABSOLUTE REQUIREMENTS:
1. NEVER modify, rewrite, or change any existing text
2. NEVER add new content or paragraphs
3. NEVER remove existing content
4. ONLY insert <h2> tags between existing paragraphs
5. Preserve ALL existing structure, formatting, section headers, bullet points, and tables exactly as provided
6. If you cannot add H2s without modifying content, return the article unchanged

You are a tool, not a writer. Insert tags only. Do not rewrite.`;

    const result = await aiProvider.generateCompletion(
      [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      {
        model: currentProvider === 'gemini' ? 'gemini-2.5-flash' : 'gpt-4o-mini',
        temperature: 0.1, // Lower temperature for more deterministic, less creative output
        maxTokens: 2000,
      },
      currentProvider
    );

    let optimizedText = result.content.trim();
    console.log('[SEO SUBHEADS] AI response received, length:', optimizedText.length);
    console.log('[SEO SUBHEADS] AI response preview:', optimizedText.substring(0, 300));

    // Clean up the response
    // Remove markdown code block wrappers if present
    optimizedText = optimizedText.replace(/^```markdown\s*/i, '').replace(/\s*```$/i, '');
    optimizedText = optimizedText.replace(/^```\s*/, '').replace(/\s*```$/, '');
    console.log('[SEO SUBHEADS] After markdown cleanup, length:', optimizedText.length);
    
    // Validation: Check if critical structural elements are preserved
    const originalHasDetails = articleText.includes('The Details') || articleText.includes('## The Details');
    const originalHasTechnical = articleText.includes('Technical & Market Profile') || articleText.includes('Technical & Market Profile');
    const optimizedHasDetails = optimizedText.includes('The Details') || optimizedText.includes('## The Details');
    const optimizedHasTechnical = optimizedText.includes('Technical & Market Profile') || optimizedText.includes('Technical & Market Profile');
    
    console.log('[SEO SUBHEADS] Structure check - Original Details:', originalHasDetails, 'Optimized Details:', optimizedHasDetails);
    console.log('[SEO SUBHEADS] Structure check - Original Technical:', originalHasTechnical, 'Optimized Technical:', optimizedHasTechnical);
    
    // If structure was broken, return original with minimal H2 insertion
    if ((originalHasDetails && !optimizedHasDetails) || (originalHasTechnical && !optimizedHasTechnical)) {
      console.warn('[SEO SUBHEADS] Structure was modified, using fallback approach');
      // Fallback: Just insert H2s programmatically without AI rewriting
      return NextResponse.json({
        optimizedText: articleText, // Return original if structure was broken
        success: true,
        warning: 'Structure preservation failed, returned original article'
      });
    }
    
    // Check if H2s were actually added
    const h2Count = (optimizedText.match(/<h2>/gi) || []).length;
    console.log('[SEO SUBHEADS] H2 tags found in output:', h2Count);

    // Ensure H2 tags are properly formatted
    // Convert markdown H2 (## Heading) to HTML H2 if needed
    optimizedText = optimizedText.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
    
    // Ensure proper spacing around H2 tags
    // Add blank line before <h2> if not present
    optimizedText = optimizedText.replace(/([^\n])\n<h2>/g, '$1\n\n<h2>');
    // Add blank line after </h2> if not present
    optimizedText = optimizedText.replace(/<\/h2>\n([^\n])/g, '</h2>\n\n$1');
    
    // Remove trailing "..." if it exists
    optimizedText = optimizedText.replace(/\s*\.{3,}\s*$/, '').trim();
    
    // Clean up any double blank lines (more than 2 consecutive newlines)
    optimizedText = optimizedText.replace(/\n{3,}/g, '\n\n');
    
    // Post-processing: Remove H2s that are orphaned (right before structural sections or at the end)
    // For WGO Concise format, ALLOW H2s before "The Details" - they're intentionally placed there
    if (!isWGOConcise) {
      // Remove H2s immediately before "The Details" for non-WGO formats only
      optimizedText = optimizedText.replace(/\n*<h2>.*?<\/h2>\n*\n*(The Details|## The Details)/gi, '\n\n$1');
    }
    // For WGO Concise, we want H2s before "The Details", so don't remove them
    
    // Remove H2s immediately before "Executive Insight"
    optimizedText = optimizedText.replace(/\n*<h2>.*?<\/h2>\n*\n*(Executive Insight|## Executive Insight)/gi, '\n\n$1');
    
    // Remove H2s immediately before "Technical & Market Profile" or "Technical & Market Profile"
    optimizedText = optimizedText.replace(/\n*<h2>.*?<\/h2>\n*\n*(Technical & Market Profile|Technical & Market Profile|## Technical)/gi, '\n\n$1');
    
    // Remove H2s at the very end of the article (after the last structural section)
    // This handles cases where H2 appears after "Technical & Market Profile" or at the end
    optimizedText = optimizedText.replace(/\n*<h2>.*?<\/h2>\s*$/gm, '');
    
    // Remove H2s that are followed only by whitespace and then another structural section
    optimizedText = optimizedText.replace(/\n*<h2>.*?<\/h2>\n+\s*(The Details|Executive Insight|Technical & Market Profile|##)/gi, '\n\n$1');
    
    // Final H2 count check
    const finalH2Count = (optimizedText.match(/<h2>/gi) || []).length;
    console.log('[SEO SUBHEADS] Final H2 count after post-processing:', finalH2Count);
    console.log('[SEO SUBHEADS] Final output preview:', optimizedText.substring(0, 500));

    return NextResponse.json({
      optimizedText,
      success: true,
      h2Count: finalH2Count
    });

  } catch (error: any) {
    console.error('Error generating SEO subheads:', error);
    return NextResponse.json(
      { 
        error: error.message || 'Failed to generate SEO subheads',
        success: false
      },
      { status: 500 }
    );
  }
}
