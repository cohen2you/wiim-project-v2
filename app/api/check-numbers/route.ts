import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface NumberMatch {
  value: string;
  found: boolean;
  context?: string;
  sourceContext?: string;
}

interface CheckResult {
  number: string;
  found: boolean;
  articleContext: string;
  sourceContext?: string;
  status: 'match' | 'missing' | 'mismatch';
}

interface QuoteCheckResult {
  quote: string;
  found: boolean;
  articleContext: string;
  sourceContext?: string;
  status: 'exact' | 'not_found';
  source?: 'headline' | 'body'; // Track where quote came from
}

// Extract all numbers from text (including currency, percentages, etc.)
function extractNumbers(text: string): Array<{ value: string; context: string; index: number }> {
  const numbers: Array<{ value: string; context: string; index: number }> = [];
  
  // Remove HTML tags for cleaner extraction
  const cleanText = text.replace(/<[^>]+>/g, ' ');
  
  // Pattern 1: Currency amounts like $73 billion, $500, $460, $50 billion, $100 billion
  // Use word boundary to avoid capturing trailing commas/letters (e.g., "$450, t" should be just "$450")
  const currencyPattern = /\$([\d,]+(?:\.[\d]+)?)\s*(billion|million|trillion|B|M|T)?\b/gi;
  let match;
  while ((match = currencyPattern.exec(cleanText)) !== null) {
    // Clean up the value - remove any trailing non-numeric characters that might have been captured
    let value = match[0].trim();
    // Remove trailing comma and any single letter that might have been captured
    value = value.replace(/,\s*[a-zA-Z]$/, '').trim();
    const start = Math.max(0, match.index - 50);
    const end = Math.min(cleanText.length, match.index + match[0].length + 50);
    const context = cleanText.substring(start, end).trim();
    numbers.push({ value, context, index: match.index });
  }
  
  // Pattern 2: Percentages like 11.43%, 73%, 71%
  const percentPattern = /([\d,]+(?:\.[\d]+)?)\s*%/g;
  while ((match = percentPattern.exec(cleanText)) !== null) {
    const value = match[0].trim();
    const start = Math.max(0, match.index - 50);
    const end = Math.min(cleanText.length, match.index + match[0].length + 50);
    const context = cleanText.substring(start, end).trim();
    numbers.push({ value, context, index: match.index });
  }
  
  // Pattern 3: Large numbers that might be mentioned without $ (like 73 billion, 10 gigawatts)
  const largeNumberPattern = /\b([\d,]+(?:\.[\d]+)?)\s+(billion|million|trillion|gigawatts?|GW|B|M|T)\b/gi;
  while ((match = largeNumberPattern.exec(cleanText)) !== null) {
    const value = match[0].trim();
    const start = Math.max(0, match.index - 50);
    const end = Math.min(cleanText.length, match.index + match[0].length + 50);
    const context = cleanText.substring(start, end).trim();
    numbers.push({ value, context, index: match.index });
  }
  
  // Pattern 4: Multipliers like 33x, 24x (P/E ratios)
  const multiplierPattern = /\b([\d,]+(?:\.[\d]+)?)x\b/gi;
  while ((match = multiplierPattern.exec(cleanText)) !== null) {
    const value = match[0].trim();
    const start = Math.max(0, match.index - 50);
    const end = Math.min(cleanText.length, match.index + match[0].length + 50);
    const context = cleanText.substring(start, end).trim();
    numbers.push({ value, context, index: match.index });
  }
  
  // Pattern 5: Years like 2026, 2027, CY26, FY26, 2H26
  const yearPattern = /\b(20\d{2}|CY\d{2}|FY\d{2}|2H\d{2}|1H\d{2})\b/gi;
  while ((match = yearPattern.exec(cleanText)) !== null) {
    const value = match[0].trim();
    const start = Math.max(0, match.index - 50);
    const end = Math.min(cleanText.length, match.index + match[0].length + 50);
    const context = cleanText.substring(start, end).trim();
    numbers.push({ value, context, index: match.index });
  }
  
  // Remove duplicates (same value and similar context)
  // Also normalize values by removing trailing commas and letters
  const uniqueNumbers: Array<{ value: string; context: string; index: number }> = [];
  for (const num of numbers) {
    // Normalize: lowercase, remove commas, remove trailing comma+letter patterns (e.g., "$450, t" -> "$450")
    let normalizedValue = num.value.toLowerCase()
      .replace(/,\s*[a-zA-Z]$/, '') // Remove trailing ", t" or similar
      .replace(/,/g, '')
      .trim();
    
    const isDuplicate = uniqueNumbers.some(existing => {
      let existingNormalized = existing.value.toLowerCase()
        .replace(/,\s*[a-zA-Z]$/, '') // Remove trailing ", t" or similar
        .replace(/,/g, '')
        .trim();
      return existingNormalized === normalizedValue && 
             Math.abs(existing.index - num.index) < 100;
    });
    if (!isDuplicate) {
      uniqueNumbers.push(num);
    }
  }
  
  return uniqueNumbers;
}

