'use client';

import { useState } from 'react';

interface AddSubheadsButtonProps {
  articleText: string;
  onArticleUpdate: (newText: string) => void;
  backendUrl: string; // URL of your news-agent-project
}

export default function AddSubheadsButton({ 
  articleText, 
  onArticleUpdate,
  backendUrl 
}: AddSubheadsButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!articleText) {
      setError('No article text to optimize');
      return;
    }
    
    setIsLoading(true);
    setError(null);

    try {
      // Use local API route if backendUrl is not provided or is localhost
      // Otherwise, try external API first, then fallback to local
      const useLocalApi = !backendUrl || backendUrl.includes('localhost') || backendUrl.includes('127.0.0.1');
      let apiUrl = useLocalApi ? '/api/seo/generate' : `${backendUrl}/api/seo/generate`;
      
      console.log('🔵 AddSubheadsButton: Starting request');
      console.log('🔵 API URL:', apiUrl);
      console.log('🔵 Backend URL:', backendUrl);
      console.log('🔵 Using local API:', useLocalApi);
      console.log('🔵 Article text length:', articleText.length);
      console.log('🔵 Article text preview:', articleText.substring(0, 100) + '...');
      
      // Helper function to process the response
      const processResponse = async (response: Response) => {
        if (!response.ok) {
          let errorText = '';
          try {
            errorText = await response.text();
            console.error('🔴 Error response body:', errorText);
          } catch (e) {
            console.error('🔴 Could not read error response body');
          }
          throw new Error(`HTTP ${response.status}: ${response.statusText}${errorText ? `. ${errorText.substring(0, 200)}` : ''}`);
        }

        let data;
        try {
          data = await response.json();
          console.log('✅ Response data received:', data);
        } catch (e) {
          console.error('🔴 Could not parse JSON response');
          const text = await response.text();
          console.error('🔴 Response text:', text);
          throw new Error('Invalid JSON response from server');
        }
        
        if (data.optimizedText) {
          console.log('✅ Updating article with optimized text, length:', data.optimizedText.length);
          
          // Clean up the optimized text: remove markdown wrappers, convert markdown headings to HTML
          let cleanedText = data.optimizedText;
          
          // Remove markdown code block wrapper (```markdown ... ```)
          cleanedText = cleanedText.replace(/^```markdown\s*/i, '').replace(/\s*```$/i, '');
          cleanedText = cleanedText.replace(/^```\s*/, '').replace(/\s*```$/, '');
          
          // Convert markdown H2 (## Heading) to HTML H2 (<h2>Heading</h2>)
          cleanedText = cleanedText.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
          
          // Convert markdown H3 (### Heading) to HTML H3 (<h3>Heading</h3>)
          cleanedText = cleanedText.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
          
          // Remove trailing "..." if it exists at the very end
          cleanedText = cleanedText.replace(/\s*\.{3,}\s*$/, '').trim();
          
          // Post-processing: Fix issues introduced by news-agent-project
          
          // 1. Fix broken Benzinga Edge sections where company name was split (e.g., "Vi" and "sa")
          // The pattern: "for Vi" ... (possibly with H2 in between) ... "sa, highlighting"
          // First, try to find and fix the most common pattern: split company name with content/H2s in between
          
          // Pattern 1: "for Vi" followed by content, then H2, then "sa, highlighting"
          cleanedText = cleanedText.replace(/for\s+([A-Z][a-z])\s*([^<]*?)<h2>.*?<\/h2>\s*([a-z]{2}),\s*highlighting/gi, (match, p1, p2, p3) => {
            const companyName = p1 + (p2.trim() ? p2.trim() : '') + p3;
            return `for ${companyName}, highlighting`;
          });
          
          // Pattern 2: "Below is the Benzinga Edge scorecard for Vi" ... H2 ... "sa, highlighting"
          cleanedText = cleanedText.replace(/Below is the.*?Benzinga Edge scorecard for\s+([A-Z][a-z])\s*([^<]*?)<h2>.*?<\/h2>\s*([a-z]{2}),\s*highlighting/gi, (match, p1, p2, p3) => {
            const companyName = p1 + (p2.trim() ? p2.trim() : '') + p3;
            return `Below is the <a href="https://www.benzinga.com/screener">Benzinga Edge scorecard</a> for ${companyName}, highlighting`;
          });
          
          // Pattern 3: More general - look for "for [single letter]" followed by content and then "[two letters], highlighting"
          // This catches cases where the company name was split
          cleanedText = cleanedText.replace(/for\s+([A-Z][a-z])\s+([^,]*?)\s+([a-z]{2}),\s*highlighting/gi, (match, p1, p2, p3) => {
            // Check if p2 contains an H2 tag (indicating it was split)
            if (p2.includes('<h2>')) {
              const companyName = p1 + p3;
              return `for ${companyName}, highlighting`;
            }
            return match; // Don't replace if it's not actually broken
          });
          
          // Pattern 4: Look for "Below is the Benzinga Edge scorecard for Vi" (incomplete) followed by H2, then "sa, highlighting"
          cleanedText = cleanedText.replace(/Below is the.*?Benzinga Edge scorecard for\s+([A-Z][a-z])\s+([^,]*?)<h2>.*?<\/h2>\s*([a-z]{2}),\s*highlighting/gi, (match, p1, p2, p3) => {
            const companyName = p1 + p3;
            return `Below is the <a href="https://www.benzinga.com/screener">Benzinga Edge scorecard</a> for ${companyName}, highlighting`;
          });
          
          // 3. Ensure price action line is present if section marker exists
          const hasPriceActionMarker = /##\s*Section:\s*Price Action/i.test(cleanedText);
          const hasPriceActionText = /(?:<strong>.*?)?Price Action:(?:<\/strong>)?/i.test(cleanedText);
          
          if (hasPriceActionMarker && !hasPriceActionText) {
            // Try to extract price action from original article
            const originalPriceActionMatch = articleText.match(/(<strong>.*?Price Action:.*?<\/strong>.*?Benzinga Pro data.*?<\/a>\.)/is);
            if (originalPriceActionMatch) {
              // Find the price action section marker and add the text after it
              cleanedText = cleanedText.replace(/(##\s*Section:\s*Price Action\s*)/i, `$1\n\n${originalPriceActionMatch[1]}`);
            } else {
              // If we can't find it in original, try to reconstruct from ticker
              // Use RegExp constructor to avoid potential parsing issues
              const tickerPattern = new RegExp('\\((?:NASDAQ|NYSE|ARCA):([A-Z]+)\\)');
              const tickerMatch = articleText.match(tickerPattern);
              if (tickerMatch) {
                const ticker = tickerMatch[1];
                // This is a fallback - ideally we'd have the actual price action
                console.warn('⚠️ Could not extract price action from original article');
              }
            }
          }
          
          // 4. Fix orphaned closing tags and ensure proper HTML structure
          // Remove </p> tags that appear immediately after section markers
          cleanedText = cleanedText.replace(/(##\s*Section:[^\n]+)\s*<\/p>/gi, '$1');
          // Remove </p> at the very end
          cleanedText = cleanedText.replace(/<\/p>\s*$/, '').trim();
          // Remove </p> that appears right before "## Section: Price Action"
          cleanedText = cleanedText.replace(/<\/p>\s*\n\s*##\s*Section:\s*Price Action/gi, '\n\n## Section: Price Action');
          
          // 5. Ensure proper spacing around H2 tags
          cleanedText = cleanedText.replace(/([^\n])\n<h2>/g, '$1\n\n<h2>');
          cleanedText = cleanedText.replace(/<\/h2>\n([^\n])/g, '</h2>\n\n$1');
          
          // 6. Fix broken Benzinga Edge intro sentences (complete incomplete ones)
          if (cleanedText.includes('Below is the') && !cleanedText.includes('Below is the <a href')) {
            cleanedText = cleanedText.replace(
              /Below is the\s*(?!<a href)([^<]*?)(Benzinga Edge|scorecard)/gi,
              'Below is the <a href="https://www.benzinga.com/screener">Benzinga Edge scorecard</a> for $1'
            );
          }
          
          // 7. Remove Benzinga Edge images if they appear
          cleanedText = cleanedText.replace(/<p><img\s+src="https:\/\/www\.benzinga\.com\/edge\/[^"]+\.png"[^>]*><\/p>/gi, '');
          
          // 8. Fix broken HTML links in Benzinga Edge section (e.g., f="url">text</a>)
          cleanedText = cleanedText.replace(/f="([^"]+)">([^<]+)<\/a>/gi, '<a href="$1">$2</a>');
          
          console.log('✅ Cleaned text length:', cleanedText.length);
          onArticleUpdate(cleanedText);
          setError(null); // Clear any previous errors
          return true;
        } else {
          console.warn('⚠️ No optimizedText in response:', data);
          throw new Error('No optimizedText in response. Response: ' + JSON.stringify(data));
        }
      };
      
      // Try the primary API (local or external)
      let response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ articleText }),
      });

      console.log('🔵 Response received');
      console.log('🔵 Response status:', response.status);
      console.log('🔵 Response ok:', response.ok);
      console.log('🔵 Response headers:', Object.fromEntries(response.headers.entries()));

      // If external API fails with 404, try local API as fallback
      if (!response.ok && !useLocalApi && response.status === 404) {
        console.log('🟡 External API returned 404, trying local API...');
        response = await fetch('/api/seo/generate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ articleText }),
        });
      }

      // Process the response (either primary or fallback)
      await processResponse(response);

      
    } catch (err) {
      console.error('🔴 AddSubheadsButton error:', err);
      if (err instanceof TypeError && err.message.includes('fetch')) {
        console.error('🔴 Network error - check if the backend server is running and CORS is configured');
        setError(`Network error: ${err.message}. Check browser console (F12) for details. Is the backend running at ${backendUrl}?`);
      } else if (err instanceof Error) {
        console.error('🔴 Error message:', err.message);
        setError(`Error: ${err.message}`);
      } else {
        console.error('🔴 Unknown error:', err);
        setError('Failed to generate subheads. Check browser console (F12) for details.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-2" style={{ userSelect: 'none', WebkitUserSelect: 'none', MozUserSelect: 'none', msUserSelect: 'none' }}>
      <button
        onClick={handleGenerate}
        disabled={isLoading || !articleText}
        style={{
          padding: '8px 16px',
          backgroundColor: isLoading || !articleText ? '#9ca3af' : '#2563eb',
          color: 'white',
          border: 'none',
          borderRadius: '6px',
          fontSize: '13px',
          fontWeight: '500',
          cursor: isLoading || !articleText ? 'not-allowed' : 'pointer',
          transition: 'all 0.2s',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          MozUserSelect: 'none',
          msUserSelect: 'none'
        }}
      >
        {isLoading ? (
          <>
            <svg style={{ width: '16px', height: '16px', animation: 'spin 1s linear infinite' }} viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
            </svg>
            Optimizing...
          </>
        ) : (
          'Add SEO Subheads'
        )}
      </button>
      
      {error && (
        <span style={{ fontSize: '12px', color: '#ef4444' }}>{error}</span>
      )}
      
      <style jsx>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

