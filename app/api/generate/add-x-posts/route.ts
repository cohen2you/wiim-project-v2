import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: Request) {
  try {
    const { ticker, existingStory, selectedPosts } = await req.json();
    
    if (!ticker || !existingStory) {
      return NextResponse.json({ error: 'Ticker and existing story are required' }, { status: 400 });
    }

    if (!selectedPosts || !Array.isArray(selectedPosts) || selectedPosts.length === 0) {
      return NextResponse.json({ error: 'Selected posts are required' }, { status: 400 });
    }

    // Format the selected posts for the AI
    const postsText = selectedPosts.map((post: any, index: number) => {
      return `
Post ${index + 1}:
Author: ${post.author?.name || 'Unknown'} (@${post.author?.username || 'unknown'})
Date: ${post.created_at}
Content: ${post.text}
URL: ${post.url}
Engagement: ${post.metrics.retweet_count || 0} retweets, ${post.metrics.like_count || 0} likes
`;
    }).join('\n\n');

    const prompt = `You are a financial journalist. You have an existing story and ${selectedPosts.length} selected X posts about ${ticker}. Your task is to intelligently integrate content from these X posts into the existing story.

EXISTING STORY:
${existingStory}

SELECTED X POSTS:
${postsText}

CRITICAL TASK: You MUST integrate content from the selected X posts with hyperlinks throughout the story.

INSTRUCTIONS:
1. Review the existing story and identify where to integrate content from the selected X posts
2. Distribute the hyperlinks naturally throughout the story paragraphs
3. Each integration should be MAXIMUM 2 sentences from each X post source
4. Weave the content naturally into existing paragraphs - do NOT create standalone hyperlink lines
5. Use this exact hyperlink format: <a href="[X_POST_URL]">[three word phrase]</a>
6. Maintain the two-sentence-per-paragraph rule throughout
7. Focus on market sentiment, investor reactions, or relevant social media commentary
8. Make the integrations feel natural and enhance the story's flow
9. Do NOT reference "X posts" or "social media" - just embed the hyperlinks naturally
10. Ensure all prices are formatted to exactly 2 decimal places
11. DO NOT use phrases like "according to X" or "as posted on social media" - these are awkward
12. Integrate the content directly without attribution phrases

MANDATORY HYPERLINK REQUIREMENTS:
${selectedPosts.map((post: any, index: number) => 
  `- X Post ${index + 1} URL: ${post.url} - MUST be used with hyperlink format: <a href="${post.url}">[three word phrase]</a>`
).join('\n')}

HYPERLINK INTEGRATION RULES:
- Integrate content naturally without attribution phrases
- Avoid phrases like "according to X" or "as posted on social media"
- Present information directly as factual content
- Distribute hyperlinks throughout the story, not all in one place
- Use phrases like "market sentiment", "investor reactions", "social commentary", "trading community"

CRITICAL RULES:
- Maximum 2 sentences per X post integration
- No standalone hyperlink lines
- Maintain existing story structure and flow
- Format all prices to exactly 2 decimal places
- Integrate hyperlinks into existing paragraphs, don't add new paragraphs
- PRESERVE ALL EXISTING HYPERLINKS - Do not remove or modify any existing hyperlinks in the story

VERIFICATION: Before submitting, ensure all selected X post URLs are included as hyperlinks.

Return the complete enhanced story with integrated X post context:`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are a professional financial journalist who integrates social media sentiment and market commentary into news stories naturally and professionally.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 4000
    });

    const enhancedStory = completion.choices[0]?.message?.content?.trim();
    
    if (!enhancedStory) {
      throw new Error('Failed to generate enhanced story');
    }

    return NextResponse.json({ 
      story: enhancedStory,
      postsUsed: selectedPosts.length
    });

  } catch (error: any) {
    console.error('Error adding X posts to story:', error);
    return NextResponse.json({ 
      error: error.message || 'Failed to add X posts to story' 
    }, { status: 500 });
  }
}