// Normalize number strings for comparison (remove commas, normalize units)
function normalizeNumber(value: string): string {
  // Remove trailing comma + letter patterns (e.g., "$450, t" -> "$450")
  let normalized = value.replace(/,\s*[a-zA-Z]$/, '').trim();
  return normalized.toLowerCase()
    .replace(/,/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Check if a number from article exists in source text
function findNumberInSource(articleNumber: string, sourceText: string): { found: boolean; context?: string } {
  const normalizedArticle = normalizeNumber(articleNumber);
  
  // Try exact match first
  const exactMatch = sourceText.toLowerCase().includes(normalizedArticle);
  if (exactMatch) {
    const index = sourceText.toLowerCase().indexOf(normalizedArticle);
    const start = Math.max(0, index - 50);
    const end = Math.min(sourceText.length, index + normalizedArticle.length + 50);
    return { found: true, context: sourceText.substring(start, end).trim() };
  }
  
  // Try matching just the numeric part (e.g., "73" from "$73 billion")
  const numericPart = articleNumber.replace(/[^\d.,]/g, '');
  if (numericPart) {
    // Look for the number with various formats
    const patterns = [
      new RegExp(`\\b${numericPart.replace(/\./g, '\\.')}\\b`, 'i'),
      new RegExp(`\\$${numericPart.replace(/\./g, '\\.')}`, 'i'),
      new RegExp(`${numericPart.replace(/\./g, '\\.')}\\s*(billion|million|trillion|%)`, 'i'),
    ];
    
    for (const pattern of patterns) {
      const match = sourceText.match(pattern);
      if (match) {
        const index = match.index!;
        const start = Math.max(0, index - 50);
        const end = Math.min(sourceText.length, index + match[0].length + 50);
        return { found: true, context: sourceText.substring(start, end).trim() };
      }
    }
  }
  
  return { found: false };
}

// Extract single quotes from headline (first line of article)
function extractHeadlineQuotes(article: string): Array<{ quote: string; context: string; index: number }> {
  const quotes: Array<{ quote: string; context: string; index: number }> = [];
  
  // Get the first line (headline) - everything before first newline or paragraph break
  const headlineMatch = article.match(/^([^\n]+)/);
  if (!headlineMatch) {
    return quotes;
  }
  
  const headline = headlineMatch[1];
  // Remove HTML tags
  const cleanHeadline = headline.replace(/<[^>]+>/g, ' ');
  
  // Match single quotes in headline - must be at least 3 characters
  const singleQuotePattern = /'([^']{3,})'/g;
  let match;
  while ((match = singleQuotePattern.exec(cleanHeadline)) !== null) {
    const quoteText = match[1].trim();
    
    // Skip if it's a possessive (starts with letter + apostrophe)
    if (/^[a-z]'s\s/i.test(quoteText)) {
      continue;
    }
    
    // Skip if character before quote is a letter (possessive)
    if (match.index > 0) {
      const charBefore = cleanHeadline[match.index - 1];
      if (/[a-zA-Z]/.test(charBefore)) {
        continue;
      }
    }
    
    const quote = match[0]; // Full quote with marks
    const start = Math.max(0, match.index - 30);
    const end = Math.min(cleanHeadline.length, match.index + quote.length + 30);
    const context = cleanHeadline.substring(start, end).trim();
    quotes.push({ quote, context, index: match.index });
  }
  
  return quotes;
}

