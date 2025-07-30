import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function cleanH2(text: string) {
  // Remove markdown **, ##, or other symbols, trim, and capitalize each word
  const noMarkdown = text.replace(/\*\*/g, '').replace(/^##\s*/, '').trim();
  return noMarkdown
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export async function POST(request: Request) {
  try {
    const { articleText } = await request.json();

    if (!articleText?.trim()) {
      return NextResponse.json({ articleWithH2s: '', error: 'Article text is required.' });
    }

    const prompt = `
    You Are A Top-Tier Financial Journalist Writing For A Leading Financial News Website.
    
    Given The Article Below, Generate Exactly 3 Standalone Mini Headlines (H2s) That Serve As Compelling Section Introductions.
    
    CRITICAL REQUIREMENTS:
    - Generate EXACTLY 3 standalone mini headlines - no more, no less.
    - Each H2 must be a standalone mini headline that provides specific perspective on the content that follows.
    - H2s should be 4-8 words maximum for maximum impact.
    - Each H2 must be unique in structure and style - use variety:
      * One could be a bold statement or insight
      * One could be a question that creates curiosity
      * One could be a "How to" or "Why" format
      * One could be a data-driven observation
      * One could be a trend or pattern identifier
    - Make each H2 highly engaging and clickable - they should make readers want to continue reading.
    - Focus on specific insights, trends, or actionable information rather than generic topics.
    - Use strong, active language that conveys authority and expertise.
    - Avoid bland, obvious, or generic headings like "Market Analysis" or "Technical Insights".
    - Each H2 should preview a specific angle or insight that will be explored in that section.
    - Capitalize the first letter of every word in each H2 heading.
    - Ensure each H2 provides a unique perspective that adds value to the reader's understanding.
    
    EXAMPLES OF GOOD H2s:
    - Why This Rally Defies Market Logic
    - The Hidden Signal Wall Street Missed
    - Three Catalysts Driving This Surge
    - How Smart Money Is Positioning Now
    - The Technical Breakdown That Changes Everything
    - Why Analysts Are Suddenly Bullish
    - The Volume Pattern That Reveals All
    - Three Reasons This Dip Is Different
    
    EXAMPLES OF BAD H2s (avoid these):
    - Market Analysis (too generic)
    - Technical Insights (too vague)
    - Investment Strategy (too broad)
    - Risk Factors (too obvious)
    
    Article:
    ${articleText}
    
    Generate 3 Standalone Subheads:
    `.trim();
    

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0.8,
    });

    const h2Headings = completion.choices[0].message?.content?.trim() ?? '';

    // Clean and extract the H2 headings
    const lines = h2Headings.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    // Extract the first 3 valid H2 headings
    const extractedH2s: string[] = [];
    for (const line of lines) {
      if (extractedH2s.length >= 3) break;
      
      // Clean the line and check if it looks like a valid H2
      const cleanedLine = cleanH2(line);
      if (
        cleanedLine &&
        cleanedLine.length >= 10 && // Minimum length for a meaningful headline
        cleanedLine.length <= 60 && // Maximum length for readability
        !cleanedLine.includes('Article:') &&
        !cleanedLine.includes('Generate') &&
        !cleanedLine.includes('Examples') &&
        !cleanedLine.includes('CRITICAL') &&
        !cleanedLine.includes('REQUIREMENTS')
      ) {
        extractedH2s.push(cleanedLine);
      }
    }

    // If we don't have exactly 3 H2s, generate fallbacks
    const fallbackH2s = [
      'Why This Move Changes Everything',
      'The Hidden Signal Smart Money Sees',
      'Three Catalysts Driving This Action',
      'How Wall Street Is Positioning Now',
      'The Technical Pattern That Reveals All',
      'Why Analysts Are Suddenly Bullish',
      'The Volume Surge That Changes Everything',
      'Three Reasons This Rally Is Different'
    ];

    // Build final H2s array
    const finalH2s = [...extractedH2s];
    for (let i = finalH2s.length; i < 3; i++) {
      const fallbackIndex = (i - extractedH2s.length) % fallbackH2s.length;
      finalH2s.push(fallbackH2s[fallbackIndex]);
    }

    // Create the article with H2s embedded
    const articleLines = articleText.split('\n');
    const articleWithH2s = embedH2sInArticle(articleLines, finalH2s);

    return NextResponse.json({ 
      articleWithH2s,
      h2HeadingsOnly: finalH2s 
    });
  } catch (error) {
    console.error('Error generating H2 headings:', error);
    return NextResponse.json({ articleWithH2s: '', error: 'Failed to generate H2 headings.' }, { status: 500 });
  }
}

function embedH2sInArticle(articleLines: string[], h2s: string[]): string {
  // Simple embedding logic - insert H2s at natural break points
  const totalLines = articleLines.length;
  const h2Positions = [
    Math.floor(totalLines * 0.2), // After ~20% of content
    Math.floor(totalLines * 0.5), // After ~50% of content  
    Math.floor(totalLines * 0.8)  // After ~80% of content
  ];

  const result: string[] = [];
  let h2Index = 0;

  for (let i = 0; i < articleLines.length; i++) {
    result.push(articleLines[i]);
    
    // Insert H2 if we're at a position and have H2s left
    if (h2Index < h2s.length && i === h2Positions[h2Index]) {
      result.push(''); // Empty line before H2
      result.push(h2s[h2Index]);
      result.push(''); // Empty line after H2
      h2Index++;
    }
  }

  return result.join('\n');
} 