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
  status: 'exact' | 'paraphrased' | 'not_found';
  source?: 'headline' | 'body'; // Track where quote came from
  similarityScore?: number; // For paraphrased quotes, how similar (0-1)
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

// Check if a number from article exists in source text with matching context
function findNumberInSource(articleNumber: string, articleContext: string, sourceText: string): { found: boolean; context?: string } {
  // Extract the unit/type from the article number (%, $, billion, etc.)
  const hasPercent = articleNumber.includes('%');
  const hasCurrency = articleNumber.includes('$');
  const hasBillion = /\b(billion|B)\b/i.test(articleNumber);
  const hasMillion = /\b(million|M)\b/i.test(articleNumber);
  const hasTrillion = /\b(trillion|T)\b/i.test(articleNumber);
  const hasMultiplier = articleNumber.includes('x');
  const hasYear = /\b(20\d{2}|CY\d{2}|FY\d{2}|2H\d{2}|1H\d{2})\b/i.test(articleNumber);
  
  // Extract numeric value
  const numericPart = articleNumber.replace(/[^\d.,]/g, '');
  if (!numericPart) {
    return { found: false };
  }
  
  // Build context-aware patterns - must match the number WITH its unit/type
  const patterns: RegExp[] = [];
  
  // Exact match with full format (highest priority)
  const escapedNumber = numericPart.replace(/\./g, '\\.').replace(/,/g, ',?');
  patterns.push(new RegExp(articleNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'));
  
  // Context-specific patterns
  if (hasPercent) {
    // Must match as percentage: "35%" or "35 percent"
    patterns.push(new RegExp(`${escapedNumber}\\s*%`, 'gi'));
    patterns.push(new RegExp(`${escapedNumber}\\s+percent`, 'gi'));
  }
  
  if (hasCurrency) {
    // Must match as currency: "$35" or "$35.50" or "$303 PT" (allow text after)
    // Pattern 1: Match with optional text after (like "PT", "price target", etc.)
    patterns.push(new RegExp(`\\$${escapedNumber}(?:\\s*[/\\s]+[A-Z]+)?`, 'gi')); // Allow "/PT" or " PT" after
    // Pattern 2: Match standalone currency
    patterns.push(new RegExp(`\\$${escapedNumber}\\b`, 'gi'));
    // Pattern 3: Match currency with word boundary (handles "$303" in "$303 PT")
    patterns.push(new RegExp(`\\$${escapedNumber}(?=\\s|$|/|[A-Z])`, 'gi'));
  }
  
  if (hasBillion) {
    // Must match with billion: "35 billion" or "35B"
    patterns.push(new RegExp(`${escapedNumber}\\s+(billion|B)\\b`, 'gi'));
  }
  
  if (hasMillion) {
    // Must match with million: "35 million" or "35M"
    patterns.push(new RegExp(`${escapedNumber}\\s+(million|M)\\b`, 'gi'));
  }
  
  if (hasTrillion) {
    // Must match with trillion: "35 trillion" or "35T"
    patterns.push(new RegExp(`${escapedNumber}\\s+(trillion|T)\\b`, 'gi'));
  }
  
  if (hasMultiplier) {
    // Must match with multiplier: "35x"
    patterns.push(new RegExp(`${escapedNumber}x`, 'gi'));
  }
  
  if (hasYear) {
    // Must match year format: "2026", "CY26", "FY26", etc.
    patterns.push(new RegExp(`\\b${articleNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'));
  }
  
  // If no specific unit, try to match with context from article
  // Extract key words from article context to ensure semantic match
  const articleContextLower = articleContext.toLowerCase();
  const contextKeywords: string[] = [];
  
  // Extract relevant keywords from context (avoid common words)
  const commonWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can']);
  const words = articleContextLower.split(/\s+/).filter(w => w.length > 3 && !commonWords.has(w));
  contextKeywords.push(...words.slice(0, 5)); // Take first 5 meaningful words
  
  // Try each pattern
  for (const pattern of patterns) {
    const matches = [...sourceText.matchAll(pattern)];
    for (const match of matches) {
      if (match.index === undefined) continue;
      
      // Get context around the match in source
      const start = Math.max(0, match.index - 100);
      const end = Math.min(sourceText.length, match.index + match[0].length + 100);
      const sourceContext = sourceText.substring(start, end);
      const sourceContextLower = sourceContext.toLowerCase();
      
      // Check if the source context shares semantic similarity with article context
      // Count how many context keywords appear in the source context
      const matchingKeywords = contextKeywords.filter(keyword => 
        sourceContextLower.includes(keyword)
      );
      
      // For currency values, be more lenient - check price-related context first
      if (hasCurrency) {
        const priceContextWords = ['price', 'target', 'pt', 'pt.', 'dollar', '$', 'cost', 'value', 'estimate', 'forecast', 'rating', 'buy', 'sell', 'hold', 'outperform', 'underperform', 'reiterate', 'maintain', 'upgrade', 'downgrade', 'raise', 'cut', 'boost', 'hike', 'lower'];
        const hasPriceContextInSource = priceContextWords.some(word => sourceContextLower.includes(word));
        const hasPriceContextInArticle = priceContextWords.some(word => articleContextLower.includes(word));
        
        // If we found the currency match and either context has price-related terms, accept it
        // This handles "$303 PT" matching "$303 price target" even if keywords don't match exactly
        if (hasPriceContextInSource || hasPriceContextInArticle) {
          return { 
            found: true, 
            context: sourceContext.trim() 
          };
        }
        
        // Fallback: If we found an exact currency match (same numeric value with $),
        // accept it even without context matching, as currency values are usually unambiguous
        // This handles cases like "$303" matching "$303 PT" when context words don't align
        const exactCurrencyMatch = new RegExp(`\\$${escapedNumber}(?:\\s|$|/|[^\\d])`, 'i').test(sourceContext);
        if (exactCurrencyMatch) {
          return { 
            found: true, 
            context: sourceContext.trim() 
          };
        }
      }
      
      // For numbers with units (%, $, billion, etc.), require at least 1 keyword match
      // For plain numbers, require at least 2 keyword matches to avoid false positives
      // For currency, we already checked above, so skip the keyword requirement
      const requiredMatches = (hasPercent || hasBillion || hasMillion || hasTrillion || hasMultiplier || hasYear) ? 1 : 2;
      
      if (matchingKeywords.length >= requiredMatches) {
        return { 
          found: true, 
          context: sourceContext.trim() 
        };
      }
      
      // If no keyword match but we have a unit, still check if it's in a similar semantic context
      // by looking for related terms (e.g., "sales", "revenue", "growth" for percentages)
      if (hasPercent) {
        const percentContextWords = ['sales', 'revenue', 'growth', 'increase', 'decrease', 'change', 'percent', '%', 'y/y', 'yoy', 'year-over-year', 'quarter', 'q1', 'q2', 'q3', 'q4'];
        const hasPercentContext = percentContextWords.some(word => sourceContextLower.includes(word));
        if (hasPercentContext && articleContextLower.split(/\s+/).some(w => percentContextWords.includes(w))) {
          return { 
            found: true, 
            context: sourceContext.trim() 
          };
        }
      }
      
    }
  }
  
  // If no context-aware match found, return false
  // This prevents matching "35%" against "35 locations"
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

// Calculate similarity between two text strings (simple word overlap)
function calculateSimilarity(text1: string, text2: string): number {
  const words1 = text1.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const words2 = text2.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  
  if (words1.length === 0 || words2.length === 0) return 0;
  
  const set1 = new Set(words1);
  const set2 = new Set(words2);
  
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  
  return intersection.size / union.size; // Jaccard similarity
}

// Check if a quote from article exists exactly in source text (word-for-word match)
// Also detects paraphrasing (similar meaning but different wording)
function findQuoteInSource(articleQuote: string, sourceText: string): { found: boolean; context?: string; isParaphrased?: boolean; similarity?: number } {
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
  
  // Sixth try: Check for paraphrasing - similar meaning but different wording
  // Look for similar phrases in the source (using word overlap)
  // Split source into sentences/phrases and check similarity
  const sourceSentences = normalizedSourceText.split(/[.!?;]\s+/);
  let bestMatch: { similarity: number; context: string } | null = null;
  
  for (const sentence of sourceSentences) {
    const similarity = calculateSimilarity(quoteTextNormalized, sentence);
    if (similarity > 0.4 && (!bestMatch || similarity > bestMatch.similarity)) {
      // Find the sentence in the original text for context
      const sentenceIndex = normalizedSourceText.indexOf(sentence);
      if (sentenceIndex !== -1) {
        const start = Math.max(0, sentenceIndex - 50);
        const end = Math.min(normalizedSourceText.length, sentenceIndex + sentence.length + 50);
        bestMatch = {
          similarity,
          context: normalizedSourceText.substring(start, end).trim()
        };
      }
    }
  }
  
  // If we found a similar phrase (similarity > 0.4), it's likely paraphrased
  if (bestMatch && bestMatch.similarity > 0.4) {
    return { 
      found: true, 
      context: bestMatch.context,
      isParaphrased: true,
      similarity: bestMatch.similarity
    };
  }
  
  return { found: false };
}

export async function POST(req: NextRequest) {
  try {
    const { article, sourceText } = await req.json();
    
    if (!article || !sourceText) {
      return NextResponse.json({ error: 'Article and source text are required' }, { status: 400 });
    }
    
    // Remove price action line from article before checking numbers/quotes
    // Price action is generated from Benzinga API (real-time data) and shouldn't be verified against source
    // The source text is analyst notes, which don't contain current price data
    let articleForChecking = article;
    
    // Remove price action line (can appear at end with or without newlines, with or without HTML bold tags)
    // Pattern: "Price Action:" followed by any text until end of string
    const priceActionPatterns = [
      /\n\n<strong>Price Action:<\/strong>.*$/i,  // With HTML bold and newlines
      /\n\nPrice Action:.*$/i,                      // With newlines, no HTML
      /<strong>Price Action:<\/strong>.*$/i,        // HTML bold, no leading newlines
      /Price Action:.*$/i                           // Plain text, no newlines
    ];
    
    for (const pattern of priceActionPatterns) {
      if (pattern.test(articleForChecking)) {
        articleForChecking = articleForChecking.replace(pattern, '');
        console.log('Removed price action line from article before verification');
        break; // Only need to remove once
      }
    }
    
    // Extract numbers from article (excluding price action line)
    const articleNumbers = extractNumbers(articleForChecking);
    
    // Extract quotes: single quotes from headline, double quotes from body (excluding price action)
    const headlineQuotes = extractHeadlineQuotes(articleForChecking);
    const bodyQuotes = extractBodyQuotes(articleForChecking);
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
    
    // Check each number from article against source (with context-aware matching)
    const numberChecks: CheckResult[] = [];
    
    for (const articleNum of articleNumbers) {
      const searchResult = findNumberInSource(articleNum.value, articleNum.context, sourceText);
      
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
      
      let status: 'exact' | 'paraphrased' | 'not_found';
      if (searchResult.found) {
        status = searchResult.isParaphrased ? 'paraphrased' : 'exact';
      } else {
        status = 'not_found';
      }
      
      quoteChecks.push({
        quote: articleQuote.quote,
        found: searchResult.found,
        articleContext: articleQuote.context,
        sourceContext: searchResult.context,
        status: status,
        source: articleQuote.source, // Track if from headline or body
        similarityScore: searchResult.similarity
      });
    }
    
    // Summary statistics
    const totalNumberChecks = numberChecks.length;
    const numberMatches = numberChecks.filter(c => c.status === 'match').length;
    const numberMissing = numberChecks.filter(c => c.status === 'missing').length;
    
    const totalQuoteChecks = quoteChecks.length;
    const exactQuotes = quoteChecks.filter(c => c.status === 'exact').length;
    const paraphrasedQuotes = quoteChecks.filter(c => c.status === 'paraphrased').length;
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
          paraphrased: paraphrasedQuotes,
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