// Extract double quotes from article body (everything after headline)
function extractBodyQuotes(article: string): Array<{ quote: string; context: string; index: number }> {
  const quotes: Array<{ quote: string; context: string; index: number }> = [];
  
  // Get everything after the first line (body)
  const headlineMatch = article.match(/^([^\n]+)/);
  const bodyStart = headlineMatch ? headlineMatch[0].length : 0;
  const body = article.substring(bodyStart);
  
  // Remove HTML tags and decode HTML entities
  let cleanBody = body.replace(/<[^>]+>/g, ' ');
  cleanBody = cleanBody.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'");
  
  // Match double quotes in body - must be at least 3 characters, max 500 to avoid errors
  const doubleQuotePattern = /"([^"]{3,500})"/g;
  let match;
  while ((match = doubleQuotePattern.exec(cleanBody)) !== null) {
    const quoteText = match[1].trim();
    
    // Skip if quote is too long (likely a matching error)
    if (quoteText.length > 500) {
      continue;
    }
    
    // Skip if it's just a single character or very short (likely not a quote)
    if (quoteText.length < 3) {
      continue;
    }
    
    const quote = match[0]; // Full quote with marks
    const start = Math.max(0, match.index - 50);
    const end = Math.min(cleanBody.length, match.index + quote.length + 50);
    const context = cleanBody.substring(start, end).trim();
    quotes.push({ quote, context, index: match.index });
  }
  
  return quotes;
}

