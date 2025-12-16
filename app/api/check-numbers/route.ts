import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export const dynamic = 'force-dynamic';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

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

interface LineComparison {
  articleLine: string;
  articleLineNumber: number;
  sourceMatches: Array<{
    sourceLine: string;
    sourceLineNumber: number;
    matchType: 'exact' | 'semantic' | 'partial' | 'not_found';
    similarityScore?: number;
    matchedPhrases?: string[];
    missingPhrases?: string[];
    addedPhrases?: string[];
  }>;
  overallStatus: 'verified' | 'paraphrased' | 'not_found' | 'partially_found';
}

interface DetailedAnalysis {
  lineByLine: LineComparison[];
  summary: {
    totalLines: number;
    verifiedLines: number;
    paraphrasedLines: number;
    notFoundLines: number;
    partiallyFoundLines: number;
    verificationRate: string;
  };
}

// Extract all numbers from text (including currency, percentages, etc.)
function extractNumbers(text: string): Array<{ value: string; context: string; index: number }> {
  const numbers: Array<{ value: string; context: string; index: number }> = [];
  
  // Remove HTML tags for cleaner extraction
  const cleanText = text.replace(/<[^>]+>/g, ' ');
  
  // Pattern 1: Currency amounts like $73 billion, $500, $460, $50 billion, $100 billion, $1.5bn
  // Also handle ranges like "$1-1.5 billion" - extract both numbers
  // Use word boundary to avoid capturing trailing commas/letters (e.g., "$450, t" should be just "$450")
  const currencyPattern = /\$([\d,]+(?:\.[\d]+)?)(?:-([\d,]+(?:\.[\d]+)?))?\s*(billion|million|trillion|B|M|T|bn|mn)?\b/gi;
  let match;
  while ((match = currencyPattern.exec(cleanText)) !== null) {
    // Extract the first number
    let value = '$' + match[1] + (match[3] ? ' ' + match[3] : '');
    value = value.replace(/,\s*[a-zA-Z]$/, '').trim();
    const start = Math.max(0, match.index - 50);
    const end = Math.min(cleanText.length, match.index + match[0].length + 50);
    const context = cleanText.substring(start, end).trim();
    numbers.push({ value, context, index: match.index });
    
    // If there's a range (second number), extract it too
    if (match[2]) {
      const rangeValue = match[2] + (match[3] ? ' ' + match[3] : '');
      const rangeValueClean = rangeValue.replace(/,\s*[a-zA-Z]$/, '').trim();
      // Find the index of the second number in the match
      const rangeIndex = match.index + match[0].indexOf(match[2]);
      const rangeStart = Math.max(0, rangeIndex - 50);
      const rangeEnd = Math.min(cleanText.length, rangeIndex + match[2].length + 50);
      const rangeContext = cleanText.substring(rangeStart, rangeEnd).trim();
      numbers.push({ value: rangeValueClean, context: rangeContext, index: rangeIndex });
    }
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
  
  // Pattern 3: Large numbers that might be mentioned without $ (like 73 billion, 10 gigawatts, 1.5bn)
  // Also handle ranges like "$1-1.5 billion" by extracting the second number
  const largeNumberPattern = /\b([\d,]+(?:\.[\d]+)?)\s+(billion|million|trillion|gigawatts?|GW|B|M|T|bn|mn)\b/gi;
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
  // IMPORTANT: If we have both "$37 billion" and "37 billion", prefer the one with currency symbol
  const uniqueNumbers: Array<{ value: string; context: string; index: number }> = [];
  for (const num of numbers) {
    // Normalize: lowercase, remove commas, remove trailing comma+letter patterns (e.g., "$450, t" -> "$450")
    let normalizedValue = num.value.toLowerCase()
      .replace(/,\s*[a-zA-Z]$/, '') // Remove trailing ", t" or similar
      .replace(/,/g, '')
      .trim();
    
    // Extract numeric part and unit for comparison (to catch "$37 billion" vs "37 billion")
    const numericPart = normalizedValue.replace(/[^\d.,]/g, '');
    const hasCurrency = normalizedValue.includes('$');
    const hasUnit = /\b(billion|million|trillion|B|M|T|%|x)\b/i.test(normalizedValue);
    
    const isDuplicate = uniqueNumbers.some((existing, idx) => {
      let existingNormalized = existing.value.toLowerCase()
        .replace(/,\s*[a-zA-Z]$/, '') // Remove trailing ", t" or similar
        .replace(/,/g, '')
        .trim();
      
      const existingNumericPart = existingNormalized.replace(/[^\d.,]/g, '');
      const existingHasCurrency = existingNormalized.includes('$');
      const existingHasUnit = /\b(billion|million|trillion|B|M|T|%|x)\b/i.test(existingNormalized);
      
      // Check if same numeric value and unit
      if (numericPart === existingNumericPart && hasUnit === existingHasUnit) {
        // If same number with same unit, prefer the one with currency symbol
        if (hasCurrency && !existingHasCurrency) {
          // Replace the existing one with the currency version
          uniqueNumbers[idx] = num;
          return true; // Mark as duplicate to skip adding
        } else if (!hasCurrency && existingHasCurrency) {
          // Keep the existing currency version, skip this one
          return true;
        }
        // Both have or both don't have currency - if they're the same number with same unit,
        // they're duplicates regardless of distance (e.g., "$37 billion" mentioned twice)
        // Only keep if they're in very different contexts (more than 500 chars apart)
        if (Math.abs(existing.index - num.index) < 500) {
          return true; // Too close, likely duplicate
        }
      }
      
      // Exact match check
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
    // Must match as percentage: "35%", "35 percent", "~35%", "approximately 35%", "about 35%"
    patterns.push(new RegExp(`${escapedNumber}\\s*%`, 'gi'));
    patterns.push(new RegExp(`${escapedNumber}\\s+percent`, 'gi'));
    // Also match with approximate indicators (~, approximately, about, around, roughly)
    patterns.push(new RegExp(`(?:~|approximately|about|around|roughly|approx\\.?)\\s*${escapedNumber}\\s*%`, 'gi'));
    patterns.push(new RegExp(`(?:~|approximately|about|around|roughly|approx\\.?)\\s*${escapedNumber}\\s+percent`, 'gi'));
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
    // Must match with billion: "35 billion", "35B", "35bn", "$35 billion", "~$35 billion", "$35bn"
    patterns.push(new RegExp(`${escapedNumber}\\s+(billion|B|bn)\\b`, 'gi'));
    // Also match with currency symbol (in case article has "37 billion" but source has "$37 billion" or "$37bn")
    patterns.push(new RegExp(`(?:~|\\$)?\\s*${escapedNumber}\\s*(billion|B|bn)\\b`, 'gi'));
    // Also match without space (e.g., "1.5bn" or "$1.5bn")
    patterns.push(new RegExp(`(?:~|\\$)?\\s*${escapedNumber}(billion|B|bn)\\b`, 'gi'));
  }
  
  if (hasMillion) {
    // Must match with million: "35 million", "35M", "$35 million", "~$35 million"
    patterns.push(new RegExp(`${escapedNumber}\\s+(million|M)\\b`, 'gi'));
    // Also match with currency symbol
    patterns.push(new RegExp(`(?:~|\\$)?\\s*${escapedNumber}\\s+(million|M)\\b`, 'gi'));
  }
  
  if (hasTrillion) {
    // Must match with trillion: "35 trillion", "35T", "$35 trillion", "~$35 trillion"
    patterns.push(new RegExp(`${escapedNumber}\\s+(trillion|T)\\b`, 'gi'));
    // Also match with currency symbol
    patterns.push(new RegExp(`(?:~|\\$)?\\s*${escapedNumber}\\s+(trillion|T)\\b`, 'gi'));
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
        const percentContextWords = ['sales', 'revenue', 'growth', 'increase', 'decrease', 'change', 'percent', '%', 'y/y', 'yoy', 'year-over-year', 'quarter', 'q1', 'q2', 'q3', 'q4', 'shipments', 'accounts', 'representing'];
        const hasPercentContext = percentContextWords.some(word => sourceContextLower.includes(word));
        const hasPercentContextInArticle = articleContextLower.split(/\s+/).some(w => percentContextWords.includes(w));
        
        // Also check for approximate indicators - if article has "approximately/about/around" and source has "~", it's likely the same number
        const hasApproxInArticle = /\b(approximately|about|around|roughly|approx\.?)\s*\d+/.test(articleContextLower);
        const hasApproxInSource = /~\s*\d+/.test(sourceContextLower);
        
        if (hasPercentContext || (hasPercentContextInArticle && (hasApproxInSource || hasApproxInArticle))) {
          return { 
            found: true, 
            context: sourceContext.trim() 
          };
        }
        
        // For percentages, if we found the number with % in source and article context mentions percentage-related terms, accept it
        // This handles "approximately 19%" matching "~19%" when both are in percentage contexts
        if (hasPercentContextInArticle && sourceContextLower.includes(`%`)) {
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

// NEW: Use AI to intelligently extract and verify quotes
async function extractAndVerifyQuotesWithAI(article: string, sourceText: string): Promise<Array<{ quote: string; context: string; index: number; source: 'headline' | 'body'; found: boolean; status: 'exact' | 'paraphrased' | 'not_found'; sourceContext?: string; similarityScore?: number }>> {
  const startTime = Date.now();
  console.log('[CHECK-NUMBERS] Using AI to extract and verify quotes...');
  
  try {
    // Get headline and body
    const headlineMatch = article.match(/^([^\n]+)/);
    const headline = headlineMatch ? headlineMatch[1] : '';
    const bodyStart = headlineMatch ? headlineMatch[0].length : 0;
    const body = article.substring(bodyStart);
    
    // Remove HTML tags for AI analysis
    const cleanHeadline = headline.replace(/<[^>]+>/g, ' ').trim();
    const cleanBody = body.replace(/<[^>]+>/g, ' ').trim();
    
    const prompt = `You are a fact-checking expert. Your task is to identify EVERY direct quote in the article and verify it against the source text.

CRITICAL: You must find ALL quotes, including:
- Single word quotes: "Buy", "Sell", "Hold"
- Short phrases: "sector-low multiple", "multi-year LOE period", "fair multiple"
- Medium phrases: "buying opportunity", "Trough Multiple"
- Long quotes: full sentences or phrases
- Headline quotes (single quotes 'text')
- Body quotes (double quotes "text")

ARTICLE TEXT:
HEADLINE: ${cleanHeadline}

BODY: ${cleanBody}

SOURCE TEXT:
${sourceText.substring(0, 15000)}${sourceText.length > 15000 ? '...' : ''}

For EACH quote you find:
1. Extract the exact quoted text (including the quote marks)
2. Determine if it's an EXACT word-for-word match in source (status: "exact")
3. If not exact, check if it's PARAPHRASED (same meaning, different words) (status: "paraphrased")
4. If neither, mark as "not_found"
5. Provide the matching text from source if found
6. Calculate similarity score (1.0 for exact, 0.5-0.9 for paraphrased, 0.0-0.4 for not found)

Return JSON:
{
  "quotes": [
    {
      "quote": "exact text with quote marks as it appears",
      "location": "headline" or "body",
      "context": "50 chars before and after the quote",
      "status": "exact" | "paraphrased" | "not_found",
      "sourceMatch": "matching text from source (if found)",
      "similarityScore": 0.0 to 1.0
    }
  ]
}

Be extremely thorough - scan the entire article character by character to find every quote.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 4000, // Increased to handle many quotes
      response_format: { type: 'json_object' }
    });

    const response = JSON.parse(completion.choices[0].message?.content || '{}');
    const aiTime = Date.now() - startTime;
    console.log(`[CHECK-NUMBERS] AI quote extraction completed in ${aiTime}ms`);
    
    if (response.quotes && Array.isArray(response.quotes)) {
      return response.quotes.map((q: any) => ({
        quote: q.quote || '',
        context: q.context || '',
        index: 0, // AI doesn't provide index
        source: (q.location === 'headline' ? 'headline' : 'body') as 'headline' | 'body',
        found: q.status !== 'not_found',
        status: (q.status || 'not_found') as 'exact' | 'paraphrased' | 'not_found',
        sourceContext: q.sourceMatch,
        similarityScore: q.similarityScore || 0
      }));
    }
    
    return [];
  } catch (error: any) {
    console.error('[CHECK-NUMBERS] AI quote extraction failed:', error.message);
    console.log('[CHECK-NUMBERS] Falling back to regex-based extraction and verification...');
    // Fallback: extract with regex, then verify with findQuoteInSource
    const fallbackQuotes = extractQuotesFallback(article);
    // Verify each quote against source
    return fallbackQuotes.map(q => {
      const searchResult = findQuoteInSource(q.quote, sourceText);
      return {
        ...q,
        found: searchResult.found,
        status: searchResult.isParaphrased ? 'paraphrased' : (searchResult.found ? 'exact' : 'not_found'),
        sourceContext: searchResult.context,
        similarityScore: searchResult.similarity || 0
      };
    });
  }
}

// Fallback: Extract quotes using regex (simpler, no AI)
function extractQuotesFallback(article: string): Array<{ quote: string; context: string; index: number; source: 'headline' | 'body'; found: boolean; status: 'exact' | 'paraphrased' | 'not_found'; sourceContext?: string; similarityScore?: number }> {
  const quotes: Array<{ quote: string; context: string; index: number; source: 'headline' | 'body'; found: boolean; status: 'exact' | 'paraphrased' | 'not_found'; sourceContext?: string; similarityScore?: number }> = [];
  
  // Get headline and body
  const headlineMatch = article.match(/^([^\n]+)/);
  const headline = headlineMatch ? headlineMatch[1] : '';
  const bodyStart = headlineMatch ? headlineMatch[0].length : 0;
  const body = article.substring(bodyStart);
  
  // Extract from headline (single quotes)
  const cleanHeadline = headline.replace(/<[^>]+>/g, ' ');
  const singleQuotePattern = /'([^']{2,})'/g;
  let match;
  while ((match = singleQuotePattern.exec(cleanHeadline)) !== null) {
    const quoteText = match[1].trim();
    if (quoteText.length >= 2 && !/[a-z]'s/i.test(quoteText)) { // Not possessive
      quotes.push({
        quote: match[0],
        context: cleanHeadline.substring(Math.max(0, match.index - 30), Math.min(cleanHeadline.length, match.index + match[0].length + 30)),
        index: match.index,
        source: 'headline',
        found: false, // Will be checked later
        status: 'not_found'
      });
    }
  }
  
  // Extract from body (double quotes)
  const cleanBody = body.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"');
  const doubleQuotePattern = /"([^"]{2,})"/g;
  while ((match = doubleQuotePattern.exec(cleanBody)) !== null) {
    const quoteText = match[1].trim();
    if (quoteText.length >= 2) {
      quotes.push({
        quote: match[0],
        context: cleanBody.substring(Math.max(0, match.index - 50), Math.min(cleanBody.length, match.index + match[0].length + 50)),
        index: match.index,
        source: 'body',
        found: false, // Will be checked later
        status: 'not_found'
      });
    }
  }
  
  return quotes;
}

// Extract double quotes from article body (everything after headline) - LEGACY, kept for compatibility
function extractBodyQuotes(article: string): Array<{ quote: string; context: string; index: number }> {
  // This is now a wrapper that uses the fallback
  const results = extractQuotesFallback(article);
  return results.filter(q => q.source === 'body').map(({ source, ...rest }) => rest);
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
  
  // Third try: check with optional leading article (a, an, the) or other common leading words
  const escapedQuote = quoteWithoutTrailingPunct.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Allow for common leading phrases that might be omitted in the quote
  const leadingPhrases = [
    '(?:which |that |who |what |where |when |why |how )?',
    '(?:a |an |the )?',
    '(?:to |for |from |with |by |in |on |at |of )?',
  ];
  const quoteWithLeading = leadingPhrases.join('') + escapedQuote;
  const leadingPattern = new RegExp(quoteWithLeading, 'i');
  const leadingMatch = sourceTextLower.match(leadingPattern);
  if (leadingMatch && leadingMatch.index !== undefined) {
    const index = leadingMatch.index;
    const start = Math.max(0, index - 50);
    const end = Math.min(normalizedSourceText.length, index + leadingMatch[0].length + 50);
    return { found: true, context: normalizedSourceText.substring(start, end).trim() };
  }
  
  // Third-b: Try matching the quote as a substring within a larger phrase
  // This handles cases where the quote starts mid-sentence (e.g., "set up..." matching "which should set up...")
  // For quotes longer than 20 characters, check if the quote text appears anywhere in the source
  // This allows for quotes that are extracted mid-sentence
  if (quoteWithoutTrailingPunct.length > 20) {
    // Escape the quote for regex, but allow for word boundaries
    const escapedQuoteForSubstring = quoteWithoutTrailingPunct.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Look for the quote text as a substring (not requiring word boundaries at the start)
    const substringPattern = new RegExp(escapedQuoteForSubstring, 'i');
    const substringMatch = sourceTextLower.match(substringPattern);
    if (substringMatch && substringMatch.index !== undefined) {
      const index = substringMatch.index;
      const start = Math.max(0, index - 50);
      const end = Math.min(normalizedSourceText.length, index + substringMatch[0].length + 50);
      return { found: true, context: normalizedSourceText.substring(start, end).trim() };
    }
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

// Split text into meaningful lines (sentences or paragraphs)
function splitIntoLines(text: string): string[] {
  // Remove HTML tags
  const cleanText = text.replace(/<[^>]+>/g, ' ');
  
  // Split by paragraph breaks first (double newlines)
  const paragraphs = cleanText.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  
  // For each paragraph, split into sentences if it's long
  const lines: string[] = [];
  for (const para of paragraphs) {
    if (para.trim().length < 100) {
      // Short paragraph, keep as one line
      lines.push(para.trim());
    } else {
      // Long paragraph, split into sentences
      const sentences = para.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
      lines.push(...sentences.map(s => s.trim()));
    }
  }
  
  return lines.filter(line => line.length > 10); // Filter out very short fragments
}

// Use AI to do a thorough semantic comparison - optimized with smart filtering
async function compareLinesWithSourceBatch(articleLines: Array<{ line: string; lineNumber: number }>, sourceLines: string[]): Promise<Array<LineComparison['sourceMatches'][0]>> {
  const startTime = Date.now();
  console.log(`[CHECK-NUMBERS] Starting line comparison: ${articleLines.length} article lines vs ${sourceLines.length} source lines`);
  
  try {
    // Step 1: Exact matching (fast, no AI needed)
    console.log('[CHECK-NUMBERS] Step 1: Performing exact matching...');
    const exactMatches: Array<{ index: number; match: LineComparison['sourceMatches'][0] }> = [];
    const needsAICheck: Array<{ line: string; lineNumber: number; index: number; candidateSourceLines: number[] }> = [];
    
    articleLines.forEach((articleLine, idx) => {
      const exactMatch = sourceLines.findIndex(line => 
        line.toLowerCase().trim() === articleLine.line.toLowerCase().trim()
      );
      
      if (exactMatch !== -1) {
        exactMatches.push({
          index: idx,
          match: {
            sourceLine: sourceLines[exactMatch],
            sourceLineNumber: exactMatch + 1,
            matchType: 'exact',
            similarityScore: 1.0
          }
        });
      } else {
        // Find candidate source lines with significant word overlap (smart filtering)
        const articleWords = articleLine.line.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        interface BestMatchType {
          index: number;
          similarity: number;
        }
        let bestMatch: BestMatchType | null = null;
        const candidateIndices: number[] = [];
        
        sourceLines.forEach((sourceLine, srcIdx) => {
          const sourceWords = sourceLine.toLowerCase().split(/\s+/).filter(w => w.length > 3);
          const commonWords = articleWords.filter(w => sourceWords.includes(w));
          const similarity = articleWords.length > 0 ? commonWords.length / articleWords.length : 0;
          
          // If 60%+ word overlap, consider it a good match and skip AI
          if (similarity >= 0.6) {
            if (bestMatch === null || similarity > bestMatch.similarity) {
              bestMatch = { index: srcIdx, similarity };
            }
          }
          
          // If 30%+ word overlap, it's a candidate for AI analysis
          if (similarity >= 0.3) {
            candidateIndices.push(srcIdx);
          }
        });
        
        // If we found a good match (60%+ similarity), use it without AI
        if (bestMatch !== null) {
          const bm = bestMatch as BestMatchType;
          exactMatches.push({
            index: idx,
            match: {
              sourceLine: sourceLines[bm.index],
              sourceLineNumber: bm.index + 1,
              matchType: 'partial',
              similarityScore: bm.similarity
            }
          });
        } else {
          needsAICheck.push({ 
            ...articleLine, 
            index: idx,
            candidateSourceLines: candidateIndices.slice(0, 8) // Limit to top 8 candidates to reduce token usage
          });
        }
      }
    });
    
    console.log(`[CHECK-NUMBERS] Exact matches: ${exactMatches.length}, Lines needing AI: ${needsAICheck.length}`);
    
    // If all lines have exact matches, return early
    if (needsAICheck.length === 0) {
      console.log('[CHECK-NUMBERS] All lines matched exactly, returning early');
      const results: Array<LineComparison['sourceMatches'][0]> = new Array(articleLines.length);
      exactMatches.forEach(({ index, match }) => {
        results[index] = match;
      });
      return results;
    }
    
    // Step 2: AI analysis for non-exact matches (only send candidate lines, not all source lines)
    console.log(`[CHECK-NUMBERS] Step 2: Starting AI analysis for ${needsAICheck.length} lines...`);
    const batchSize = 5; // Increased batch size to reduce API calls
    const aiResults: Array<{ index: number; match: LineComparison['sourceMatches'][0] }> = [];
    const totalBatches = Math.ceil(needsAICheck.length / batchSize);
    const maxTimeAllowed = 60000; // 60 seconds max for all AI calls
    const startAITime = Date.now();
    
    for (let i = 0; i < needsAICheck.length; i += batchSize) {
      // Check if we've exceeded time limit
      const elapsedTime = Date.now() - startAITime;
      if (elapsedTime > maxTimeAllowed) {
        console.log(`[CHECK-NUMBERS] Time limit reached (${elapsedTime}ms), skipping remaining ${needsAICheck.length - i} lines`);
        // Use fallback matching for remaining lines
        for (let j = i; j < needsAICheck.length; j++) {
          const item = needsAICheck[j];
          const articleWords = item.line.toLowerCase().split(/\s+/).filter(w => w.length > 3);
          const bestMatch = sourceLines.findIndex(line => {
            const sourceWords = line.toLowerCase().split(/\s+/).filter(w => w.length > 3);
            const commonWords = articleWords.filter(w => sourceWords.includes(w));
            return commonWords.length >= articleWords.length * 0.4;
          });
          
          if (bestMatch !== -1) {
            aiResults.push({
              index: item.index,
              match: {
                sourceLine: sourceLines[bestMatch],
                sourceLineNumber: bestMatch + 1,
                matchType: 'partial',
                similarityScore: 0.5
              }
            });
          }
        }
        break;
      }
      
      const batchNum = Math.floor(i / batchSize) + 1;
      console.log(`[CHECK-NUMBERS] Processing batch ${batchNum}/${totalBatches} (lines ${i + 1}-${Math.min(i + batchSize, needsAICheck.length)})...`);
      
      const batch = needsAICheck.slice(i, i + batchSize);
      
      // Collect unique candidate source lines for this batch
      const candidateSourceIndices = new Set<number>();
      batch.forEach(item => {
        item.candidateSourceLines.forEach(idx => candidateSourceIndices.add(idx));
      });
      
      // If no candidates found, use a broader search (first 15 source lines to reduce tokens)
      const relevantSourceLines = candidateSourceIndices.size > 0
        ? Array.from(candidateSourceIndices).map(idx => ({ idx, line: sourceLines[idx] }))
        : sourceLines.slice(0, 15).map((line, idx) => ({ idx, line }));
      
      const prompt = `Compare each article line with source lines. For each article line, find the best matching source line.

ARTICLE LINES:
${batch.map((item) => `Line ${item.lineNumber}: "${item.line}"`).join('\n\n')}

SOURCE LINES:
${relevantSourceLines.map(({ idx, line }) => `${idx + 1}. ${line}`).join('\n')}

Return JSON:
{
  "results": [
    {
      "articleLineNumber": <number>,
      "bestMatch": {
        "lineNumber": <number or null>,
        "sourceLine": "<text>",
        "matchType": "exact" | "semantic" | "partial" | "not_found",
        "similarityScore": <0.0-1.0>,
        "matchedPhrases": ["phrases"],
        "missingPhrases": ["phrases"],
        "addedPhrases": ["phrases"]
      }
    }
  ]
}`;

      const batchStartTime = Date.now();
      try {
        const completion = await Promise.race([
          openai.chat.completions.create({
            model: 'gpt-4o-mini', // Use faster, cheaper model
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
            max_tokens: 2000, // Reduced for faster responses
            response_format: { type: 'json_object' }
          }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('AI request timeout after 20 seconds')), 20000)
          )
        ]) as any;

        const batchTime = Date.now() - batchStartTime;
        console.log(`[CHECK-NUMBERS] Batch ${batchNum} completed in ${batchTime}ms`);

        const response = JSON.parse(completion.choices[0].message?.content || '{}');
        
        if (response.results && Array.isArray(response.results)) {
          response.results.forEach((result: any) => {
            const batchItem = batch.find(b => b.lineNumber === result.articleLineNumber);
            if (batchItem && result.bestMatch) {
              aiResults.push({
                index: batchItem.index,
                match: {
                  sourceLine: result.bestMatch.sourceLine || (result.bestMatch.lineNumber ? sourceLines[result.bestMatch.lineNumber - 1] : '') || '',
                  sourceLineNumber: result.bestMatch.lineNumber || 0,
                  matchType: result.bestMatch.matchType || 'not_found',
                  similarityScore: result.bestMatch.similarityScore || 0,
                  matchedPhrases: result.bestMatch.matchedPhrases || [],
                  missingPhrases: result.bestMatch.missingPhrases || [],
                  addedPhrases: result.bestMatch.addedPhrases || []
                }
              });
            }
          });
        }
      } catch (batchError: any) {
        console.error(`[CHECK-NUMBERS] Error in batch ${batchNum}:`, batchError.message);
        // Continue with fallback for this batch
        batch.forEach(item => {
          // Use simple word matching as fallback
          const bestMatch = sourceLines.findIndex(line => {
            const articleWords = item.line.toLowerCase().split(/\s+/).filter(w => w.length > 3);
            const sourceWords = line.toLowerCase().split(/\s+/).filter(w => w.length > 3);
            const commonWords = articleWords.filter(w => sourceWords.includes(w));
            return commonWords.length >= articleWords.length * 0.4;
          });
          
          if (bestMatch !== -1) {
            aiResults.push({
              index: item.index,
              match: {
                sourceLine: sourceLines[bestMatch],
                sourceLineNumber: bestMatch + 1,
                matchType: 'partial',
                similarityScore: 0.5
              }
            });
          }
        });
      }
    }
    
    console.log(`[CHECK-NUMBERS] AI analysis complete. Found ${aiResults.length} matches`);
    
    // Combine exact matches and AI results
    const results: Array<LineComparison['sourceMatches'][0]> = new Array(articleLines.length);
    [...exactMatches, ...aiResults].forEach(({ index, match }) => {
      results[index] = match;
    });
    
    // Fill in any missing results with not_found
    for (let i = 0; i < results.length; i++) {
      if (!results[i]) {
        results[i] = {
          sourceLine: '',
          sourceLineNumber: 0,
          matchType: 'not_found',
          similarityScore: 0
        };
      }
    }
    
    const totalTime = Date.now() - startTime;
    console.log(`[CHECK-NUMBERS] Line comparison complete in ${totalTime}ms`);
    
    return results;
  } catch (error: any) {
    console.error('[CHECK-NUMBERS] Error in AI batch line comparison:', error.message);
    // Fallback to simple text matching for all lines
    console.log('[CHECK-NUMBERS] Falling back to simple word matching...');
    return articleLines.map(articleLine => {
      const bestMatch = sourceLines.findIndex(line => {
        const articleWords = articleLine.line.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        const sourceWords = line.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        const commonWords = articleWords.filter(w => sourceWords.includes(w));
        return commonWords.length >= articleWords.length * 0.5; // 50% word overlap
      });
      
      if (bestMatch !== -1) {
        return {
          sourceLine: sourceLines[bestMatch],
          sourceLineNumber: bestMatch + 1,
          matchType: 'partial' as const,
          similarityScore: 0.5
        };
      }
      
      return {
        sourceLine: '',
        sourceLineNumber: 0,
        matchType: 'not_found' as const,
        similarityScore: 0
      };
    });
  }
}

// Perform a quick but thorough semantic analysis (target: 15-20 seconds)
async function performQuickSemanticAnalysis(article: string, sourceText: string): Promise<DetailedAnalysis> {
  const analysisStartTime = Date.now();
  console.log('[CHECK-NUMBERS] ===== Starting quick semantic analysis =====');
  
  const articleLines = splitIntoLines(article);
  const sourceLines = splitIntoLines(sourceText);
  
  console.log(`[CHECK-NUMBERS] Article: ${articleLines.length} lines, Source: ${sourceLines.length} lines`);
  
  // Analyze first 15 lines (key content) - faster than full analysis
  const maxLinesToAnalyze = 15;
  const linesToAnalyze = articleLines.slice(0, maxLinesToAnalyze);
  
  if (articleLines.length > maxLinesToAnalyze) {
    console.log(`[CHECK-NUMBERS] Analyzing first ${maxLinesToAnalyze} lines (key content)`);
  }
  
  // Prepare article lines for batch processing
  const articleLinesWithNumbers = linesToAnalyze.map((line, idx) => ({
    line,
    lineNumber: idx + 1
  }));
  
  // Use optimized batch comparison (faster than before)
  console.log(`[CHECK-NUMBERS] Starting optimized batch comparison...`);
  const matches = await compareLinesWithSourceBatch(articleLinesWithNumbers, sourceLines);
  
  const lineComparisons: LineComparison[] = [];
  
  // Build line comparisons from matches
  console.log(`[CHECK-NUMBERS] Building line comparisons from ${matches.length} matches...`);
  for (let i = 0; i < linesToAnalyze.length; i++) {
    const bestMatch = matches[i];
    
    // Determine overall status
    let overallStatus: LineComparison['overallStatus'] = 'not_found';
    if (bestMatch.matchType === 'exact') {
      overallStatus = 'verified';
    } else if (bestMatch.matchType === 'semantic' && (bestMatch.similarityScore || 0) > 0.7) {
      overallStatus = 'paraphrased';
    } else if (bestMatch.matchType === 'partial' || (bestMatch.similarityScore || 0) > 0.4) {
      overallStatus = 'partially_found';
    } else {
      overallStatus = 'not_found';
    }
    
    lineComparisons.push({
      articleLine: linesToAnalyze[i],
      articleLineNumber: i + 1,
      sourceMatches: [bestMatch],
      overallStatus
    });
  }
  
  const analysisTime = Date.now() - analysisStartTime;
  console.log(`[CHECK-NUMBERS] Quick semantic analysis complete in ${analysisTime}ms`);
  
  // Calculate summary
  const verifiedLines = lineComparisons.filter(l => l.overallStatus === 'verified').length;
  const paraphrasedLines = lineComparisons.filter(l => l.overallStatus === 'paraphrased').length;
  const notFoundLines = lineComparisons.filter(l => l.overallStatus === 'not_found').length;
  const partiallyFoundLines = lineComparisons.filter(l => l.overallStatus === 'partially_found').length;
  const totalLines = lineComparisons.length;
  const verificationRate = totalLines > 0 ? (((verifiedLines + paraphrasedLines) / totalLines) * 100).toFixed(1) : '0';
  
  return {
    lineByLine: lineComparisons,
    summary: {
      totalLines,
      verifiedLines,
      paraphrasedLines,
      notFoundLines,
      partiallyFoundLines,
      verificationRate
    }
  };
}

// Perform comprehensive line-by-line analysis (legacy - slower)
async function performLineByLineAnalysis(article: string, sourceText: string): Promise<DetailedAnalysis> {
  const analysisStartTime = Date.now();
  console.log('[CHECK-NUMBERS] ===== Starting line-by-line analysis =====');
  
  const articleLines = splitIntoLines(article);
  const sourceLines = splitIntoLines(sourceText);
  
  console.log(`[CHECK-NUMBERS] Article: ${articleLines.length} lines, Source: ${sourceLines.length} lines`);
  console.log(`[CHECK-NUMBERS] Article preview (first 100 chars): ${article.substring(0, 100)}...`);
  console.log(`[CHECK-NUMBERS] Source preview (first 100 chars): ${sourceText.substring(0, 100)}...`);
  
  // Limit analysis to first 20 lines for speed (can be adjusted)
  const maxLinesToAnalyze = 20;
  const linesToAnalyze = articleLines.slice(0, maxLinesToAnalyze);
  
  if (articleLines.length > maxLinesToAnalyze) {
    console.log(`[CHECK-NUMBERS] WARNING: Article has ${articleLines.length} lines, analyzing first ${maxLinesToAnalyze} only`);
  }
  
  // Prepare article lines for batch processing
  const articleLinesWithNumbers = linesToAnalyze.map((line, idx) => ({
    line,
    lineNumber: idx + 1
  }));
  
  // Batch compare all lines at once (more efficient)
  console.log(`[CHECK-NUMBERS] Starting batch comparison...`);
  const matches = await compareLinesWithSourceBatch(articleLinesWithNumbers, sourceLines);
  
  const lineComparisons: LineComparison[] = [];
  
  // Build line comparisons from matches
  console.log(`[CHECK-NUMBERS] Building line comparisons from ${matches.length} matches...`);
  for (let i = 0; i < linesToAnalyze.length; i++) {
    const bestMatch = matches[i];
    
    // Determine overall status
    let overallStatus: LineComparison['overallStatus'] = 'not_found';
    if (bestMatch.matchType === 'exact') {
      overallStatus = 'verified';
    } else if (bestMatch.matchType === 'semantic' && (bestMatch.similarityScore || 0) > 0.7) {
      overallStatus = 'paraphrased';
    } else if (bestMatch.matchType === 'partial' || (bestMatch.similarityScore || 0) > 0.4) {
      overallStatus = 'partially_found';
    } else {
      overallStatus = 'not_found';
    }
    
    lineComparisons.push({
      articleLine: linesToAnalyze[i],
      articleLineNumber: i + 1,
      sourceMatches: [bestMatch],
      overallStatus
    });
  }
  
  const analysisTime = Date.now() - analysisStartTime;
  console.log(`[CHECK-NUMBERS] Line-by-line analysis complete in ${analysisTime}ms`);
  
  // Calculate summary
  const verifiedLines = lineComparisons.filter(l => l.overallStatus === 'verified').length;
  const paraphrasedLines = lineComparisons.filter(l => l.overallStatus === 'paraphrased').length;
  const notFoundLines = lineComparisons.filter(l => l.overallStatus === 'not_found').length;
  const partiallyFoundLines = lineComparisons.filter(l => l.overallStatus === 'partially_found').length;
  const totalLines = lineComparisons.length;
  const verificationRate = totalLines > 0 ? (((verifiedLines + paraphrasedLines) / totalLines) * 100).toFixed(1) : '0';
  
  return {
    lineByLine: lineComparisons,
    summary: {
      totalLines,
      verifiedLines,
      paraphrasedLines,
      notFoundLines,
      partiallyFoundLines,
      verificationRate
    }
  };
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
    
    // NEW: Use AI to extract and verify quotes (much more accurate)
    console.log('[CHECK-NUMBERS] Extracting and verifying quotes using AI...');
    const aiQuoteResults = await extractAndVerifyQuotesWithAI(articleForChecking, sourceText);
    
    // Convert AI results to QuoteCheckResult format
    const quoteChecks: QuoteCheckResult[] = aiQuoteResults.map(q => ({
      quote: q.quote,
      found: q.found,
      articleContext: q.context,
      sourceContext: q.sourceContext,
      status: q.status,
      source: q.source,
      similarityScore: q.similarityScore
    }));
    
    console.log(`[CHECK-NUMBERS] Quote checks complete: ${quoteChecks.filter(c => c.status === 'exact').length} exact, ${quoteChecks.filter(c => c.status === 'paraphrased').length} paraphrased, ${quoteChecks.filter(c => c.status === 'not_found').length} not found`);
    
    // Perform a quick but thorough semantic analysis (15-20 seconds target)
    console.log('[CHECK-NUMBERS] ===== Starting quick semantic analysis =====');
    const semanticAnalysis = await performQuickSemanticAnalysis(articleForChecking, sourceText);
    
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
      },
      lineByLine: semanticAnalysis
    });
    
  } catch (error: any) {
    console.error('Error checking numbers and quotes:', error);
    return NextResponse.json({ 
      error: error.message || 'Failed to check numbers and quotes' 
    }, { status: 500 });
  }
}

