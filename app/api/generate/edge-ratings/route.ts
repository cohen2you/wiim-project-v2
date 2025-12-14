import { NextResponse } from 'next/server';

const BENZINGA_EDGE_API_KEY = process.env.BENZINGA_EDGE_API_KEY!;

interface EdgeRatings {
  ticker: string;
  value_rank?: number;
  growth_rank?: number;
  quality_rank?: number;
  momentum_rank?: number;
  value_score?: number;
  growth_score?: number;
  quality_score?: number;
  momentum_score?: number;
}

async function fetchEdgeRatings(ticker: string): Promise<EdgeRatings | null> {
  try {
    // Benzinga Edge API endpoint for stock ratings
    const url = `https://api.benzinga.com/api/v2/edge/stock/${encodeURIComponent(ticker)}?token=${BENZINGA_EDGE_API_KEY}`;
    
    console.log('Edge Ratings: Fetching from:', url);
    const response = await fetch(url, {
      headers: { 
        'Accept': 'application/json',
        'Authorization': `Bearer ${BENZINGA_EDGE_API_KEY}`
      },
    });
    
    if (!response.ok) {
      console.error('Edge Ratings: API failed:', response.status, await response.text());
      return null;
    }
    
    const data = await response.json();
    console.log('Edge Ratings: Response:', data);
    
    // Extract the relevant ratings data
    const edgeData: EdgeRatings = {
      ticker: ticker.toUpperCase(),
      value_rank: data.value_rank || data.valueRank,
      growth_rank: data.growth_rank || data.growthRank,
      quality_rank: data.quality_rank || data.qualityRank,
      momentum_rank: data.momentum_rank || data.momentumRank,
      value_score: data.value_score || data.valueScore,
      growth_score: data.growth_score || data.growthScore,
      quality_score: data.quality_score || data.qualityScore,
      momentum_score: data.momentum_score || data.momentumScore,
    };
    
    console.log('Edge Ratings: Processed data:', edgeData);
    return edgeData;
  } catch (error) {
    console.error('Error fetching Edge ratings:', error);
    return null;
  }
}

function formatEdgeRatings(edgeData: EdgeRatings): string {
  const ratings = [];
  
  if (edgeData.value_rank !== undefined) {
    ratings.push(`Value: ${edgeData.value_rank}`);
  }
  if (edgeData.growth_rank !== undefined) {
    ratings.push(`Growth: ${edgeData.growth_rank}`);
  }
  if (edgeData.quality_rank !== undefined) {
    ratings.push(`Quality: ${edgeData.quality_rank}`);
  }
  if (edgeData.momentum_rank !== undefined) {
    ratings.push(`Momentum: ${edgeData.momentum_rank}`);
  }
  
  return ratings.length > 0 ? ratings.join(', ') : 'No Edge ratings available';
}

export async function POST(request: Request) {
  try {
    const { ticker } = await request.json();
    
    if (!ticker) {
      return NextResponse.json({ error: 'Ticker is required.' }, { status: 400 });
    }

    const edgeData = await fetchEdgeRatings(ticker);
    
    if (!edgeData) {
      return NextResponse.json({ 
        edgeRatings: 'No Edge ratings available',
        edgeData: null 
      });
    }

    const formattedRatings = formatEdgeRatings(edgeData);
    
    console.log('Edge Ratings: Successfully fetched and formatted ratings');

    return NextResponse.json({ 
      edgeRatings: formattedRatings,
      edgeData
    });
  } catch (error: any) {
    console.error('Error in Edge ratings route:', error);
    return NextResponse.json({ 
      error: error.message || 'Failed to fetch Edge ratings.',
      edgeRatings: 'No Edge ratings available',
      edgeData: null
    }, { status: 500 });
  }
} 