// Check if a quote from article exists exactly in source text (word-for-word match)
// Allows for minor punctuation differences and optional leading articles
function findQuoteInSource(articleQuote: string, sourceText: string): { found: boolean; context?: string } {
  // Remove quote marks for comparison
  let quoteText = articleQuote.replace(/['"]/g, '').trim();
  
  // Normalize whitespace (multiple spaces/newlines to single space)
  quoteText = quoteText.replace(/\s+/g, ' ').trim();
  let normalizedSourceText = sourceText.replace(/\s+/g, ' ').trim();
  
  // Remove bracketed letters/words (e.g., [s], [ed], [ing], [the]) from quote for comparison
  // This handles cases like "continue[s]" matching "continue" in source
  const quoteTextNormalized = quoteText.replace(/\[[^\]]+\]/g, '').trim();
  
  // Convert to lowercase for comparison
  const quoteTextLower = quoteTextNormalized.toLowerCase();
  const sourceTextLower = normalizedSourceText.toLowerCase();
  
  // First try: exact match (case-insensitive, whitespace-normalized)
  if (sourceTextLower.includes(quoteTextLower)) {
    const index = sourceTextLower.indexOf(quoteTextLower);
    const start = Math.max(0, index - 50);
    const end = Math.min(normalizedSourceText.length, index + quoteTextLower.length + 50);
    return { found: true, context: normalizedSourceText.substring(start, end).trim() };
  }
  
  // Second try: remove trailing punctuation from quote and try again
  let quoteWithoutTrailingPunct = quoteTextLower.replace(/[.,;:!?]+$/, '').trim();
  // Also remove any remaining bracketed content that might have been missed
  quoteWithoutTrailingPunct = quoteWithoutTrailingPunct.replace(/\[[^\]]+\]/g, '').trim();
  
  if (quoteWithoutTrailingPunct && sourceTextLower.includes(quoteWithoutTrailingPunct)) {
    const index = sourceTextLower.indexOf(quoteWithoutTrailingPunct);
    const start = Math.max(0, index - 50);
    const end = Math.min(normalizedSourceText.length, index + quoteWithoutTrailingPunct.length + 50);
    return { found: true, context: normalizedSourceText.substring(start, end).trim() };
  }
  
  // Third try: check with optional leading article (a, an, the)
  const escapedQuote = quoteWithoutTrailingPunct.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const quoteWithArticle = `(?:a |an |the )?${escapedQuote}`;
  const articlePattern = new RegExp(quoteWithArticle, 'i');
  const articleMatch = sourceTextLower.match(articlePattern);
  if (articleMatch && articleMatch.index !== undefined) {
    const index = articleMatch.index;
    const start = Math.max(0, index - 50);
    const end = Math.min(normalizedSourceText.length, index + articleMatch[0].length + 50);
    return { found: true, context: normalizedSourceText.substring(start, end).trim() };
  }
  
  // Fourth try: check with trailing punctuation variations
  const punctuationPattern = new RegExp(escapedQuote + '[.,;:!?]?', 'i');
  const punctuationMatch = sourceTextLower.match(punctuationPattern);
  if (punctuationMatch && punctuationMatch.index !== undefined) {
    const index = punctuationMatch.index;
    const start = Math.max(0, index - 50);
    const end = Math.min(normalizedSourceText.length, index + punctuationMatch[0].length + 50);
    return { found: true, context: normalizedSourceText.substring(start, end).trim() };
  }
  
  // Fifth try: word-by-word matching (more flexible for variations)
  // Remove bracketed content from words before matching
  const quoteWords = quoteWithoutTrailingPunct
    .split(/\s+/)
    .map(w => w.replace(/\[[^\]]+\]/g, '')) // Remove bracketed content from each word
    .filter(w => w.length > 0);
    
  if (quoteWords.length >= 2) {
    // Find all words in sequence
    let searchIndex = 0;
    let firstWordIndex = -1;
    let allWordsFound = true;
    
    for (const word of quoteWords) {
      // Also try matching with common verb variations (e.g., "continue" or "continues")
      const wordVariations = [
        word,
        word + 's', // plural
        word + 'ed', // past tense
        word + 'ing', // present participle
        word.replace(/s$/, ''), // remove trailing 's'
        word.replace(/ed$/, ''), // remove trailing 'ed'
        word.replace(/ing$/, '') // remove trailing 'ing'
      ];
      
      let wordFound = false;
      for (const variation of wordVariations) {
        const wordIndex = sourceTextLower.indexOf(variation, searchIndex);
        if (wordIndex !== -1) {
          if (firstWordIndex === -1) {
            firstWordIndex = wordIndex;
          }
          searchIndex = wordIndex + variation.length;
          wordFound = true;
          break;
        }
      }
      
      if (!wordFound) {
        // Try from beginning if not found
        for (const variation of wordVariations) {
          const wordIndexFromStart = sourceTextLower.indexOf(variation);
          if (wordIndexFromStart !== -1) {
            if (firstWordIndex === -1) {
              firstWordIndex = wordIndexFromStart;
            }
            searchIndex = wordIndexFromStart + variation.length;
            wordFound = true;
            break;
          }
        }
      }
      
      if (!wordFound) {
        allWordsFound = false;
        break;
      }
    }
    
    // If all words found in order, it's a match
    if (allWordsFound && firstWordIndex !== -1) {
      const start = Math.max(0, firstWordIndex - 50);
      const end = Math.min(normalizedSourceText.length, searchIndex + 50);
      return { found: true, context: normalizedSourceText.substring(start, end).trim() };
    }
  }
  
  return { found: false };
}

