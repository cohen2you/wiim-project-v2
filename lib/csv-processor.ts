/**
 * CSV Processor for pageview data
 * Deduplicates articles by title and publish_date to avoid multiplying pageviews
 * when articles appear in multiple sections or have multiple referrers
 */

export interface CSVRow {
  author: string;
  publish_date: string;
  referrer: string;
  section: string;
  title: string;
  page_views: number;
}

export interface ProcessedArticle {
  author: string;
  publish_date: string;
  title: string;
  page_views: number;
  sections: string[];
  referrers: string[];
}

/**
 * Processes CSV data and deduplicates articles by title and publish_date
 * Each unique article (title + publish_date) will have its pageviews counted only once
 * Sections and referrers are aggregated as arrays
 */
export function processCSVData(csvData: CSVRow[]): ProcessedArticle[] {
  // Use a Map to deduplicate by title + publish_date
  const articleMap = new Map<string, ProcessedArticle>();

  for (const row of csvData) {
    // Create a unique key from title and publish_date
    const key = `${row.title.trim()}|${row.publish_date.trim()}`;

    if (articleMap.has(key)) {
      // Article already exists - just add section and referrer if not already present
      const existing = articleMap.get(key)!;
      
      if (!existing.sections.includes(row.section)) {
        existing.sections.push(row.section);
      }
      
      if (!existing.referrers.includes(row.referrer)) {
        existing.referrers.push(row.referrer);
      }
      
      // Pageviews should be the same for all rows of the same article
      // If they differ, log a warning and use the maximum value
      if (row.page_views !== existing.page_views) {
        console.warn(
          `Pageview mismatch for article "${row.title}": ` +
          `found ${row.page_views} but already have ${existing.page_views}. ` +
          `Using maximum value.`
        );
        existing.page_views = Math.max(existing.page_views, row.page_views);
      }
    } else {
      // New article - add it to the map
      articleMap.set(key, {
        author: row.author,
        publish_date: row.publish_date.trim(),
        title: row.title.trim(),
        page_views: row.page_views,
        sections: [row.section],
        referrers: [row.referrer],
      });
    }
  }

  // Convert map to array
  const processedArticles = Array.from(articleMap.values());

  // Sort by pageviews descending
  processedArticles.sort((a, b) => b.page_views - a.page_views);

  return processedArticles;
}

/**
 * Parses CSV text into an array of CSVRow objects
 */
export function parseCSV(csvText: string): CSVRow[] {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) {
    return [];
  }

  // Parse header
  const headers = lines[0].split(',').map(h => h.trim());
  
  // Find column indices
  const authorIdx = headers.indexOf('author');
  const publishDateIdx = headers.indexOf('publish_date');
  const referrerIdx = headers.indexOf('referrer');
  const sectionIdx = headers.indexOf('section');
  const titleIdx = headers.indexOf('title');
  const pageViewsIdx = headers.indexOf('page_views');

  if (
    authorIdx === -1 ||
    publishDateIdx === -1 ||
    referrerIdx === -1 ||
    sectionIdx === -1 ||
    titleIdx === -1 ||
    pageViewsIdx === -1
  ) {
    throw new Error('CSV is missing required columns');
  }

  // Parse data rows
  const rows: CSVRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Handle CSV parsing with quoted fields
    const values = parseCSVLine(line);
    
    if (values.length <= Math.max(authorIdx, publishDateIdx, referrerIdx, sectionIdx, titleIdx, pageViewsIdx)) {
      continue; // Skip incomplete rows
    }

    const pageViews = parseInt(values[pageViewsIdx]?.trim() || '0', 10);
    if (isNaN(pageViews)) {
      console.warn(`Invalid pageviews value in row ${i + 1}: ${values[pageViewsIdx]}`);
      continue;
    }

    rows.push({
      author: values[authorIdx]?.trim() || '',
      publish_date: values[publishDateIdx]?.trim() || '',
      referrer: values[referrerIdx]?.trim() || '',
      section: values[sectionIdx]?.trim() || '',
      title: values[titleIdx]?.trim() || '',
      page_views: pageViews,
    });
  }

  return rows;
}

/**
 * Parses a single CSV line, handling quoted fields
 */
function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote
        current += '"';
        i++; // Skip next quote
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // End of field
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  // Add the last field
  values.push(current);

  return values;
}

/**
 * Calculates total pageviews from processed articles
 * This ensures each article is counted only once
 */
export function calculateTotalPageviews(articles: ProcessedArticle[]): number {
  return articles.reduce((sum, article) => sum + article.page_views, 0);
}


