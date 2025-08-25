import { NextResponse } from 'next/server';

const X_BEARER_TOKEN = process.env.X_BEARER_TOKEN!;
const X_API_URL = 'https://api.twitter.com/2/tweets/search/recent';

export async function POST(req: Request) {
  try {
    const { topic, count = 10, minFollowers = 1000 } = await req.json();
    
    if (!topic) {
      return NextResponse.json({ error: 'Topic is required' }, { status: 400 });
    }
    
    if (!X_BEARER_TOKEN) {
      return NextResponse.json({ error: 'X Bearer Token not configured' }, { status: 500 });
    }

    // Construct search query - you can customize this based on your needs
    const searchQuery = `${topic} -is:retweet lang:en`;
    
    const searchUrl = `${X_API_URL}?query=${encodeURIComponent(searchQuery)}&max_results=${Math.min(count * 3, 100)}&tweet.fields=created_at,author_id,public_metrics,context_annotations&user.fields=username,name,verified,public_metrics&expansions=author_id&media.fields=url,preview_image_url`;
    
    console.log('Fetching X posts for topic:', topic);
    console.log('X API URL:', searchUrl);
    
    const response = await fetch(searchUrl, {
      headers: {
        'Authorization': `Bearer ${X_BEARER_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('X API error:', errorText);
      console.error('X API status:', response.status);
      throw new Error(`X API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('X API response:', data);

    if (!data.data || !Array.isArray(data.data)) {
      console.error('X API response (no data):', data);
      return NextResponse.json({ error: 'No tweets found or invalid response format', raw: data }, { status: 500 });
    }

    // Create a map of users for easy lookup
    const usersMap = new Map();
    if (data.includes && data.includes.users) {
      data.includes.users.forEach((user: any) => {
        usersMap.set(user.id, user);
      });
    }

    // Process and filter tweets
    const tweets = data.data
      .filter((tweet: any) => {
        // Filter out tweets that are too short or likely spam
        const text = tweet.text;
        if (!text || text.length <= 20 || text.startsWith('RT @')) {
          return false;
        }
        
        // Filter by follower count
        const user = usersMap.get(tweet.author_id);
        if (user && user.public_metrics && user.public_metrics.followers_count) {
          return user.public_metrics.followers_count >= minFollowers;
        }
        
        return false; // Exclude users without follower data
      })
      .map((tweet: any) => {
        const user = usersMap.get(tweet.author_id);
        return {
          id: tweet.id,
          text: tweet.text,
          created_at: tweet.created_at,
          author: user ? {
            username: user.username,
            name: user.name,
            verified: user.verified,
            followers_count: user.public_metrics?.followers_count || 0
          } : null,
          metrics: tweet.public_metrics || {},
          url: `https://twitter.com/${user?.username || 'unknown'}/status/${tweet.id}`
        };
      })
      .slice(0, count);

    console.log(`Found ${tweets.length} relevant X posts for topic: ${topic}`);
    
    return NextResponse.json({ 
      posts: tweets,
      total_found: tweets.length,
      topic: topic
    });

  } catch (error: any) {
    console.error('Error fetching X posts:', error);
    return NextResponse.json({ 
      error: error.message || 'Failed to fetch X posts' 
    }, { status: 500 });
  }
}