export async function POST(req: NextRequest) {
  try {
    const { article, sourceText } = await req.json();
    
    if (!article || !sourceText) {
      return NextResponse.json({ error: 'Article and source text are required' }, { status: 400 });
    }
    
    // Extract numbers from article
    const articleNumbers = extractNumbers(article);
    
    // Extract quotes: single quotes from headline, double quotes from body
    const headlineQuotes = extractHeadlineQuotes(article);
    const bodyQuotes = extractBodyQuotes(article);
    const allQuotes = [
      ...headlineQuotes.map(q => ({ ...q, source: 'headline' as const })),
      ...bodyQuotes.map(q => ({ ...q, source: 'body' as const }))
    ];
    
    // Remove duplicates (same quote text, case-insensitive and punctuation-insensitive)
    const uniqueQuotes: Array<{ quote: string; context: string; index: number; source: 'headline' | 'body' }> = [];
    for (const q of allQuotes) {
      // Normalize for comparison: lowercase, remove quotes, remove leading/trailing punctuation
      const normalizedQuote = q.quote.toLowerCase()
        .replace(/['"]/g, '')
        .replace(/^[.,;:!?\s]+|[.,;:!?\s]+$/g, '')
        .trim();
      
      const isDuplicate = uniqueQuotes.some(existing => {
        const existingNormalized = existing.quote.toLowerCase()
          .replace(/['"]/g, '')
          .replace(/^[.,;:!?\s]+|[.,;:!?\s]+$/g, '')
          .trim();
        return existingNormalized === normalizedQuote;
      });
      
      if (!isDuplicate) {
        uniqueQuotes.push(q);
      }
    }
    
    // Check each number from article against source
    const numberChecks: CheckResult[] = [];
    
    for (const articleNum of articleNumbers) {
      const searchResult = findNumberInSource(articleNum.value, sourceText);
      
      numberChecks.push({
        number: articleNum.value,
        found: searchResult.found,
        articleContext: articleNum.context,
        sourceContext: searchResult.context,
        status: searchResult.found ? 'match' : 'missing'
      });
    }
    
    // Check each quote from article against source
    const quoteChecks: QuoteCheckResult[] = [];
    
    for (const articleQuote of uniqueQuotes) {
      const searchResult = findQuoteInSource(articleQuote.quote, sourceText);
      
      quoteChecks.push({
        quote: articleQuote.quote,
        found: searchResult.found,
        articleContext: articleQuote.context,
        sourceContext: searchResult.context,
        status: searchResult.found ? 'exact' : 'not_found',
        source: articleQuote.source // Track if from headline or body
      });
    }
    
    // Summary statistics
    const totalNumberChecks = numberChecks.length;
    const numberMatches = numberChecks.filter(c => c.status === 'match').length;
    const numberMissing = numberChecks.filter(c => c.status === 'missing').length;
    
    const totalQuoteChecks = quoteChecks.length;
    const exactQuotes = quoteChecks.filter(c => c.status === 'exact').length;
    const notFoundQuotes = quoteChecks.filter(c => c.status === 'not_found').length;
    
    return NextResponse.json({
      numbers: {
        checks: numberChecks,
        summary: {
          total: totalNumberChecks,
          matches: numberMatches,
          missing: numberMissing,
          matchRate: totalNumberChecks > 0 ? ((numberMatches / totalNumberChecks) * 100).toFixed(1) : '0'
        }
      },
      quotes: {
        checks: quoteChecks,
        summary: {
          total: totalQuoteChecks,
          exact: exactQuotes,
          notFound: notFoundQuotes,
          exactRate: totalQuoteChecks > 0 ? ((exactQuotes / totalQuoteChecks) * 100).toFixed(1) : '0'
        }
      }
    });
    
  } catch (error: any) {
    console.error('Error checking numbers and quotes:', error);
    return NextResponse.json({ 
      error: error.message || 'Failed to check numbers and quotes' 
    }, { status: 500 });
  }
}

