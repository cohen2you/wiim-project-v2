import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');
    const chartType = searchParams.get('chartType');

    if (!symbol) {
      return NextResponse.json({ error: 'Symbol parameter is required' }, { status: 400 });
    }

    if (!chartType) {
      return NextResponse.json({ error: 'chartType parameter is required' }, { status: 400 });
    }

    // Check if an external chart API URL is configured
    const externalChartApiUrl = process.env.EXTERNAL_CHART_API_URL;
    
    if (externalChartApiUrl) {
      // Proxy to external chart API
      const externalUrl = `${externalChartApiUrl}/api/charts/image?symbol=${encodeURIComponent(symbol)}&chartType=${encodeURIComponent(chartType)}`;
      try {
        const response = await fetch(externalUrl);
        if (response.ok) {
          const imageBuffer = await response.arrayBuffer();
          return new NextResponse(imageBuffer, {
            headers: {
              'Content-Type': response.headers.get('Content-Type') || 'image/png',
              'Cache-Control': 'public, max-age=3600',
            },
          });
        }
      } catch (error) {
        console.error('[CHART API] Error fetching from external API:', error);
        // Fall through to generate placeholder
      }
    }

    // Generate a placeholder SVG chart
    const chartTitle = chartType === 'price-moving-averages' 
      ? 'Price with Moving Averages' 
      : chartType === 'rsi-heatmap' 
      ? 'RSI Heatmap Timeline' 
      : 'Chart';

    const svg = `<svg width="800" height="400" xmlns="http://www.w3.org/2000/svg">
  <rect width="800" height="400" fill="#ffffff" stroke="#e5e7eb" stroke-width="2" rx="8"/>
  <text x="400" y="190" font-family="Arial, sans-serif" font-size="20" font-weight="600" fill="#374151" text-anchor="middle">
    ${chartTitle}
  </text>
  <text x="400" y="220" font-family="Arial, sans-serif" font-size="16" fill="#6b7280" text-anchor="middle">
    ${symbol}
  </text>
  <text x="400" y="250" font-family="Arial, sans-serif" font-size="14" fill="#9ca3af" text-anchor="middle">
    Chart placeholder - Configure chart API for live data
  </text>
</svg>`;

    return new NextResponse(svg, {
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (error) {
    console.error('[CHART API] Error generating chart:', error);
    return NextResponse.json({ error: 'Failed to generate chart' }, { status: 500 });
  }
}
