import { NextResponse } from 'next/server';
import { parseCSV, processCSVData, calculateTotalPageviews, ProcessedArticle } from '../../../lib/csv-processor';

export async function POST(req: Request) {
  try {
    const { csvText } = await req.json();
    
    if (!csvText || typeof csvText !== 'string') {
      return NextResponse.json(
        { error: 'CSV text is required' },
        { status: 400 }
      );
    }

    // Parse the CSV
    const csvRows = parseCSV(csvText);
    
    if (csvRows.length === 0) {
      return NextResponse.json(
        { error: 'No valid rows found in CSV' },
        { status: 400 }
      );
    }

    // Process and deduplicate articles
    const processedArticles = processCSVData(csvRows);
    
    // Calculate totals
    const totalPageviews = calculateTotalPageviews(processedArticles);
    const originalRowCount = csvRows.length;
    const uniqueArticleCount = processedArticles.length;
    
    // Calculate what the total would have been without deduplication (for comparison)
    const incorrectTotal = csvRows.reduce((sum, row) => sum + row.page_views, 0);
    const difference = incorrectTotal - totalPageviews;
    const multiplier = incorrectTotal / totalPageviews;

    return NextResponse.json({
      summary: {
        originalRowCount,
        uniqueArticleCount,
        totalPageviews,
        incorrectTotalIfNotDeduplicated: incorrectTotal,
        difference,
        multiplier: multiplier.toFixed(2),
        message: `Without deduplication, pageviews would be ${multiplier.toFixed(2)}x higher`
      },
      articles: processedArticles,
    });
  } catch (error: any) {
    console.error('Error processing CSV:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to process CSV' },
      { status: 500 }
    );
  }
}


