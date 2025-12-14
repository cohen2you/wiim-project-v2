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

// Extract all numbers from text (including currency, percentages, etc.)
function extractNumbers(text: string): Array<{ value: string; context: string; index: number }> {
  const numbers: Array<{ value: string; context: string; index: number }> = [];
  
  // Remove HTML tags for cleaner extraction
  const cleanText = text.replace(/<[^>]+>/g, ' ');
  
  // Pattern 1: Currency amounts like $73 billion, $500, $460, $50 billion, $100 billion
  const currencyPattern = /\$([\d,]+(?:\.[\d]+)?)\s*(billion|million|trillion|B|M|T)?/gi;
  let match;
  while ((match = currencyPattern.exec(cleanText)) !== null) {
    const value = match[0].trim();
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
  const uniqueNumbers: Array<{ value: string; context: string; index: number }> = [];
  for (const num of numbers) {
    const normalizedValue = num.value.toLowerCase().replace(/,/g, '');
    const isDuplicate = uniqueNumbers.some(existing => {
      const existingNormalized = existing.value.toLowerCase().replace(/,/g, '');
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
  return value.toLowerCase()
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

export async function POST(req: NextRequest) {
  try {
    const { article, sourceText } = await req.json();
    
    if (!article || !sourceText) {
      return NextResponse.json({ error: 'Article and source text are required' }, { status: 400 });
    }
    
    // Extract numbers from article
    const articleNumbers = extractNumbers(article);
    
    // Extract numbers from source text
    const sourceNumbers = extractNumbers(sourceText);
    
    // Check each number from article against source
    const checks: CheckResult[] = [];
    
    for (const articleNum of articleNumbers) {
      const searchResult = findNumberInSource(articleNum.value, sourceText);
      
      checks.push({
        number: articleNum.value,
        found: searchResult.found,
        articleContext: articleNum.context,
        sourceContext: searchResult.context,
        status: searchResult.found ? 'match' : 'missing'
      });
    }
    
    // Summary statistics
    const totalChecks = checks.length;
    const matches = checks.filter(c => c.status === 'match').length;
    const missing = checks.filter(c => c.status === 'missing').length;
    
    return NextResponse.json({
      checks,
      summary: {
        total: totalChecks,
        matches,
        missing,
        matchRate: totalChecks > 0 ? ((matches / totalChecks) * 100).toFixed(1) : '0'
      }
    });
    
  } catch (error: any) {
    console.error('Error checking numbers:', error);
    return NextResponse.json({ 
      error: error.message || 'Failed to check numbers' 
    }, { status: 500 });
  }
}

