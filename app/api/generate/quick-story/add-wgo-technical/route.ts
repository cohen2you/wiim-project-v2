import { NextResponse } from 'next/server';
import { aiProvider, AIProvider } from '@/lib/aiProvider';

// Import functions from WGO Generator
// We'll need to import fetchTechnicalData and generateTechnicalAnalysis
// For now, let's create a simplified version that calls the WGO Generator

export async function POST(request: Request) {
  try {
    const { ticker, currentStory, provider } = await request.json();

    if (!ticker || !ticker.trim()) {
      return NextResponse.json({ error: 'Ticker is required' }, { status: 400 });
    }

    if (!currentStory || !currentStory.trim()) {
      return NextResponse.json({ error: 'Current story is required' }, { status: 400 });
    }

    const tickerUpper = ticker.trim().toUpperCase();
    const aiProviderOverride: AIProvider | undefined = provider && (provider === 'openai' || provider === 'gemini')
      ? provider
      : undefined;

    // Call the WGO Generator to get technical analysis
    // Use internal API call - construct URL from request
    const requestUrl = new URL(request.url);
    const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;
    
    const wgoResponse = await fetch(`${baseUrl}/api/generate/technical-analysis`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tickers: tickerUpper,
        provider: aiProviderOverride || 'openai',
      }),
    });

    if (!wgoResponse.ok) {
      const errorText = await wgoResponse.text();
      console.error(`[ADD WGO TECHNICAL] WGO Generator returned error: ${wgoResponse.status} - ${errorText.substring(0, 200)}`);
      return NextResponse.json({ error: 'Failed to fetch WGO technical analysis' }, { status: 500 });
    }

    const wgoData = await wgoResponse.json();
    
    if (!wgoData || !wgoData.analyses || !Array.isArray(wgoData.analyses) || wgoData.analyses.length === 0) {
      return NextResponse.json({ error: 'No technical analysis data returned from WGO Generator' }, { status: 500 });
    }

    const wgoStory = wgoData.analyses[0].analysis || '';
    
    if (!wgoStory || !wgoStory.trim()) {
      return NextResponse.json({ error: 'WGO Generator returned empty analysis' }, { status: 500 });
    }

    // FINAL WALL EXTRACTION: Get the raw block and aggressively clean
    
    // 1. EXTRACTION: Get the raw block
    // Stop before next section OR "Top ETF Exposure" (which is not a section marker but appears after Technical Analysis)
    const taMatch = wgoStory.match(/##\s*Section:\s*Technical\s*Analysis([\s\S]*?)(?=##\s*Section:|##\s*Top\s*ETF|$)/i);
    
    if (!taMatch) {
      return NextResponse.json({ error: 'Could not find Technical Analysis section in WGO output' }, { status: 500 });
    }
    
    let bodyText = taMatch[1] || "";
    
    console.log('[CHART EXTRACTION] Raw bodyText length:', bodyText.length);
    console.log('[CHART EXTRACTION] Raw bodyText preview:', bodyText.substring(0, 200));
    
    // 2. AGGRESSIVE CLEANING: Strip EVERYTHING that isn't the paragraph
    // Remove the header string if it's trapped inside
    bodyText = bodyText.replace(/##\s*Section:\s*Technical\s*Analysis/i, "").trim();
    
    // Remove zero-width spaces and other invisible characters that might cause merging
    bodyText = bodyText.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
    
    // CRITICAL: Remove any section markers that might have been captured
    bodyText = bodyText.replace(/##\s*Section:.*$/gm, '').trim();
    
    // CRITICAL: Remove any trailing section markers that might be at the end of content
    bodyText = bodyText.replace(/[^\n]##\s*Section:.*$/gm, '').trim();
    
    // CRITICAL: Remove ETF section if it was captured
    bodyText = bodyText.replace(/##\s*Top\s*ETF[\s\S]*$/i, '').trim();
    bodyText = bodyText.replace(/Top\s*ETF\s*Exposure[\s\S]*$/i, '').trim();
    
    console.log('[CHART EXTRACTION] After cleaning, bodyText length:', bodyText.length);
    console.log('[CHART EXTRACTION] After cleaning, bodyText preview:', bodyText.substring(0, 200));
    
    // Ensure proper paragraph formatting - split by double newlines and rejoin
    const technicalParagraphs = bodyText
      .split(/\n\n+/)
      .map((p: string) => p.trim())
      .filter((p: string) => p && p.length > 0 && !p.match(/^##\s*Section:/));
    
    console.log('[CHART EXTRACTION] Technical paragraphs count:', technicalParagraphs.length);
    if (technicalParagraphs.length > 0) {
      console.log('[CHART EXTRACTION] First paragraph:', technicalParagraphs[0].substring(0, 150));
    }
    
    // Format Key Resistance/Support - ensure they're on separate lines with proper spacing
    let formattedContent = technicalParagraphs.join('\n\n');
    
    console.log('[CHART EXTRACTION] FormattedContent length before chart insertion:', formattedContent.length);
    
    // Ensure Key Resistance and Key Support are properly formatted (each on its own line)
    formattedContent = formattedContent.replace(/Key Resistance:\s*([^\n]+)\s*Key Support:\s*([^\n]+)/g, 
      'Key Resistance: $1\n\nKey Support: $2');
    formattedContent = formattedContent.replace(/Key Resistance:\s*([^\n]+)\n\s*Key Support:\s*([^\n]+)/g, 
      'Key Resistance: $1\n\nKey Support: $2');
    
    // INSERT CHART PLACEHOLDERS
    // Split content into paragraphs for easier manipulation
    const paragraphs = formattedContent.split(/\n\n+/).filter((p: string) => p.trim());
    
    console.log('[CHART INSERTION] Total paragraphs:', paragraphs.length);
    console.log('[CHART INSERTION] First paragraph sample:', paragraphs[0]?.substring(0, 100));
    
    // 1. Insert price-moving-averages chart after the first paragraph that mentions moving averages (SMA)
    // Look for paragraph containing SMA discussion - make regex more flexible
    let smaParagraphIndex = -1;
    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i];
      // Check if paragraph mentions moving averages (more flexible pattern)
      const hasSMA = para.match(/(\d+-day|\d+ day).*?(SMA|simple moving average|moving average)/i) ||
                     para.match(/(above|below).*?(20|50|100|200).*?(SMA|day)/i) ||
                     para.match(/(SMA|simple moving average).*?(20|50|100|200)/i);
      
      if (hasSMA && !para.match(/price-moving-averages|rsi-heatmap/)) {
        smaParagraphIndex = i;
        console.log('[CHART INSERTION] Found SMA paragraph at index:', i);
        break;
      }
    }
    
    if (smaParagraphIndex >= 0) {
      // Insert chart image after the SMA paragraph
      const nextIndex = smaParagraphIndex + 1;
      if (nextIndex >= paragraphs.length || !paragraphs[nextIndex].match(/price-moving-averages|chart.*image/i)) {
        // Construct chart API URL - check for environment variable first, then fallback to same base URL
        const chartApiBaseUrl = process.env.CHART_API_URL || (() => {
          const requestUrl = new URL(request.url);
          return `${requestUrl.protocol}//${requestUrl.host}`;
        })();
        const chartImageUrl = `${chartApiBaseUrl}/api/charts/image?symbol=${tickerUpper}&chartType=price-moving-averages`;
        // Insert as HTML img tag
        const chartImgTag = `<img src="${chartImageUrl}" alt="Price with Moving Averages" style="max-width: 100%; height: auto; display: block; margin: 20px auto;" />`;
        paragraphs.splice(nextIndex, 0, chartImgTag);
        console.log('[CHART INSERTION] ✅ Inserted price-moving-averages chart image at index:', nextIndex);
        console.log('[CHART INSERTION] Chart API URL:', chartImageUrl);
      } else {
        console.log('[CHART INSERTION] ⚠️ price-moving-averages already exists');
      }
    } else {
      console.log('[CHART INSERTION] ❌ No SMA paragraph found');
    }
    
    // Re-split since we modified the array
    formattedContent = paragraphs.join('\n\n');
    const updatedParagraphs = formattedContent.split(/\n\n+/).filter((p: string) => p.trim() && !p.match(/^##\s*Section:/));
    
    // 2. Insert rsi-heatmap chart after the paragraph that mentions RSI
    // Look for paragraph containing RSI discussion - make regex more flexible
    let rsiParagraphIndex = -1;
    for (let i = 0; i < updatedParagraphs.length; i++) {
      const para = updatedParagraphs[i];
      // Check if paragraph mentions RSI (more flexible pattern)
      const hasRSI = para.match(/RSI.*?(neutral|overbought|oversold|territory|at \d+|is at|of \d+|currently)/i) ||
                     para.match(/RSI.*?\d+/i);
      
      if (hasRSI && !para.match(/price-moving-averages|rsi-heatmap/)) {
        rsiParagraphIndex = i;
        console.log('[CHART INSERTION] Found RSI paragraph at index:', i);
        break;
      }
    }
    
    if (rsiParagraphIndex >= 0) {
      // Insert chart image after the RSI paragraph
      const nextIndex = rsiParagraphIndex + 1;
      if (nextIndex >= updatedParagraphs.length || !updatedParagraphs[nextIndex].match(/rsi-heatmap|chart.*image/i)) {
        // Construct chart API URL - check for environment variable first, then fallback to same base URL
        const chartApiBaseUrl = process.env.CHART_API_URL || (() => {
          const requestUrl = new URL(request.url);
          return `${requestUrl.protocol}//${requestUrl.host}`;
        })();
        const chartImageUrl = `${chartApiBaseUrl}/api/charts/image?symbol=${tickerUpper}&chartType=rsi-heatmap`;
        // Insert as HTML img tag
        const chartImgTag = `<img src="${chartImageUrl}" alt="RSI Heatmap Timeline" style="max-width: 100%; height: auto; display: block; margin: 20px auto;" />`;
        updatedParagraphs.splice(nextIndex, 0, chartImgTag);
        console.log('[CHART INSERTION] ✅ Inserted rsi-heatmap chart image at index:', nextIndex);
        console.log('[CHART INSERTION] Chart API URL:', chartImageUrl);
      } else {
        console.log('[CHART INSERTION] ⚠️ rsi-heatmap already exists');
      }
    } else {
      console.log('[CHART INSERTION] ❌ No RSI paragraph found');
    }
    
    // Rejoin the paragraphs - this ensures proper spacing between all elements
    formattedContent = updatedParagraphs.join('\n\n');
    
    // CRITICAL: Ensure chart images (img tags) are ALWAYS on their own lines
    // The issue is that img tags might be getting merged into paragraphs
    // We need to be very aggressive about separating them
    
    // First, ensure img tags are separated from any preceding text
    // Match: any character (not newline) followed by <img tag
    formattedContent = formattedContent.replace(/([^\n])\s*(<img[^>]*>)/g, '$1\n\n$2');
    
    // Then, ensure img tags are separated from any following text
    // Match: </img> or > followed by any character (not newline)
    formattedContent = formattedContent.replace(/(<img[^>]*>)\s*([^\n<])/g, '$1\n\n$2');
    
    // Clean up excessive newlines (but keep at least 2 for proper spacing)
    formattedContent = formattedContent.replace(/\n{4,}/g, '\n\n\n');
    console.log('[CHART INSERTION] Final content length:', formattedContent.length);
    console.log('[CHART INSERTION] Contains chart images?', formattedContent.includes('<img'));
    
    // Final clean body - this is now JUST the paragraph text, no header
    // Trim at every step to remove any leading/trailing whitespace
    const technicalAnalysisBody = formattedContent.trim();

    // Check if there's already a Technical Analysis section
    if (currentStory.match(/##\s*Section:\s*Technical\s*Analysis/i)) {
      return NextResponse.json({ 
        error: 'Technical Analysis section already exists in the story',
        story: currentStory 
      }, { status: 400 });
    }
    
    // Find insertion point: after the first section's content, or in the middle if no sections
    // Use a more robust approach that handles section boundaries properly
    const sectionPattern = /##\s*Section:[^\n]*/g;
    const sections: Array<{ index: number; text: string; name: string }> = [];
    let match;
    while ((match = sectionPattern.exec(currentStory)) !== null) {
      sections.push({
        index: match.index,
        text: match[0],
        name: match[0].replace(/##\s*Section:\s*/i, '').trim()
      });
    }
    
    let insertionIndex = currentStory.length;
    
    if (sections.length > 0) {
      // Find the first section and insert after its content
      const firstSection = sections[0];
      
      // Find where the first section's content ends (before the next section or after 2-3 paragraphs)
      if (sections.length > 1) {
        // There's a next section - insert before it
        const nextSection = sections[1];
        insertionIndex = nextSection.index;
      } else {
        // No next section, find a good spot after 2-3 paragraphs of content
        const afterFirstSection = currentStory.substring(firstSection.index + firstSection.text.length);
        const paragraphs = afterFirstSection.split(/\n\n+/).filter((p: string) => p.trim() && !p.match(/^##\s*Section:/));
        
        if (paragraphs.length >= 2) {
          // Find the end of the second paragraph
          let charCount = 0;
          for (let i = 0; i < 2 && i < paragraphs.length; i++) {
            charCount += paragraphs[i].length + 2; // +2 for \n\n
          }
          insertionIndex = firstSection.index + firstSection.text.length + charCount;
        } else {
          // Not enough paragraphs, insert after first section's content
          insertionIndex = firstSection.index + firstSection.text.length + afterFirstSection.length;
        }
      }
    } else {
      // No sections, insert in the middle at a paragraph boundary
      insertionIndex = Math.floor(currentStory.length / 2);
      const beforeMiddle = currentStory.substring(0, insertionIndex);
      const lastParagraphBreak = beforeMiddle.lastIndexOf('\n\n');
      if (lastParagraphBreak !== -1) {
        insertionIndex = lastParagraphBreak + 2;
      }
    }
    
    // Ensure we're inserting at a proper paragraph boundary (after \n\n)
    let beforeInsertion = currentStory.substring(0, insertionIndex).trim();
    let afterInsertion = currentStory.substring(insertionIndex).trim();
    
    // Check if beforeInsertion ends with a section marker - if so, we need to add content first
    const endsWithSectionMarker = beforeInsertion.match(/##\s*Section:[^\n]*$/);
    const startsWithSectionMarker = afterInsertion.match(/^##\s*Section:/);
    
    // If we're inserting right after a section marker with no content, find the next paragraph break
    if (endsWithSectionMarker && startsWithSectionMarker) {
      // We're inserting between two section markers - find content after the first section
      const afterFirstSection = currentStory.substring(beforeInsertion.length);
      const nextParagraphMatch = afterFirstSection.match(/\n\n([^\n#])/);
      if (nextParagraphMatch && nextParagraphMatch.index !== undefined) {
        // Insert after the first paragraph of content
        insertionIndex = beforeInsertion.length + nextParagraphMatch.index + 2;
        beforeInsertion = currentStory.substring(0, insertionIndex).trim();
        afterInsertion = currentStory.substring(insertionIndex).trim();
      }
    }
    
    // FINAL WALL ASSEMBLY: Triple-join with surgical fixes
    
    // 1. THE "FORCE BREAK" ASSEMBLY
    // We define the parts as a strict array.
    const finalParts = [
      beforeInsertion.trim(),
      "## Section: Technical Analysis",
      technicalAnalysisBody, // No header here, just the "Despite..." text
      afterInsertion.trim()
    ];
    
    // 2. THE JOIN: Use triple newlines temporarily to ensure separation, 
    // then collapse them down to doubles.
    // Filter removes empty strings to prevent excessive newlines
    let result = finalParts.filter((p: string) => p && p.length > 0).join('\n\n\n');
    
    // 3. THE FIX FOR "COLLAPSED" HEADERS
    // This is a surgical strike: If "Analysis" is followed by text on the same line, 
    // it forces a break without touching the letters (prevents the "Analysi s" bug).
    // Matches "Technical Analysis" followed by any non-newline character
    result = result.replace(/(Technical\s+Analysis)([^\n])/gi, '$1\n\n$2');
    
    // 4. NORMALIZE
    // Collapse any 3+ newlines back to 2
    result = result.replace(/\n{3,}/g, '\n\n');
    
    // 5. TAIL-END FIX: Only allow breaks BEFORE a ## marker
    // This prevents the "Contex t" bug by only matching lowercase/numbers before ##
    // (not uppercase letters which might be part of words)
    result = result.replace(/([a-z0-9])##/gi, '$1\n\n##');
    
    // Final result
    let updatedStory = result;

    return NextResponse.json({
      story: updatedStory,
      originalLength: currentStory.length,
      updatedLength: updatedStory.length,
    });
  } catch (error) {
    console.error('[ADD WGO TECHNICAL] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to add WGO technical analysis' },
      { status: 500 }
    );
  }
}
