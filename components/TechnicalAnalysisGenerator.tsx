'use client';



import React, { useState, useRef, forwardRef, useImperativeHandle, useEffect } from 'react';
import AddSubheadsButton from './AddSubheadsButton';



export interface TechnicalAnalysisGeneratorRef {

  clearData: () => void;

}



interface TechnicalAnalysisResult {

  ticker: string;

  companyName: string;

  analysis: string;

  data?: {

    currentPrice: number;

    changePercent: number;

    twelveMonthReturn?: number;

    rsi?: number;

    rsiSignal?: string;

    supportLevel?: number | null;

    resistanceLevel?: number | null;

    sma20?: number;

    sma50?: number;

    sma100?: number;

    sma200?: number;

  };

  error?: string;

}



const TechnicalAnalysisGenerator = forwardRef<TechnicalAnalysisGeneratorRef>((props, ref) => {

  const [tickers, setTickers] = useState('');

  const [analyses, setAnalyses] = useState<TechnicalAnalysisResult[]>([]);

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState('');

  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const [provider, setProvider] = useState<'openai' | 'gemini'>('openai');

  const [timestamp, setTimestamp] = useState<string>('');

  // WGO w/ News state
  const [showNewsForm, setShowNewsForm] = useState(false);
  const [newsUrl, setNewsUrl] = useState('');
  const [scrapingUrl, setScrapingUrl] = useState(false);
  const [scrapedContent, setScrapedContent] = useState('');
  const [showNewsModal, setShowNewsModal] = useState(false);
  const [newsArticles, setNewsArticles] = useState<any[]>([]);
  const [selectedNewsArticles, setSelectedNewsArticles] = useState<Set<string>>(new Set());
  const [fetchingNews, setFetchingNews] = useState(false);
  const [addingNewsIndex, setAddingNewsIndex] = useState<number | null>(null);
  const [newsErrors, setNewsErrors] = useState<{ [key: number]: string | null }>({});
  const [loadingEnrichedWGO, setLoadingEnrichedWGO] = useState(false);
  const [enrichedWGOError, setEnrichedWGOError] = useState('');
  // WGO Concise state
  const [conciseTicker, setConciseTicker] = useState('');
  const [conciseNewsUrl, setConciseNewsUrl] = useState('');
  const [loadingConcise, setLoadingConcise] = useState(false);
  const [showConciseForm, setShowConciseForm] = useState(false);

  const analysisRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Get backend URL from environment variable
  const NEWS_AGENT_URL = process.env.NEXT_PUBLIC_NEWS_AGENT_URL || 'http://localhost:3000';
  
  // Debug log to verify URL is set correctly
  useEffect(() => {
    console.log('🔵 TechnicalAnalysisGenerator: NEWS_AGENT_URL =', NEWS_AGENT_URL);
  }, []);

  // Function to update a specific analysis text
  const updateAnalysisText = (index: number, newText: string) => {
    setAnalyses(prev => prev.map((analysis, i) => 
      i === index ? { ...analysis, analysis: newText } : analysis
    ));
  };

  // Function to add Benzinga news to an article
  const handleAddBenzingaNews = async (index: number) => {
    const analysis = analyses[index];
    if (!analysis || !analysis.analysis || analysis.error) {
      setNewsErrors(prev => ({ ...prev, [index]: 'No article available to add news to' }));
      return;
    }

    setAddingNewsIndex(index);
    setNewsErrors(prev => ({ ...prev, [index]: null }));

    try {
      const response = await fetch(`${NEWS_AGENT_URL}/api/enrichment/add-news`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ticker: analysis.ticker.toUpperCase(),
          articleText: analysis.analysis,
          storyType: 'wgo'
        })
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${response.statusText}${errorText ? `. ${errorText.substring(0, 200)}` : ''}`);
      }

      const data = await response.json();

      if (data.success && data.newsSection) {
        // Ensure the section has the correct header (format: ## Recent Developments & Catalysts)
        let newsSection = data.newsSection.trim();
        
        // Replace existing headers with our desired header
        newsSection = newsSection.replace(
          /##\s*(Section:\s*)?(Latest News on Stock|Recent Developments & Catalysts)/gi,
          '## Recent Developments & Catalysts'
        );
        
        // If the header doesn't exist at the start, add it
        if (!newsSection.startsWith('## Recent Developments & Catalysts')) {
          // Remove any existing markdown H2 header at the start
          newsSection = newsSection.replace(/^##\s*(Section:\s*)?.+\n?/m, '');
          // Add our header at the beginning
          newsSection = '## Recent Developments & Catalysts\n\n' + newsSection.trim();
        }
        
        // Insert the news section after "The Catalyst" section and before "Technical Analysis"
        let updatedArticle = analysis.analysis;
        
        // Check if "Recent Developments & Catalysts" already exists and replace it
        const existingNewsSectionMarker = /##\s*Recent Developments & Catalysts[\s\S]*?(?=\n##\s*|<h2>|Read Next:|$)/i;
        if (existingNewsSectionMarker.test(updatedArticle)) {
          updatedArticle = updatedArticle.replace(existingNewsSectionMarker, newsSection);
        } else {
          // Find the position to insert: after "The Catalyst" section, before "Technical Analysis"
          let insertionPoint = -1;
          let match: RegExpMatchArray | null = null;
          
          // Pattern 1: Look for section marker "## Section: Technical Analysis"
          const technicalAnalysisMarker = /##\s*Section:\s*Technical Analysis/i;
          match = updatedArticle.match(technicalAnalysisMarker);
          if (match && match.index !== undefined) {
            insertionPoint = match.index;
          } else {
            // Pattern 2: Look for SEO-optimized HTML heading with "Technical" in it
            const technicalHeadingHTMLPattern = /<h2>\s*[^<]*(?:Technical|Analysis)[^<]*\s*<\/h2>/i;
            match = updatedArticle.match(technicalHeadingHTMLPattern);
            if (match && match.index !== undefined) {
              insertionPoint = match.index;
            } else {
              // Pattern 3: Look for markdown heading with "Technical"
              const technicalHeadingMarkdownPattern = /^##\s+[^\n]*(?:Technical|Analysis)[^\n]*$/m;
              match = updatedArticle.match(technicalHeadingMarkdownPattern);
              if (match && match.index !== undefined) {
                insertionPoint = match.index;
              }
            }
          }
          
          if (insertionPoint !== -1 && insertionPoint > 0) {
            // Insert news section before the technical analysis section
            const beforeTechnical = updatedArticle.substring(0, insertionPoint).trim();
            const afterTechnical = updatedArticle.substring(insertionPoint);
            updatedArticle = beforeTechnical + '\n\n' + newsSection + '\n\n' + afterTechnical;
          } else {
            // Fallback: try to find "The Catalyst" section and insert after it
            const catalystMarker = /(##\s*Section:\s*The Catalyst[\s\S]*?)(?=\n##\s*Section:|$)/i;
            if (catalystMarker.test(updatedArticle)) {
              updatedArticle = updatedArticle.replace(
                catalystMarker,
                `$1\n\n${newsSection}\n\n`
              );
            } else {
              // Last resort: append before "Read Next" or at the end
              const readNextMarker = /\n\nRead Next:/i;
              const readNextMatch = updatedArticle.match(readNextMarker);
              if (readNextMatch && readNextMatch.index !== undefined) {
                const beforeReadNext = updatedArticle.substring(0, readNextMatch.index).trim();
                const afterReadNext = updatedArticle.substring(readNextMatch.index + 2);
                updatedArticle = beforeReadNext + '\n\n' + newsSection + '\n\n' + afterReadNext;
              } else {
                // Final fallback: append at end
                updatedArticle = updatedArticle + '\n\n' + newsSection;
              }
            }
          }
        }
        
        updateAnalysisText(index, updatedArticle);
        setNewsErrors(prev => ({ ...prev, [index]: null }));
      } else {
        throw new Error(data.error || 'Failed to add news section');
      }
    } catch (error) {
      console.error('Error calling enrichment API:', error);
      if (error instanceof Error) {
        setNewsErrors(prev => ({ ...prev, [index]: `Failed to add news: ${error.message}` }));
      } else {
        setNewsErrors(prev => ({ ...prev, [index]: 'Failed to add news. Check browser console for details.' }));
      }
    } finally {
      setAddingNewsIndex(null);
    }
  };



  const clearData = () => {

    setTickers('');

    setAnalyses([]);

    setLoading(false);

    setError('');

    setCopiedIndex(null);

    setTimestamp('');

    setShowNewsForm(false);

    setNewsUrl('');

    setScrapedContent('');

    setSelectedNewsArticles(new Set());

    setNewsArticles([]);

  };



  // Format timestamp in Eastern Time

  const formatTimestampET = (): string => {

    const now = new Date();

    const etTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));

    

    const timeOptions: Intl.DateTimeFormatOptions = {

      hour: 'numeric',

      minute: '2-digit',

      hour12: true,

      timeZone: 'America/New_York'

    };

    

    const dateOptions: Intl.DateTimeFormatOptions = {

      month: 'long',

      day: 'numeric',

      year: 'numeric',

      timeZone: 'America/New_York'

    };

    

    const timeStr = etTime.toLocaleTimeString('en-US', timeOptions);

    const dateStr = etTime.toLocaleDateString('en-US', dateOptions);

    

    return `${timeStr} ET on ${dateStr}`;

  };



  useImperativeHandle(ref, () => ({

    clearData

  }));



  const handleEnrichedWGOGeneration = async () => {
    if (!tickers.trim()) {
      setError('Please enter ticker(s) first.');
      return;
    }

    setAnalyses([]);
    setError('');
    setLoadingEnrichedWGO(true);

    try {
      const tickerList = tickers.split(',').map(t => t.trim().toUpperCase());
      const results: TechnicalAnalysisResult[] = [];

      for (const ticker of tickerList) {
        try {
          // Step 1: Fetch context brief from external agent
          console.log(`[ENRICHED WGO] ${ticker}: Fetching context brief from ${NEWS_AGENT_URL}/api/enrichment/context-brief`);
          const contextRes = await fetch(`${NEWS_AGENT_URL}/api/enrichment/context-brief`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticker })
          });
          
          let contextBrief = null;
          if (contextRes.ok) {
            contextBrief = await contextRes.json();
            console.log(`[ENRICHED WGO] ${ticker}: Successfully fetched context brief`);
          }

          // Step 2: Call technical-analysis endpoint with context brief
          const requestBody: any = { 
            tickers: ticker,
            provider: provider,
            contextBriefs: contextBrief ? { [ticker]: contextBrief } : undefined
          };

          const res = await fetch('/api/generate/technical-analysis', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
          });

          const data = await res.json();
          if (!res.ok || !data.analyses || !Array.isArray(data.analyses) || data.analyses.length === 0) {
            results.push({
              ticker,
              companyName: ticker,
              analysis: '',
              error: data.error || 'Failed to generate enriched WGO story'
            });
            continue;
          }

          const analysis = data.analyses[0];
          results.push({
            ticker: analysis.ticker || ticker,
            companyName: analysis.companyName || ticker,
            analysis: analysis.analysis || '',
            error: analysis.error
          });
        } catch (err: any) {
          results.push({
            ticker,
            companyName: ticker,
            analysis: '',
            error: err.message || 'Failed to generate enriched WGO story'
          });
        }
      }

      setAnalyses(results);
    } catch (error: unknown) {
      console.error('Error generating enriched WGO:', error);
      if (error instanceof Error) setError(error.message);
      else setError(String(error));
    } finally {
      setLoadingEnrichedWGO(false);
    }
  };

  async function generateTechnicalAnalysis() {

    if (!tickers.trim()) {

      setError('Please enter ticker(s) first.');

      return;

    }

    setAnalyses([]);

    setError('');

    setLoading(true);

    try {

      // Call technical-analysis route (reverted back to original route)
      const tickerList = tickers.split(',').map(t => t.trim().toUpperCase());

      const res = await fetch('/api/generate/technical-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          tickers: tickerList.join(','), 
          provider: provider 
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.analyses) {
        setError(data.error || 'Failed to generate technical analysis');
        return;
      }

      const results: TechnicalAnalysisResult[] = data.analyses.map((analysis: any) => ({
        ticker: analysis.ticker,
        companyName: analysis.companyName || analysis.ticker,
        analysis: analysis.analysis || '',
        error: analysis.error,
        data: analysis.data
      }));

      setAnalyses(results);

      setTimestamp(formatTimestampET());

    } catch (error: unknown) {

      console.error('Error generating WGO No News:', error);

      if (error instanceof Error) setError(error.message);

      else setError(String(error));

    } finally {

      setLoading(false);

    }

  }

  // Fetch news articles for ticker
  const fetchNewsArticles = async (ticker: string) => {
    setFetchingNews(true);
    try {
      const res = await fetch('/api/bz/articles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, count: 20 }),
      });
      const data = await res.json();
      if (!res.ok || !data.articles) throw new Error(data.error || 'Failed to fetch articles');
      setNewsArticles(data.articles);
      setShowNewsModal(true);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch news articles');
    } finally {
      setFetchingNews(false);
    }
  };

  // Scrape URL
  const handleScrapeUrl = async () => {
    if (!newsUrl.trim()) return;
    setScrapingUrl(true);
    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: newsUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to scrape URL');
      setScrapedContent(data.text || '');
    } catch (err: any) {
      setError(err.message || 'Failed to scrape URL');
    } finally {
      setScrapingUrl(false);
    }
  };

  // Generate WGO Concise
  const generateWGOConcise = async () => {
    if (!conciseTicker.trim()) {
      setError('Please enter a ticker first.');
      return;
    }

    setAnalyses([]);
    setError('');
    setLoadingConcise(true);
    try {
      const res = await fetch('/api/generate/wgo-concise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          ticker: conciseTicker.trim(),
          newsUrl: conciseNewsUrl.trim() || undefined,
          provider
        }),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to generate concise WGO');
      }
      const data = await res.json();
      setAnalyses([{
        ticker: data.ticker || conciseTicker.trim().toUpperCase(),
        companyName: data.ticker || conciseTicker.trim().toUpperCase(),
        analysis: data.article || '',
        error: data.error
      }]);
      setTimestamp(formatTimestampET());
      setShowConciseForm(false);
    } catch (error: unknown) {
      console.error('Error generating concise WGO:', error);
      if (error instanceof Error) setError(error.message);
      else setError(String(error));
    } finally {
      setLoadingConcise(false);
    }
  };

  // Generate WGO with news
  const generateWGOWithNews = async () => {
    if (!tickers.trim()) {
      setError('Please enter ticker(s) first.');
      return;
    }
    if (!scrapedContent && selectedNewsArticles.size === 0) {
      setError('Please provide either a scraped URL or select news articles.');
      return;
    }

    setAnalyses([]);
    setError('');
    setLoading(true);
    try {
      const selectedArticles = newsArticles.filter(article => selectedNewsArticles.has(article.id));
      const res = await fetch('/api/generate/technical-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          tickers, 
          provider,
          newsUrl: scrapedContent ? newsUrl : undefined,
          scrapedContent: scrapedContent || undefined,
          selectedArticles: selectedArticles.length > 0 ? selectedArticles : undefined
        }),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to generate WGO with news');
      }
      const data = await res.json();
      setAnalyses(data.analyses || []);
      setTimestamp(formatTimestampET());
      setShowNewsForm(false);
    } catch (error: unknown) {
      console.error('Error generating WGO with news:', error);
      if (error instanceof Error) setError(error.message);
      else setError(String(error));
    } finally {
      setLoading(false);
    }
  };

  const copyAnalysisHTML = async (index: number) => {

    const targetDiv = analysisRefs.current[index];

    if (!targetDiv) return;



    try {

      const clone = targetDiv.cloneNode(true) as HTMLElement;

      // Remove all buttons (Copy, Add SEO Subheads, etc.)
      const allButtons = clone.querySelectorAll('button');
      allButtons.forEach(button => button.remove());

      // Remove the button container divs that might contain button text
      const buttonContainers = clone.querySelectorAll('div');
      buttonContainers.forEach(div => {
        const text = div.textContent || '';
        if (text.includes('Add SEO Subheads') || text.includes('Optimizing...') || text.includes('Copy') || text.includes('Copied!')) {
          // Check if this div only contains button-related content
          const hasOnlyButtons = div.querySelectorAll('button').length > 0 || 
                                 text.trim() === 'Add SEO Subheads' || 
                                 text.trim() === 'Optimizing...' ||
                                 text.trim() === 'Copy' ||
                                 text.trim() === '✓ Copied!';
          if (hasOnlyButtons) {
            div.remove();
          }
        }
      });

      // Remove timestamp if present
      const timestampElement = clone.querySelector('[data-timestamp]');
      if (timestampElement) {
        timestampElement.remove();
      }



      const htmlContent = clone.innerHTML.trim();

      const plainText = clone.textContent?.trim() || '';



      const blob = new Blob([htmlContent], { type: 'text/html' });

      const textBlob = new Blob([plainText], { type: 'text/plain' });



      await navigator.clipboard.write([

        new ClipboardItem({

          'text/html': blob,

          'text/plain': textBlob

        })

      ]);



      setCopiedIndex(index);

      setTimeout(() => setCopiedIndex(null), 2000);

    } catch {

      // Fallback to plain text

      try {

        // Clone and remove all buttons before getting text content
        const cloneForText = targetDiv.cloneNode(true) as HTMLElement;
        const allButtonsInClone = cloneForText.querySelectorAll('button');
        allButtonsInClone.forEach(button => button.remove());
        
        // Remove button container divs
        const buttonContainersInClone = cloneForText.querySelectorAll('div');
        buttonContainersInClone.forEach(div => {
          const text = div.textContent || '';
          if (text.includes('Add SEO Subheads') || text.includes('Optimizing...') || text.includes('Copy') || text.includes('Copied!')) {
            const hasOnlyButtons = div.querySelectorAll('button').length > 0 || 
                                   text.trim() === 'Add SEO Subheads' || 
                                   text.trim() === 'Optimizing...' ||
                                   text.trim() === 'Copy' ||
                                   text.trim() === '✓ Copied!';
            if (hasOnlyButtons) {
              div.remove();
            }
          }
        });
        
        const timestampInClone = cloneForText.querySelector('[data-timestamp]');
        if (timestampInClone) {
          timestampInClone.remove();
        }
        const plainText = cloneForText.textContent?.trim() || '';

        await navigator.clipboard.writeText(plainText);

        setCopiedIndex(index);

        setTimeout(() => setCopiedIndex(null), 2000);

      } catch (fallbackError) {

        console.error('Failed to copy text:', fallbackError);

      }

    }

  };



  return (

    <section style={{ 
      padding: '32px', 
      backgroundColor: 'white', 
      borderRadius: '12px', 
      boxShadow: '0 4px 16px rgba(37, 99, 235, 0.25)',
      border: '4px solid #2563eb'
    }}>

      <h2 style={{ 
        fontSize: '28px', 
        fontWeight: '700', 
        marginBottom: '24px', 
        color: '#1e293b',
        borderBottom: '2px solid #e5e7eb',
        paddingBottom: '16px'
      }}>
        WGO Article Generator
      </h2>

      <div style={{ marginBottom: '20px' }}>

        <label style={{ 
          display: 'block', 
          fontSize: '14px', 
          fontWeight: '600', 
          marginBottom: '8px', 
          color: '#374151' 
        }}>

          AI Provider

        </label>

        <select

          value={provider}

          onChange={(e) => setProvider(e.target.value as 'openai' | 'gemini')}

          style={{
            width: '100%',
            padding: '10px 12px',
            border: '1px solid #d1d5db',
            borderRadius: '8px',
            fontSize: '14px',
            backgroundColor: 'white',
            cursor: 'pointer',
            transition: 'all 0.2s'
          }}

        >

          <option value="openai">OpenAI (GPT-4o-mini)</option>

          <option value="gemini">Gemini (2.5 Flash)</option>

        </select>

      </div>

      

      <input

        type="text"

        placeholder="Enter ticker(s), comma separated (e.g., AAPL, MSFT)"

        value={tickers}

        onChange={(e) => setTickers(e.target.value.toUpperCase())}

        style={{
          width: '100%',
          padding: '12px 16px',
          border: '1px solid #d1d5db',
          borderRadius: '8px',
          fontSize: '14px',
          marginBottom: '20px',
          boxSizing: 'border-box',
          transition: 'border-color 0.2s'
        }}

        onFocus={(e) => e.target.style.borderColor = '#2563eb'}
        onBlur={(e) => e.target.style.borderColor = '#d1d5db'}

      />

      

      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>

        <button

          onClick={generateTechnicalAnalysis}

          disabled={loading || !tickers.trim()}

          style={{
            padding: '12px 24px',
            backgroundColor: loading || !tickers.trim() ? '#9ca3af' : '#059669',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontSize: '15px',
            fontWeight: '600',
            cursor: loading || !tickers.trim() ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s',
            boxShadow: loading || !tickers.trim() ? 'none' : '0 2px 4px rgba(5, 150, 105, 0.3)'
          }}

          onMouseEnter={(e) => {
            if (!loading && tickers.trim()) {
              e.currentTarget.style.backgroundColor = '#047857';
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 4px 8px rgba(5, 150, 105, 0.4)';
            }
          }}

          onMouseLeave={(e) => {
            if (!loading && tickers.trim()) {
              e.currentTarget.style.backgroundColor = '#059669';
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 2px 4px rgba(5, 150, 105, 0.3)';
            }
          }}

        >

          {loading ? 'Analyzing...' : 'No News WGO'}

        </button>

        <button

          onClick={() => setShowNewsForm(!showNewsForm)}

          style={{
            padding: '12px 24px',
            backgroundColor: showNewsForm ? '#7c3aed' : '#7c3aed',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontSize: '15px',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'all 0.2s',
            boxShadow: '0 2px 4px rgba(124, 58, 237, 0.3)'
          }}

          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#6d28d9';
            e.currentTarget.style.transform = 'translateY(-1px)';
            e.currentTarget.style.boxShadow = '0 4px 8px rgba(124, 58, 237, 0.4)';
          }}

          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = '#7c3aed';
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 2px 4px rgba(124, 58, 237, 0.3)';
          }}

        >

          WGO w/ News

        </button>

        <button
          onClick={handleEnrichedWGOGeneration}
          disabled={loadingEnrichedWGO || loading || !tickers.trim()}
          style={{
            padding: '12px 24px',
            backgroundColor: loadingEnrichedWGO || loading || !tickers.trim() ? '#9ca3af' : '#059669',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontSize: '15px',
            fontWeight: '600',
            cursor: loadingEnrichedWGO || loading || !tickers.trim() ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s',
            boxShadow: loadingEnrichedWGO || loading || !tickers.trim() ? 'none' : '0 2px 4px rgba(5, 150, 105, 0.3)'
          }}
          onMouseEnter={(e) => {
            if (!loadingEnrichedWGO && !loading && tickers.trim()) {
              e.currentTarget.style.backgroundColor = '#047857';
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 4px 8px rgba(5, 150, 105, 0.4)';
            }
          }}
          onMouseLeave={(e) => {
            if (!loadingEnrichedWGO && !loading && tickers.trim()) {
              e.currentTarget.style.backgroundColor = '#059669';
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 2px 4px rgba(5, 150, 105, 0.3)';
            }
          }}
        >
          {loadingEnrichedWGO ? 'Enriching & Generating...' : 'Enriched No News WGO'}
        </button>

      </div>



      {error && (
        <div style={{
          padding: '12px 16px',
          backgroundColor: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: '8px',
          marginBottom: '20px'
        }}>
          <p style={{ color: '#dc2626', fontSize: '14px', margin: 0 }}>{error}</p>
        </div>
      )}

      {/* WGO w/ News Form */}
      {showNewsForm && (
        <div style={{
          padding: '24px',
          backgroundColor: '#f9fafb',
          borderRadius: '8px',
          border: '1px solid #e5e7eb',
          marginBottom: '24px'
        }}>
          <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', color: '#1e293b' }}>
            Add News Context
          </h3>
          
          {/* URL Scraping */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '8px', color: '#374151' }}>
              News Article URL (Optional)
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="url"
                value={newsUrl}
                onChange={(e) => setNewsUrl(e.target.value)}
                placeholder="https://www.benzinga.com/news/..."
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  fontSize: '14px'
                }}
              />
              <button
                onClick={handleScrapeUrl}
                disabled={scrapingUrl || !newsUrl.trim()}
                style={{
                  padding: '10px 20px',
                  backgroundColor: scrapingUrl || !newsUrl.trim() ? '#9ca3af' : '#059669',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: scrapingUrl || !newsUrl.trim() ? 'not-allowed' : 'pointer'
                }}
              >
                {scrapingUrl ? 'Scraping...' : 'Scrape'}
              </button>
            </div>
            {scrapedContent && (
              <p style={{ fontSize: '12px', color: '#059669', marginTop: '8px' }}>
                ✓ URL scraped successfully ({scrapedContent.length} characters)
              </p>
            )}
          </div>

          {/* Newsfeed Search */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '8px', color: '#374151' }}>
              Benzinga Newsfeed Search
            </label>
            <button
              onClick={() => {
                if (tickers.trim()) {
                  const firstTicker = tickers.split(',')[0].trim();
                  fetchNewsArticles(firstTicker);
                } else {
                  setError('Please enter a ticker first to search for news articles.');
                }
              }}
              disabled={fetchingNews || !tickers.trim()}
              style={{
                padding: '10px 20px',
                backgroundColor: fetchingNews || !tickers.trim() ? '#9ca3af' : '#2563eb',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: fetchingNews || !tickers.trim() ? 'not-allowed' : 'pointer'
              }}
            >
              {fetchingNews ? 'Searching...' : 'Search News Articles'}
            </button>
            {selectedNewsArticles.size > 0 && (
              <p style={{ fontSize: '12px', color: '#2563eb', marginTop: '8px' }}>
                ✓ {selectedNewsArticles.size} article(s) selected
              </p>
            )}
          </div>

          {/* Generate Button */}
          <button
            onClick={generateWGOWithNews}
            disabled={loading || (!scrapedContent && selectedNewsArticles.size === 0)}
            style={{
              padding: '12px 24px',
              backgroundColor: loading || (!scrapedContent && selectedNewsArticles.size === 0) ? '#9ca3af' : '#059669',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '15px',
              fontWeight: '600',
              cursor: loading || (!scrapedContent && selectedNewsArticles.size === 0) ? 'not-allowed' : 'pointer',
              width: '100%'
            }}
          >
            {loading ? 'Generating...' : 'Generate WGO w/ News'}
          </button>
        </div>
      )}

      {/* WGO W/WO News Concise Section */}
      <div style={{ 
        marginTop: '32px', 
        padding: '20px', 
        backgroundColor: '#f9fafb', 
        borderRadius: '8px',
        border: '1px solid #e5e7eb'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#1e293b', margin: 0 }}>
            WGO W/WO News Concise
          </h3>
          <button
            onClick={() => setShowConciseForm(!showConciseForm)}
            style={{
              padding: '8px 16px',
              backgroundColor: showConciseForm ? '#6b7280' : '#7c3aed',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: '500',
              cursor: 'pointer'
            }}
          >
            {showConciseForm ? 'Hide' : 'Show'}
          </button>
        </div>

        {showConciseForm && (
          <div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '8px', color: '#374151' }}>
                Ticker *
              </label>
              <input
                type="text"
                placeholder="Enter ticker (e.g., AAPL)"
                value={conciseTicker}
                onChange={(e) => setConciseTicker(e.target.value.toUpperCase())}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '8px', color: '#374151' }}>
                News URL (Optional)
              </label>
              <input
                type="url"
                placeholder="Enter news article URL (optional)"
                value={conciseNewsUrl}
                onChange={(e) => setConciseNewsUrl(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px',
                  boxSizing: 'border-box'
                }}
              />
              <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                Can run with or without the URL added
              </p>
            </div>

            <button
              onClick={generateWGOConcise}
              disabled={loadingConcise || !conciseTicker.trim()}
              style={{
                padding: '12px 24px',
                backgroundColor: loadingConcise || !conciseTicker.trim() ? '#9ca3af' : '#7c3aed',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '15px',
                fontWeight: '600',
                cursor: loadingConcise || !conciseTicker.trim() ? 'not-allowed' : 'pointer',
                width: '100%'
              }}
            >
              {loadingConcise ? 'Generating...' : 'Generate WGO W/WO News Concise'}
            </button>
          </div>
        )}
      </div>

      {/* News Articles Modal */}
      {showNewsModal && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999
          }}
          onClick={() => setShowNewsModal(false)}
        >
          <div 
            style={{
              backgroundColor: 'white',
              borderRadius: '8px',
              padding: '24px',
              maxWidth: '800px',
              width: '90%',
              maxHeight: '80vh',
              overflow: 'auto'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '20px', fontWeight: 'bold' }}>Select News Articles</h2>
              <button
                onClick={() => setShowNewsModal(false)}
                style={{ fontSize: '24px', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                ×
              </button>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <button
                onClick={() => {
                  const limited = newsArticles.slice(0, 5);
                  setSelectedNewsArticles(new Set(limited.map(a => a.id)));
                }}
                style={{ 
                  padding: '8px 12px', 
                  marginRight: '8px',
                  backgroundColor: '#2563eb', 
                  color: 'white', 
                  border: 'none', 
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Select All (max 5)
              </button>
              <button
                onClick={() => setSelectedNewsArticles(new Set())}
                style={{ 
                  padding: '8px 12px',
                  backgroundColor: '#6b7280', 
                  color: 'white', 
                  border: 'none', 
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Select None
              </button>
              <span style={{ marginLeft: '16px', fontSize: '14px', color: '#6b7280' }}>
                {selectedNewsArticles.size} of 5 articles selected (max 5)
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {newsArticles.map((article) => (
                <div
                  key={article.id}
                  style={{
                    border: selectedNewsArticles.has(article.id) ? '2px solid #2563eb' : '1px solid #d1d5db',
                    borderRadius: '8px',
                    padding: '16px',
                    backgroundColor: selectedNewsArticles.has(article.id) ? '#eff6ff' : 'white',
                    cursor: 'pointer'
                  }}
                  onClick={() => {
                    const newSelected = new Set(selectedNewsArticles);
                    if (newSelected.has(article.id)) {
                      newSelected.delete(article.id);
                    } else {
                      if (newSelected.size >= 5) {
                        alert('You can only select up to 5 articles.');
                        return;
                      }
                      newSelected.add(article.id);
                    }
                    setSelectedNewsArticles(newSelected);
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <input
                      type="checkbox"
                      checked={selectedNewsArticles.has(article.id)}
                      onChange={() => {}}
                      style={{ marginTop: '4px' }}
                    />
                    <div style={{ flex: 1 }}>
                      <h3 style={{ fontWeight: '600', marginBottom: '8px', fontSize: '16px' }}>
                        {article.headline}
                      </h3>
                      <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '8px' }}>
                        📅 {new Date(article.created).toLocaleDateString()}
                      </p>
                      <p style={{ fontSize: '14px', color: '#374151', marginBottom: '8px', lineHeight: '1.5' }}>
                        {article.body?.substring(0, 200)}...
                      </p>
                      {article.url && (
                        <a
                          href={article.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: '#2563eb', fontSize: '14px', textDecoration: 'none' }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          View Full Article →
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px', paddingTop: '16px', borderTop: '1px solid #d1d5db' }}>
              <button
                onClick={() => setShowNewsModal(false)}
                style={{ 
                  padding: '8px 16px',
                  color: '#6b7280',
                  border: '1px solid #d1d5db',
                  borderRadius: '4px',
                  backgroundColor: 'white',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowNewsModal(false);
                }}
                style={{ 
                  padding: '8px 16px',
                  backgroundColor: '#2563eb',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Done ({selectedNewsArticles.size} selected)
              </button>
            </div>
          </div>
        </div>
      )}



      {analyses.length > 0 && (

        <div style={{ marginTop: '24px' }}>

          {analyses.map((analysis, i) => {

            if (analysis.error) {

              return (

                <div key={i} style={{
                  padding: '16px',
                  border: '1px solid #fecaca',
                  borderRadius: '8px',
                  backgroundColor: '#fef2f2'
                }}>

                  <p style={{ fontWeight: '600', color: '#991b1b', marginBottom: '8px', fontSize: '16px' }}>{analysis.ticker}</p>

                  <p style={{ color: '#dc2626', fontSize: '14px', margin: 0 }}>{analysis.error}</p>

                </div>

              );

            }



            return (

              <div

                key={i}

                ref={el => { analysisRefs.current[i] = el; }}

                style={{
                  padding: '24px',
                  border: '1px solid #dbeafe',
                  borderRadius: '12px',
                  backgroundColor: '#f0f9ff',
                  marginBottom: '24px'
                }}

              >

                {timestamp && (

                  <p 

                    data-timestamp

                    style={{
                      fontSize: '12px',
                      color: '#6b7280',
                      marginBottom: '16px',
                      fontStyle: 'italic',
                      margin: '0 0 16px 0'
                    }}

                  >

                    Technical analysis data sourced via Massive API at {timestamp}

                  </p>

                )}

                

                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-start', gap: '8px', marginBottom: '16px', userSelect: 'none', WebkitUserSelect: 'none', MozUserSelect: 'none', msUserSelect: 'none' }}>

                  <button
                    onClick={() => handleAddBenzingaNews(i)}
                    disabled={addingNewsIndex === i || !analysis.analysis || !!analysis.error}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: addingNewsIndex === i || !analysis.analysis || !!analysis.error ? '#9ca3af' : '#6366f1',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '13px',
                      fontWeight: '500',
                      cursor: addingNewsIndex === i || !analysis.analysis || !!analysis.error ? 'not-allowed' : 'pointer',
                      transition: 'all 0.2s',
                      userSelect: 'none',
                      WebkitUserSelect: 'none',
                      MozUserSelect: 'none',
                      msUserSelect: 'none'
                    }}
                    onMouseEnter={(e) => {
                      if (addingNewsIndex !== i && analysis.analysis && !analysis.error) {
                        e.currentTarget.style.backgroundColor = '#4f46e5';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (addingNewsIndex !== i && analysis.analysis && !analysis.error) {
                        e.currentTarget.style.backgroundColor = '#6366f1';
                      }
                    }}
                  >
                    {addingNewsIndex === i ? 'Adding News...' : 'Add Benzinga News'}
                  </button>

                  <AddSubheadsButton
                    articleText={analysis.analysis}
                    onArticleUpdate={(newText) => updateAnalysisText(i, newText)}
                    backendUrl={NEWS_AGENT_URL}
                  />

                  <button

                    onClick={() => copyAnalysisHTML(i)}

                    style={{
                      padding: '8px 16px',
                      backgroundColor: copiedIndex === i ? '#10b981' : '#dbeafe',
                      color: copiedIndex === i ? 'white' : '#1e40af',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '13px',
                      fontWeight: '500',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      userSelect: 'none',
                      WebkitUserSelect: 'none',
                      MozUserSelect: 'none',
                      msUserSelect: 'none'
                    }}

                    onMouseEnter={(e) => {
                      if (copiedIndex !== i) {
                        e.currentTarget.style.backgroundColor = '#bfdbfe';
                      }
                    }}

                    onMouseLeave={(e) => {
                      if (copiedIndex !== i) {
                        e.currentTarget.style.backgroundColor = '#dbeafe';
                      }
                    }}

                  >

                    {copiedIndex === i ? '✓ Copied!' : 'Copy'}

                  </button>

                </div>
                {newsErrors[i] && (
                  <div style={{
                    padding: '8px 12px',
                    backgroundColor: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: '6px',
                    marginBottom: '12px'
                  }}>
                    <p style={{ color: '#dc2626', fontSize: '12px', margin: 0 }}>{newsErrors[i]}</p>
                  </div>
                )}



                <div style={{
                  color: '#111827',
                  whiteSpace: 'pre-wrap',
                  fontSize: '14px',
                  lineHeight: '1.6',
                  fontFamily: 'Arial, sans-serif'
                }}>

                  {(() => {
                    // Smart splitting that preserves HTML lists
                    const content = analysis.analysis;
                    const parts: string[] = [];
                    let currentPart = '';
                    let inList = false;
                    let listDepth = 0;
                    
                    // Split by double newlines, but keep lists together
                    const paragraphs = content.split(/\n\s*\n/);
                    
                    for (let i = 0; i < paragraphs.length; i++) {
                      const para = paragraphs[i].trim();
                      if (!para) continue;
                      
                      // Count list tags to track if we're inside a list
                      const openTags = (para.match(/<ul>|<ol>/gi) || []).length;
                      const closeTags = (para.match(/<\/ul>|<\/ol>/gi) || []).length;
                      
                      // If we're already in a list or this paragraph starts/contains a list
                      if (inList || para.includes('<ul>') || para.includes('<ol>') || para.includes('<li>')) {
                        currentPart += (currentPart ? '\n\n' : '') + para;
                        listDepth += openTags - closeTags;
                        inList = listDepth > 0;
                        
                        // If list is closed, push the accumulated part
                        if (!inList && currentPart.trim()) {
                          parts.push(currentPart.trim());
                          currentPart = '';
                        }
                      } else {
                        // If we have accumulated content, push it first
                        if (currentPart.trim()) {
                          parts.push(currentPart.trim());
                          currentPart = '';
                        }
                        // Push this regular paragraph
                        parts.push(para);
                      }
                    }
                    
                    // Push any remaining accumulated content
                    if (currentPart.trim()) {
                      parts.push(currentPart.trim());
                    }
                    
                    return parts.filter(p => p.trim()).map((paragraph: string, pIndex: number) => {
                      // Process both markdown bold (**text**) and HTML bold (<strong>text</strong>) for all paragraphs
                      let processedParagraph = paragraph.trim();
                    
                    // Check if this paragraph is an H2 tag
                    const h2Match = processedParagraph.match(/^<h2>(.*?)<\/h2>$/i);
                    if (h2Match) {
                      return (
                        <h2
                          key={pIndex}
                          style={{
                            fontSize: '20px',
                            fontWeight: '600',
                            marginTop: '24px',
                            marginBottom: '12px',
                            color: '#1e293b',
                            lineHeight: '1.3'
                          }}
                        >
                          {h2Match[1]}
                        </h2>
                      );
                    }
                    
                    // Check if paragraph contains H2 tag (might have other content)
                    if (processedParagraph.includes('<h2>')) {
                      // Extract and render H2 separately, then render remaining content
                      const h2Regex = /<h2>(.*?)<\/h2>/gi;
                      const parts: Array<{ type: 'h2' | 'text'; content: string }> = [];
                      let lastIndex = 0;
                      let match;
                      
                      while ((match = h2Regex.exec(processedParagraph)) !== null) {
                        // Add text before H2
                        if (match.index > lastIndex) {
                          const textBefore = processedParagraph.substring(lastIndex, match.index).trim();
                          if (textBefore) {
                            parts.push({ type: 'text', content: textBefore });
                          }
                        }
                        // Add H2
                        parts.push({ type: 'h2', content: match[1] });
                        lastIndex = match.index + match[0].length;
                      }
                      
                      // Add remaining text after last H2
                      if (lastIndex < processedParagraph.length) {
                        const textAfter = processedParagraph.substring(lastIndex).trim();
                        if (textAfter) {
                          parts.push({ type: 'text', content: textAfter });
                        }
                      }
                      
                      return (
                        <React.Fragment key={pIndex}>
                          {parts.map((part, partIndex) => {
                            if (part.type === 'h2') {
                              return (
                                <h2
                                  key={`${pIndex}-${partIndex}`}
                                  style={{
                                    fontSize: '20px',
                                    fontWeight: '600',
                                    marginTop: '24px',
                                    marginBottom: '12px',
                                    color: '#1e293b',
                                    lineHeight: '1.3'
                                  }}
                                >
                                  {part.content}
                                </h2>
                              );
                            } else {
                              // Process text content
                              let textContent = part.content;
                              textContent = textContent.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
                              
                              // Check if this content contains a list
                              const hasList = textContent.includes('<ul>') || textContent.includes('<ol>') || textContent.includes('<li>');
                              
                              if (hasList) {
                                // Clean up list HTML formatting
                                const listHtml = textContent
                                  .replace(/\n\s*<li>/g, '<li>')
                                  .replace(/<\/li>\s*\n/g, '</li>')
                                  .replace(/\n\s*<\/ul>/g, '</ul>')
                                  .replace(/\n\s*<\/ol>/g, '</ol>');
                                
                                return (
                                  <div
                                    key={`${pIndex}-${partIndex}`}
                                    style={{
                                      marginBottom: '16px',
                                      marginTop: 0
                                    }}
                                    dangerouslySetInnerHTML={{ __html: listHtml }}
                                  />
                                );
                              }
                              
                              return (
                                <p
                                  key={`${pIndex}-${partIndex}`}
                                  style={{
                                    marginBottom: '16px',
                                    marginTop: 0
                                  }}
                                  dangerouslySetInnerHTML={(textContent.includes('<strong>') || textContent.includes('<a ')) ? { __html: textContent } : undefined}
                                >
                                  {!(textContent.includes('<strong>') || textContent.includes('<a ')) ? textContent : null}
                                </p>
                              );
                            }
                          })}
                        </React.Fragment>
                      );
                    }
                    
                    // Convert markdown bold to HTML bold
                    processedParagraph = processedParagraph.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
                    
                    // Check if paragraph contains HTML list tags (check before and after processing)
                    const hasList = processedParagraph.includes('<ul>') || processedParagraph.includes('<ol>') || processedParagraph.includes('<li>');
                    
                    // If it's a list, render it as a div instead of p tag
                    if (hasList) {
                      // Ensure the list HTML is properly formatted
                      // Replace newlines within list items with spaces to prevent breaking
                      const listHtml = processedParagraph
                        .replace(/\n\s*<li>/g, '<li>')
                        .replace(/<\/li>\s*\n/g, '</li>')
                        .replace(/\n\s*<\/ul>/g, '</ul>')
                        .replace(/\n\s*<\/ol>/g, '</ol>');
                      
                      return (
                        <div
                          key={pIndex}
                          style={{
                            marginBottom: '16px',
                            marginTop: 0
                          }}
                          dangerouslySetInnerHTML={{ __html: listHtml }}
                        />
                      );
                    }

                    

                    return (

                      <p 

                        key={pIndex} 

                        style={{
                          marginBottom: '16px',
                          marginTop: 0
                        }}

                        dangerouslySetInnerHTML={(processedParagraph.includes('<strong>') || processedParagraph.includes('<a ') || processedParagraph.includes('<h2>') || processedParagraph.includes('<ul>') || processedParagraph.includes('<li>')) ? { __html: processedParagraph } : undefined}

                      >

                        {!(processedParagraph.includes('<strong>') || processedParagraph.includes('<a ') || processedParagraph.includes('<h2>') || processedParagraph.includes('<ul>') || processedParagraph.includes('<li>')) ? processedParagraph : null}

                      </p>

                    );
                    });
                  })()}

                </div>

              </div>

            );

          })}

        </div>

      )}

    </section>

  );

});



TechnicalAnalysisGenerator.displayName = 'TechnicalAnalysisGenerator';



export default TechnicalAnalysisGenerator;

