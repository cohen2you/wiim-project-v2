import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { preserveHyperlinks } from '../../../../lib/hyperlink-preservation';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { ticker, existingStory, selectedArticles } = await req.json();
    
    if (!ticker) {
      return NextResponse.json({ error: 'Ticker is required' }, { status: 400 });
    }
    
    if (!existingStory) {
      return NextResponse.json({ error: 'Existing story is required' }, { status: 400 });
    }
    
    if (!selectedArticles || !Array.isArray(selectedArticles) || selectedArticles.length === 0) {
      return NextResponse.json({ error: 'Selected articles are required' }, { status: 400 });
    }

    // Format the selected articles for the prompt
    const articlesText = selectedArticles.map((article: any, index: number) => {
      return `${index + 1}. ${article.headline}\n   Date: ${new Date(article.created).toLocaleDateString()}\n   URL: ${article.url}\n   Summary: ${article.body.substring(0, 300)}...`;
    }).join('\n\n');

    const prompt = `You are a financial journalist. You have an existing story and ${selectedArticles.length} selected news articles about ${ticker}. Your task is to intelligently integrate content from these articles into the existing story.

EXISTING STORY:
${existingStory}

SELECTED ARTICLES:
${articlesText}

CRITICAL TASK: You MUST integrate content from the selected articles with hyperlinks throughout the story.

INSTRUCTIONS:
1. Review the existing story and identify where to integrate content from the selected articles
2. Distribute the hyperlinks naturally throughout the story paragraphs
3. Each integration should be MAXIMUM 2 sentences from each article source
4. Weave the content naturally into existing paragraphs - do NOT create standalone hyperlink lines
5. Use this exact hyperlink format: <a href="[URL]">[three word phrase]</a>
6. Maintain the two-sentence-per-paragraph rule throughout
7. Focus on technical data, market context, or relevant business developments
8. Make the integrations feel natural and enhance the story's flow
9. Do NOT reference "recent articles" or similar phrases - just embed the hyperlinks naturally
10. Ensure all prices are formatted to exactly 2 decimal places
11. DO NOT use phrases like "according to Benzinga" or "according to recent reports" - these are awkward since this is for Benzinga
12. Integrate the content directly without attribution phrases

MANDATORY HYPERLINK REQUIREMENTS:
${selectedArticles.map((article: any, index: number) => 
  `- Article ${index + 1} URL: ${article.url} - MUST be used with hyperlink format: <a href="${article.url}">[three word phrase]</a>`
).join('\n')}

HYPERLINK INTEGRATION RULES:
- Integrate content naturally without attribution phrases
- Avoid phrases like "according to Benzinga" or "according to recent reports"
- Present information directly as factual content
- Distribute hyperlinks throughout the story, not all in one place

CRITICAL RULES:
- Maximum 2 sentences per article integration
- No standalone hyperlink lines
- Maintain existing story structure and flow
- Format all prices to exactly 2 decimal places
- Integrate hyperlinks into existing paragraphs, don't add new paragraphs

VERIFICATION: Before submitting, ensure all selected article URLs are included as hyperlinks.

Return the complete enhanced story with integrated context:`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are a professional financial news writer who creates engaging, accurate content with proper hyperlinks."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 500,
    });

    const enhancedStory = completion.choices[0]?.message?.content?.trim();
    
    if (!enhancedStory) {
      throw new Error('Failed to generate enhanced story');
    }

    // Debug: Count hyperlinks in the result
    const hyperlinkCount = (enhancedStory.match(/<a href=/g) || []).length;
    console.log(`Enhanced story hyperlink count: ${hyperlinkCount}`);
    selectedArticles.forEach((article: any, index: number) => {
      console.log(`Article ${index + 1} URL appears: ${enhancedStory.includes(article.url)}`);
    });

    // Preserve existing hyperlinks
    const finalStory = preserveHyperlinks(existingStory, enhancedStory);

    return NextResponse.json({ 
      story: finalStory,
      contextSources: selectedArticles.map((article: any) => ({
        headline: article.headline,
        url: article.url
      }))
    });

  } catch (error: any) {
    console.error('Error generating custom context:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to generate custom context' },
      { status: 500 }
    );
  }
} 