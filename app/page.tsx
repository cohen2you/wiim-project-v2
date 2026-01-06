'use client';

import React, { useState, useRef, useEffect } from 'react';
import ModularStoryBuilder from '../components/ModularStoryBuilder';
import CustomizeContextModal from '../components/CustomizeContextModal';
import AnalystNoteUpload from '../components/AnalystNoteUpload';
import LocalDate from '../components/LocalDate';

interface PR {
  id: string;
  headline: string;
  body: string;
  created: string;
  url?: string;
}

export default function PRStoryGeneratorPage() {
  const [ticker, setTicker] = useState('');
  const [tickerError, setTickerError] = useState('');
  const [prs, setPrs] = useState<PR[]>([]);
  const [selectedPR, setSelectedPR] = useState<PR | null>(null);
  const [loadingPRs, setLoadingPRs] = useState(false);
  const [loadingTenArticles, setLoadingTenArticles] = useState(false);
  const [prError, setPrError] = useState('');
  const [lastPrTicker, setLastPrTicker] = useState('');
  const [prFetchAttempted, setPrFetchAttempted] = useState(false);
  const [hideUnselectedPRs, setHideUnselectedPRs] = useState(false);
  const [article, setArticle] = useState('');
  const [primaryText, setPrimaryText] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [scrapingUrl, setScrapingUrl] = useState(false);
  const [scrapingError, setScrapingError] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);
  const [addingNews, setAddingNews] = useState(false);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [lastGeneratedStoryType, setLastGeneratedStoryType] = useState<'wiiim' | 'wgo' | 'wgoNoNews' | null>(null);
  const [showUploadSection, setShowUploadSection] = useState(false);
  const [showCustomizeModal, setShowCustomizeModal] = useState(false);
  const [loadingCustomContext, setLoadingCustomContext] = useState(false);
  const [contextError, setContextError] = useState('');
  const [copied, setCopied] = useState(false);
  const [loadingStandardStory, setLoadingStandardStory] = useState(false);
  const [loadingBaseStory, setLoadingBaseStory] = useState(false);
  const [baseStoryError, setBaseStoryError] = useState('');
  const [standardStoryError, setStandardStoryError] = useState('');
  const [loadingEnrichedWGO, setLoadingEnrichedWGO] = useState(false);
  const [enrichedWGOError, setEnrichedWGOError] = useState('');
  const [enrichedWGO, setEnrichedWGO] = useState(false);
  
  // URL-based source inputs
  const [primarySourceUrl, setPrimarySourceUrl] = useState('');
  const [contextSourceUrl, setContextSourceUrl] = useState('');
  const [scrapedPrimaryContent, setScrapedPrimaryContent] = useState('');
  const [scrapedContextContent, setScrapedContextContent] = useState('');
  const [loadingPrimaryScrape, setLoadingPrimaryScrape] = useState(false);
  const [loadingContextScrape, setLoadingContextScrape] = useState(false);
  const [primaryScrapeError, setPrimaryScrapeError] = useState('');
  const [contextScrapeError, setContextScrapeError] = useState('');
  
  // PR and News Post selection states
  const [fetchedPRs, setFetchedPRs] = useState<PR[]>([]);
  const [fetchedNewsPosts, setFetchedNewsPosts] = useState<PR[]>([]);
  const [showPRResults, setShowPRResults] = useState(false);
  const [showNewsResults, setShowNewsResults] = useState(false);
  const [selectedPRForPrimary, setSelectedPRForPrimary] = useState<PR | null>(null);
  const [selectedNewsForContext, setSelectedNewsForContext] = useState<PR | null>(null);

  // Mode state
  const [useModularApproach, setUseModularApproach] = useState(true);
  
  // AI Provider state
  const [aiProvider, setAiProvider] = useState<'openai' | 'gemini'>('openai');

  // Debug useEffect to monitor state changes
  useEffect(() => {
    console.log('State changed - showManualInput:', showManualInput, 'primaryText length:', primaryText.length);
  }, [showManualInput, primaryText]);

  const fetchPRs = async () => {
    if (!ticker.trim()) {
      setTickerError('Please enter a stock ticker');
      return;
    }

    setLoadingPRs(true);
    setPrError('');
    setPrs([]);
    setSelectedPR(null);
    setLastPrTicker(ticker);

    try {
      const res = await fetch('/api/bz/prs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch press releases');

      setPrs(data.prs || []);
      setFetchedPRs(data.prs || []);
      setShowPRResults(true);
      setPrFetchAttempted(true);
    } catch (err: any) {
      setPrError(err.message || 'Failed to fetch press releases');
    } finally {
      setLoadingPRs(false);
    }
  };

  const fetchTenNewestArticles = async () => {
    if (!ticker.trim()) {
      setTickerError('Please enter a stock ticker');
      return;
    }

    setLoadingTenArticles(true);
    setPrError('');
    setPrs([]);
    setSelectedPR(null);
    setLastPrTicker(ticker);

    try {
      const res = await fetch('/api/bz/articles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, count: 10 }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch articles');

      setPrs(data.articles || []);
      setFetchedNewsPosts(data.articles || []);
      setShowNewsResults(true);
      setPrFetchAttempted(true);
    } catch (err: any) {
      setPrError(err.message || 'Failed to fetch articles');
    } finally {
      setLoadingTenArticles(false);
    }
  };

  const handleSelectPR = (pr: PR) => {
    setSelectedPR(selectedPR?.id === pr.id ? null : pr);
    setPrimaryText(pr.body);
  };

  const handleSelectPRForPrimary = (pr: PR) => {
    setSelectedPRForPrimary(pr);
    setPrimarySourceUrl(pr.url || '');
    setShowPRResults(false);
  };

  const handleSelectNewsForContext = (news: PR) => {
    setSelectedNewsForContext(news);
    setContextSourceUrl(news.url || '');
    setShowNewsResults(false);
  };

  const handleScrapeUrl = async () => {
    if (!sourceUrl.trim()) return;

    console.log('Starting scrape for URL:', sourceUrl);
    setScrapingUrl(true);
    setScrapingError('');

    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: sourceUrl }),
      });

      console.log('Response status:', res.status);
      const data = await res.json();
      console.log('Response data:', data);
      
      if (!res.ok) throw new Error(data.error || 'Failed to scrape URL');

      console.log('Scraped text received:', data.text?.substring(0, 100) + '...');
      console.log('Text length:', data.text?.length);
      
      setPrimaryText(data.text || '');
      setShowManualInput(true); // Show the manual input section to display scraped content
      console.log('showManualInput set to true');
      
      // Force a re-render check
      setTimeout(() => {
        console.log('After timeout - showManualInput:', showManualInput, 'primaryText length:', primaryText.length);
      }, 100);
      
    } catch (err: any) {
      console.error('Scrape error:', err);
      setScrapingError(err.message || 'Failed to scrape URL');
    } finally {
      setScrapingUrl(false);
    }
  };

  const handleScrapePrimarySource = async () => {
    if (!primarySourceUrl.trim()) return;

    console.log('Starting scrape for primary source URL:', primarySourceUrl);
    setLoadingPrimaryScrape(true);
    setPrimaryScrapeError('');

    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: primarySourceUrl }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to scrape primary source URL');

      setScrapedPrimaryContent(data.text || '');
      setPrimaryText(data.text || ''); // Also set the legacy primaryText for compatibility
      console.log('Primary source scraped successfully');
      
    } catch (err: any) {
      console.error('Primary source scrape error:', err);
      setPrimaryScrapeError(err.message || 'Failed to scrape primary source URL');
    } finally {
      setLoadingPrimaryScrape(false);
    }
  };

  const handleScrapeContextSource = async () => {
    if (!contextSourceUrl.trim()) return;

    console.log('Starting scrape for context source URL:', contextSourceUrl);
    setLoadingContextScrape(true);
    setContextScrapeError('');

    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: contextSourceUrl }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to scrape context source URL');

      setScrapedContextContent(data.text || '');
      console.log('Context source scraped successfully');
      
    } catch (err: any) {
      console.error('Context source scrape error:', err);
      setContextScrapeError(err.message || 'Failed to scrape context source URL');
    } finally {
      setLoadingContextScrape(false);
    }
  };

  const handleAnalystNoteTextExtracted = (text: string, tickerParam?: string) => {
    setPrimaryText(text);
    // If ticker is provided and different, update it
    if (tickerParam && tickerParam !== ticker) {
      setTicker(tickerParam);
    }
    // Show the manual input section so user can see the extracted text
    setShowManualInput(true);
  };

  const handleModularStoryUpdate = (story: string) => {
    setArticle(story);
  };

  const handleUseAsBaseStory = async () => {
    if (!primaryText.trim() || !ticker.trim()) {
      alert('Please ensure you have both scraped content and a ticker entered.');
      return;
    }

    setLoadingBaseStory(true);
    try {
      const res = await fetch('/api/generate/base-story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          ticker,
          scrapedContent: primaryText,
          scrapedUrl: sourceUrl,
          aiProvider
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.story) throw new Error(data.error || 'Failed to generate base story');

      setArticle(data.story);
      console.log('Base story generated successfully:', data.story.substring(0, 100) + '...');
    } catch (err: any) {
      console.error('Base story generation error:', err);
      alert('Failed to generate base story: ' + err.message);
    } finally {
      setLoadingBaseStory(false);
    }
  };

  const handleGenerateStoryFromUrls = async () => {
    if (!scrapedPrimaryContent.trim() || !ticker.trim()) {
      setBaseStoryError('Please ensure you have scraped primary source content and a ticker entered.');
      return;
    }

    setLoadingBaseStory(true);
    setBaseStoryError('');
    try {
      const res = await fetch('/api/generate/base-story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          ticker,
          scrapedContent: scrapedPrimaryContent,
          scrapedUrl: primarySourceUrl,
          contextContent: scrapedContextContent,
          contextUrl: contextSourceUrl,
          aiProvider
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.story) throw new Error(data.error || 'Failed to generate story from URLs');

      setArticle(data.story);
      console.log('Story generated from URLs successfully:', data.story.substring(0, 100) + '...');
    } catch (err: any) {
      console.error('URL-based story generation error:', err);
      setBaseStoryError('Failed to generate story from URLs: ' + err.message);
    } finally {
      setLoadingBaseStory(false);
    }
  };

  const handleCustomContextGeneration = async (selectedArticles: any[]) => {
    if (!article) {
      setContextError('No existing story to add context to');
      return;
    }
    
    setLoadingCustomContext(true);
    setContextError('');
    
    try {
      const res = await fetch('/api/generate/add-custom-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          ticker, 
          existingStory: article,
          selectedArticles,
          aiProvider
        }),
      });
      
      const data = await res.json();
      if (!res.ok || !data.story) throw new Error(data.error || 'Failed to add custom context');
      
      setArticle(data.story);
    } catch (err: any) {
      setContextError(err.message || 'Failed to add custom context');
    } finally {
      setLoadingCustomContext(false);
    }
  };

  const handleClearAll = () => {
    setTicker('');
    setTickerError('');
    setPrs([]);
    setSelectedPR(null);
    setArticle('');
    setPrimaryText('');
    setSourceUrl('');
    setScrapingError('');
    setPrError('');
    setContextError('');
    setStandardStoryError('');
    setBaseStoryError('');
    setShowManualInput(false);
    setShowUploadSection(false);
    setShowCustomizeModal(false);
    setLoadingCustomContext(false);
    setLoadingStandardStory(false);
    setLoadingBaseStory(false);
    setPrFetchAttempted(false);
    setLastPrTicker('');
    setLastGeneratedStoryType(null);
  };

  const handleStandardStoryGeneration = async (type: 'wiiim' | 'wgo' | 'wgoNoNews') => {
    if (!ticker.trim()) {
      setTickerError('Please enter a stock ticker');
      return;
    }

    setLoadingStandardStory(true);
    setStandardStoryError('');
    setArticle('');
    setEnrichedWGO(false);

    try {
      let endpoint = '';
      let requestBody: any = { ticker, aiProvider };

      switch (type) {
        case 'wiiim':
          endpoint = '/api/generate/wiiim';
          break;
        case 'wgo':
          endpoint = '/api/generate/wgo';
          break;
        case 'wgoNoNews':
          endpoint = '/api/generate/technical-analysis';
          requestBody = { tickers: ticker, provider: aiProvider };
          break;
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const data = await res.json();
      
      if (type === 'wgoNoNews') {
        // technical-analysis returns { analyses: [...] }
        if (!res.ok || !data.analyses || !Array.isArray(data.analyses) || data.analyses.length === 0) {
          throw new Error(data.error || `Failed to generate ${type} story`);
        }
        const analysis = data.analyses[0];
        if (analysis.error) {
          throw new Error(analysis.error);
        }
        setArticle(analysis.analysis || '');
      } else {
        // wiiim and wgo return { story: ... }
        if (!res.ok || !data.story) throw new Error(data.error || `Failed to generate ${type} story`);
        setArticle(data.story);
      }
      
      setLastGeneratedStoryType(type);
    } catch (err: any) {
      setStandardStoryError(err.message || `Failed to generate ${type} story`);
    } finally {
      setLoadingStandardStory(false);
    }
  };

  const handleEnrichedWGOGeneration = async () => {
    if (!ticker.trim()) {
      setTickerError('Please enter a stock ticker');
      return;
    }

    setLoadingEnrichedWGO(true);
    setEnrichedWGOError('');
    setArticle('');
    setEnrichedWGO(true);

    try {
      const NEWS_AGENT_URL = process.env.NEXT_PUBLIC_NEWS_AGENT_URL || 'http://localhost:3000';
      const tickerUpper = ticker.toUpperCase();
      
      // Step 1: Fetch context brief from external agent
      console.log(`[ENRICHED WGO] ${tickerUpper}: Fetching context brief from ${NEWS_AGENT_URL}/api/enrichment/context-brief`);
      const contextRes = await fetch(`${NEWS_AGENT_URL}/api/enrichment/context-brief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: tickerUpper })
      });
      
      let contextBrief = null;
      if (contextRes.ok) {
        contextBrief = await contextRes.json();
        console.log(`[ENRICHED WGO] ${tickerUpper}: Successfully fetched context brief:`, {
          hasData: !!contextBrief,
          majorEventDetected: contextBrief?.major_event_detected || false,
          sentiment: contextBrief?.sentiment || null,
          hasSummary: !!contextBrief?.summary_of_events,
          articleCount: contextBrief?.articles?.length || 0
        });
      } else {
        const errorText = await contextRes.text().catch(() => '');
        console.warn(`[ENRICHED WGO] ${tickerUpper}: Failed to fetch context brief:`, contextRes.status, errorText.substring(0, 200));
      }

      // Step 2: Call technical-analysis endpoint with context brief
      const requestBody: any = { 
        tickers: tickerUpper,
        provider: aiProvider,
        contextBriefs: contextBrief ? { [tickerUpper]: contextBrief } : undefined
      };

      const res = await fetch('/api/generate/technical-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const data = await res.json();
      if (!res.ok || !data.analyses || !Array.isArray(data.analyses) || data.analyses.length === 0) {
        throw new Error(data.error || 'Failed to generate enriched WGO story');
      }

      const analysis = data.analyses[0];
      if (analysis.error) {
        throw new Error(analysis.error);
      }

      setArticle(analysis.analysis || '');
      setLastGeneratedStoryType('wgoNoNews');
    } catch (err: any) {
      setEnrichedWGOError(err.message || 'Failed to generate enriched WGO story');
    } finally {
      setLoadingEnrichedWGO(false);
    }
  };

  // Function to add Benzinga news to WGO No News article
  const handleAddBenzingaNews = async () => {
    if (!article || !ticker.trim()) {
      setNewsError('No article available to add news to');
      return;
    }

    setAddingNews(true);
    setNewsError(null);

    try {
      const NEWS_AGENT_URL = process.env.NEXT_PUBLIC_NEWS_AGENT_URL || 'http://localhost:3000';
      
      const response = await fetch(`${NEWS_AGENT_URL}/api/enrichment/add-news`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ticker: ticker.toUpperCase(),
          articleText: article,
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
        let updatedArticle = article;
        
        // Find the position to insert: after "The Catalyst" section, before "Technical Analysis"
        const technicalAnalysisMarker = /##\s*Section:\s*Technical Analysis/i;
        
        // Check if "Technical Analysis" section exists
        if (technicalAnalysisMarker.test(updatedArticle)) {
          // Find the position right before "Technical Analysis"
          const match = updatedArticle.match(technicalAnalysisMarker);
          if (match && match.index !== undefined) {
            // Insert news section before "Technical Analysis"
            const beforeTechnical = updatedArticle.substring(0, match.index).trim();
            const afterTechnical = updatedArticle.substring(match.index);
            updatedArticle = beforeTechnical + '\n\n' + newsSection + '\n\n' + afterTechnical;
          } else {
            // Fallback: append at end if insertion point not found
            updatedArticle = updatedArticle + '\n\n' + newsSection;
          }
        } else {
          // If "Technical Analysis" doesn't exist, try to find "The Catalyst" and insert after it
          const catalystMarker = /(##\s*Section:\s*The Catalyst[\s\S]*?)(?=##\s*Section:|$)/i;
          if (catalystMarker.test(updatedArticle)) {
            updatedArticle = updatedArticle.replace(
              catalystMarker,
              `$1\n\n${newsSection}\n\n`
            );
          } else {
            // Fallback: append at end if neither section is found
            updatedArticle = updatedArticle + '\n\n' + newsSection;
          }
        }
        
        setArticle(updatedArticle);
        setNewsError(null);
      } else {
        throw new Error(data.error || 'Failed to add news section');
      }
    } catch (error) {
      console.error('Error calling enrichment API:', error);
      if (error instanceof Error) {
        setNewsError(`Failed to add news: ${error.message}`);
      } else {
        setNewsError('Failed to add news. Check browser console for details.');
      }
    } finally {
      setAddingNews(false);
    }
  };

  return (
    <div style={{ maxWidth: 700, margin: 'auto', padding: 20, fontFamily: 'Arial, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1>Benzinga WIIM Story Generator</h1>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            onClick={() => setUseModularApproach(!useModularApproach)}
            style={{ 
              padding: '6px 12px', 
              background: useModularApproach ? '#059669' : '#2563eb', 
              color: 'white', 
              border: 'none', 
              borderRadius: 4,
              fontSize: '14px'
            }}
          >
            {useModularApproach ? 'Modular Mode' : 'Standard Mode'}
          </button>
          <button
            onClick={handleClearAll}
            style={{ padding: '6px 12px', background: '#b91c1c', color: 'white', border: 'none', borderRadius: 4 }}
          >
            Clear All Data
          </button>
        </div>
      </div>

      {/* AI Provider Selector */}
      <div style={{ marginBottom: 20, padding: '12px', backgroundColor: '#f0f9ff', borderRadius: '8px', border: '1px solid #0ea5e9' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500', color: '#0c4a6e', fontSize: '14px' }}>
          AI Provider:
        </label>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setAiProvider('openai')}
            style={{
              padding: '8px 16px',
              background: aiProvider === 'openai' ? '#10b981' : '#e5e7eb',
              color: aiProvider === 'openai' ? 'white' : '#374151',
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: '500',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            OpenAI
          </button>
          <button
            onClick={() => setAiProvider('gemini')}
            style={{
              padding: '8px 16px',
              background: aiProvider === 'gemini' ? '#10b981' : '#e5e7eb',
              color: aiProvider === 'gemini' ? 'white' : '#374151',
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: '500',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            Gemini
          </button>
        </div>
        <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px' }}>
          Currently using: <strong>{aiProvider === 'openai' ? 'OpenAI (GPT-4)' : 'Google Gemini'}</strong>
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <label>
          Stock Ticker:{' '}
          <input
            type="text"
            value={ticker}
            onChange={e => {
              setTicker(e.target.value.toUpperCase());
              if (e.target.value.trim()) {
                setTickerError('');
              }
            }}
            placeholder="e.g. AAPL"
            style={{ fontSize: 16, padding: 6, width: 120 }}
            disabled={loadingPRs}
          />
        </label>
        {tickerError && (
          <div style={{ color: 'red', fontSize: 14, marginTop: 4 }}>
            {tickerError}
          </div>
        )}
      </div>

      {/* URL-based Source Inputs */}
      <div style={{ marginBottom: 20, padding: '16px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
        <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px', color: '#1e293b' }}>
          Source URLs (Recommended)
        </h3>
        
        {/* Primary Source URL */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500', color: '#374151' }}>
            Primary Source URL (Benzinga PR) *
          </label>
          
          {/* PR Selection Section */}
          {showPRResults && (
            <div style={{ marginBottom: '12px', padding: '12px', backgroundColor: '#f0f9ff', borderRadius: '6px', border: '1px solid #0ea5e9' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: '500', color: '#0c4a6e' }}>
                  Select a PR for Primary Source:
                </span>
                <button
                  onClick={() => setShowPRResults(false)}
                  style={{ 
                    padding: '4px 8px', 
                    background: '#dc2626', 
                    color: 'white', 
                    border: 'none', 
                    borderRadius: '4px',
                    fontSize: '12px',
                    cursor: 'pointer'
                  }}
                >
                  Hide
                </button>
              </div>
              <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                {fetchedPRs.map((pr, index) => (
                  <div
                    key={pr.id}
                    onClick={() => handleSelectPRForPrimary(pr)}
                    style={{
                      padding: '8px 12px',
                      marginBottom: '4px',
                      backgroundColor: selectedPRForPrimary?.id === pr.id ? '#dbeafe' : 'white',
                      border: '1px solid #d1d5db',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      lineHeight: '1.4'
                    }}
                  >
                    <div style={{ fontWeight: '500', marginBottom: '4px' }}>
                      {pr.headline}
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>
                      {new Date(pr.created).toLocaleDateString()} • {pr.body.substring(0, 100)}...
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="url"
              value={primarySourceUrl}
              onChange={e => setPrimarySourceUrl(e.target.value)}
              placeholder="https://www.benzinga.com/pressreleases/..."
              style={{ 
                flex: 1,
                fontSize: 14, 
                padding: '8px 12px', 
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                backgroundColor: 'white'
              }}
            />
            {primarySourceUrl.trim() && (
              <button
                onClick={handleScrapePrimarySource}
                disabled={loadingPrimaryScrape}
                style={{ 
                  padding: '8px 16px', 
                  background: loadingPrimaryScrape ? '#6b7280' : '#059669', 
                  color: 'white', 
                  border: 'none', 
                  borderRadius: '6px',
                  fontSize: 14,
                  fontWeight: '500',
                  cursor: loadingPrimaryScrape ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                {loadingPrimaryScrape ? 'Scraping...' : 'Scrape PR'}
              </button>
            )}
          </div>
          {selectedPRForPrimary && (
            <div style={{ color: '#059669', fontSize: '12px', marginTop: '4px' }}>
              ✓ Selected PR: {selectedPRForPrimary.headline}
            </div>
          )}
          {primaryScrapeError && (
            <div style={{ color: '#dc2626', fontSize: 12, marginTop: '4px' }}>
              {primaryScrapeError}
            </div>
          )}
          {scrapedPrimaryContent && (
            <div style={{ color: '#059669', fontSize: 12, marginTop: '4px' }}>
              ✓ Primary source scraped successfully ({scrapedPrimaryContent.length} characters)
            </div>
          )}
        </div>

        {/* Context Source URL */}
        <div style={{ marginBottom: '8px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500', color: '#374151' }}>
            Context Source URL (Benzinga Article) - Optional
          </label>
          
          {/* News Post Selection Section */}
          {showNewsResults && (
            <div style={{ marginBottom: '12px', padding: '12px', backgroundColor: '#fef3c7', borderRadius: '6px', border: '1px solid #f59e0b' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: '500', color: '#92400e' }}>
                  Select a News Post for Context Source:
                </span>
                <button
                  onClick={() => setShowNewsResults(false)}
                  style={{ 
                    padding: '4px 8px', 
                    background: '#dc2626', 
                    color: 'white', 
                    border: 'none', 
                    borderRadius: '4px',
                    fontSize: '12px',
                    cursor: 'pointer'
                  }}
                >
                  Hide
                </button>
              </div>
              <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                {fetchedNewsPosts.map((news, index) => (
                  <div
                    key={news.id}
                    onClick={() => handleSelectNewsForContext(news)}
                    style={{
                      padding: '8px 12px',
                      marginBottom: '4px',
                      backgroundColor: selectedNewsForContext?.id === news.id ? '#fef3c7' : 'white',
                      border: '1px solid #d1d5db',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      lineHeight: '1.4'
                    }}
                  >
                    <div style={{ fontWeight: '500', marginBottom: '4px' }}>
                      {news.headline}
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>
                      {new Date(news.created).toLocaleDateString()} • {news.body.substring(0, 100)}...
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="url"
              value={contextSourceUrl}
              onChange={e => setContextSourceUrl(e.target.value)}
              placeholder="https://www.benzinga.com/news/..."
              style={{ 
                flex: 1,
                fontSize: 14, 
                padding: '8px 12px', 
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                backgroundColor: 'white'
              }}
            />
            {contextSourceUrl.trim() && (
              <button
                onClick={handleScrapeContextSource}
                disabled={loadingContextScrape}
                style={{ 
                  padding: '8px 16px', 
                  background: loadingContextScrape ? '#6b7280' : '#2563eb', 
                  color: 'white', 
                  border: 'none', 
                  borderRadius: '6px',
                  fontSize: 14,
                  fontWeight: '500',
                  cursor: loadingContextScrape ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                {loadingContextScrape ? 'Scraping...' : 'Scrape Article'}
              </button>
            )}
          </div>
          {selectedNewsForContext && (
            <div style={{ color: '#2563eb', fontSize: '12px', marginTop: '4px' }}>
              ✓ Selected News: {selectedNewsForContext.headline}
            </div>
          )}
          {contextScrapeError && (
            <div style={{ color: '#dc2626', fontSize: 12, marginTop: '4px' }}>
              {contextScrapeError}
            </div>
          )}
          {scrapedContextContent && (
            <div style={{ color: '#2563eb', fontSize: 12, marginTop: '4px' }}>
              ✓ Context source scraped successfully ({scrapedContextContent.length} characters)
            </div>
          )}
        </div>

        <div style={{ fontSize: 12, color: '#6b7280', marginTop: '8px', fontStyle: 'italic' }}>
          * Primary source is required. Context source is optional but recommended for better story quality.
        </div>
        
        {/* Generate Story from URLs Button */}
        {scrapedPrimaryContent && (
          <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #e2e8f0' }}>
            <button
              onClick={handleGenerateStoryFromUrls}
              disabled={loadingBaseStory}
              style={{ 
                padding: '12px 24px', 
                background: loadingBaseStory ? '#6b7280' : '#059669', 
                color: 'white', 
                border: 'none', 
                borderRadius: '8px',
                fontSize: 16,
                fontWeight: '600',
                cursor: loadingBaseStory ? 'not-allowed' : 'pointer',
                width: '100%'
              }}
            >
              {loadingBaseStory ? 'Generating Story...' : 'Generate Story from URLs'}
            </button>
            {baseStoryError && (
              <div style={{ fontSize: 12, color: '#dc2626', marginTop: '8px', textAlign: 'center', padding: '8px', backgroundColor: '#fef2f2', borderRadius: '4px', border: '1px solid #fecaca' }}>
                {baseStoryError}
              </div>
            )}
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: '8px', textAlign: 'center' }}>
              This will create a base story using your scraped content, then you can add enhancements below.
            </div>
          </div>
        )}
      </div>
      
      <div style={{ marginBottom: 20 }}>
        <button
          onClick={fetchPRs}
          style={{ marginRight: 10, padding: '6px 12px' }}
        >
          {loadingPRs ? 'Fetching PRs...' : 'Fetch PRs'}
        </button>
        <button
          onClick={fetchTenNewestArticles}
          style={{ marginRight: 10, padding: '6px 12px' }}
        >
          {loadingTenArticles ? 'Fetching Posts...' : 'Fetch 10 Newest Posts'}
        </button>
        <button
          onClick={() => {
            console.log('Analyst Note Upload button clicked, current state:', showUploadSection);
            setShowUploadSection(!showUploadSection);
          }}
          style={{ padding: '6px 12px' }}
        >
          {showUploadSection ? 'Hide Analyst Note Upload' : 'Analyst Note Upload'}
        </button>
        <button
          onClick={() => setShowManualInput(!showManualInput)}
          style={{ padding: '6px 12px' }}
        >
          {showManualInput ? 'Hide Manual Input' : 'Show Manual Input'}
        </button>
      </div>
      
      {/* Standard Mode Buttons */}
      {!useModularApproach && (
        <div style={{ marginBottom: 20, padding: '16px', backgroundColor: '#f3f4f6', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
          <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px' }}>Standard Mode - Quick Story Generation</h3>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button
              onClick={() => handleStandardStoryGeneration('wiiim')}
              disabled={loadingStandardStory}
              style={{ 
                padding: '8px 16px', 
                backgroundColor: loadingStandardStory ? '#6b7280' : '#059669', 
                color: 'white', 
                border: 'none', 
                borderRadius: '4px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: loadingStandardStory ? 'not-allowed' : 'pointer',
                opacity: loadingStandardStory ? 0.5 : 1
              }}
            >
              {loadingStandardStory ? 'Generating...' : 'WIIM'}
            </button>
            <button
              onClick={() => handleStandardStoryGeneration('wgo')}
              disabled={loadingStandardStory}
              style={{ 
                padding: '8px 16px', 
                backgroundColor: loadingStandardStory ? '#6b7280' : '#2563eb', 
                color: 'white', 
                border: 'none', 
                borderRadius: '4px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: loadingStandardStory ? 'not-allowed' : 'pointer',
                opacity: loadingStandardStory ? 0.5 : 1
              }}
            >
              {loadingStandardStory ? 'Generating...' : 'WGO'}
            </button>
            <button
              onClick={() => handleStandardStoryGeneration('wgoNoNews')}
              disabled={loadingStandardStory}
              style={{ 
                padding: '8px 16px', 
                backgroundColor: loadingStandardStory ? '#6b7280' : '#7c3aed', 
                color: 'white', 
                border: 'none', 
                borderRadius: '4px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: loadingStandardStory ? 'not-allowed' : 'pointer',
                opacity: loadingStandardStory ? 0.5 : 1
              }}
            >
              {loadingStandardStory ? 'Generating...' : 'WGO No News'}
            </button>
            <button
              onClick={handleEnrichedWGOGeneration}
              disabled={loadingEnrichedWGO || loadingStandardStory}
              style={{ 
                padding: '8px 16px', 
                backgroundColor: loadingEnrichedWGO || loadingStandardStory ? '#6b7280' : '#059669', 
                color: 'white', 
                border: 'none', 
                borderRadius: '4px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: loadingEnrichedWGO || loadingStandardStory ? 'not-allowed' : 'pointer',
                opacity: loadingEnrichedWGO || loadingStandardStory ? 0.5 : 1
              }}
            >
              {loadingEnrichedWGO ? 'Enriching & Generating...' : 'Enriched No News WGO'}
            </button>
          </div>
          <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px' }}>
            These buttons generate complete stories using the traditional step-by-step approach.
          </p>
        </div>
      )}
      
      <div style={{ marginBottom: 20 }}>
        <label style={{ display: 'block', marginBottom: 8 }}>
          Source URL (optional):
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="url"
              value={sourceUrl}
              onChange={e => setSourceUrl(e.target.value)}
              placeholder="https://example.com/article-url"
              style={{ 
                flex: 1,
                fontSize: 16, 
                padding: 8, 
                border: '1px solid #ccc',
                borderRadius: 4
              }}
            />
            {sourceUrl.trim() && (
              <button
                onClick={handleScrapeUrl}
                disabled={scrapingUrl}
                style={{ 
                  padding: '8px 12px', 
                  background: scrapingUrl ? '#6b7280' : '#059669', 
                  color: 'white', 
                  border: 'none', 
                  borderRadius: 4,
                  fontSize: 14,
                  cursor: scrapingUrl ? 'not-allowed' : 'pointer'
                }}
              >
                {scrapingUrl ? 'Scraping...' : 'Scrape URL'}
              </button>
            )}
          </div>
        </label>
      </div>

      {/* Error Messages */}
      {scrapingError && <div style={{ color: 'red', marginBottom: 10 }}>{scrapingError}</div>}
      {contextError && <div style={{ color: 'red', marginBottom: 10 }}>{contextError}</div>}
      {standardStoryError && <div style={{ color: 'red', marginBottom: 10 }}>{standardStoryError}</div>}
      
      {/* Manual Input Section - Always show when needed */}
      {showManualInput && (
        <div style={{ marginBottom: 20, backgroundColor: '#f9f9f9', padding: '16px', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
          <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>
            Debug: showManualInput is true, primaryText length: {primaryText.length}
          </div>
          <label style={{ display: 'block', marginBottom: 8 }}>
            <strong>Scraped Article Content:</strong>
            <textarea
              value={primaryText}
              onChange={e => setPrimaryText(e.target.value)}
              placeholder="Paste the article content here..."
              rows={8}
              style={{ 
                display: 'block', 
                width: '100%', 
                fontSize: 14, 
                padding: 8, 
                marginTop: 4,
                border: '1px solid #ccc',
                borderRadius: 4,
                fontFamily: 'monospace'
              }}
            />
          </label>
          {primaryText.trim() && (
            <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
                             <button
                 onClick={handleUseAsBaseStory}
                 disabled={loadingBaseStory}
                 style={{ 
                   padding: '8px 16px', 
                   backgroundColor: loadingBaseStory ? '#6b7280' : '#059669', 
                   color: 'white', 
                   border: 'none', 
                   borderRadius: '4px',
                   fontSize: '14px',
                   cursor: loadingBaseStory ? 'not-allowed' : 'pointer'
                 }}
               >
                 {loadingBaseStory ? 'Generating...' : 'Use as Base Story'}
               </button>
              <button
                onClick={() => setPrimaryText('')}
                style={{ 
                  padding: '8px 16px', 
                  backgroundColor: '#dc2626', 
                  color: 'white', 
                  border: 'none', 
                  borderRadius: '4px',
                  fontSize: '14px',
                  cursor: 'pointer'
                }}
              >
                Clear Content
              </button>
            </div>
          )}
          {article && (
            <div style={{ fontSize: '12px', color: '#059669', marginTop: '8px' }}>
              ✓ Base story generated successfully! You can now use the Modular Story Builder components below.
            </div>
          )}
        </div>
      )}

      {/* Modular Story Builder */}
      {ticker && useModularApproach && (
        <div style={{ marginBottom: 20 }}>
          {article && (
            <div style={{ fontSize: '12px', color: '#059669', marginBottom: '8px', padding: '8px', backgroundColor: '#f0fdf4', borderRadius: '4px', border: '1px solid #bbf7d0' }}>
              ✓ Using generated base story for Modular Story Builder
            </div>
          )}
          <ModularStoryBuilder 
            ticker={ticker} 
            currentArticle={article || primaryText}
            onStoryUpdate={handleModularStoryUpdate}
            aiProvider={aiProvider}
          />
        </div>
      )}

      {/* Standard Mode Story Display */}
      {ticker && !useModularApproach && article && (
        <div style={{ marginBottom: 20, backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '600' }}>Generated Story</h3>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {(lastGeneratedStoryType === 'wgoNoNews' || lastGeneratedStoryType === 'wgo') && !enrichedWGO && (
                <button
                  onClick={handleAddBenzingaNews}
                  disabled={addingNews || !article}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: addingNews || !article ? '#9ca3af' : '#6366f1',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontWeight: '500',
                    cursor: addingNews || !article ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s',
                    userSelect: 'none'
                  }}
                  onMouseEnter={(e) => {
                    if (!addingNews && article) {
                      e.currentTarget.style.backgroundColor = '#4f46e5';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!addingNews && article) {
                      e.currentTarget.style.backgroundColor = '#6366f1';
                    }
                  }}
                >
                  {addingNews ? 'Adding News...' : 'Add Benzinga News'}
                </button>
              )}
              <button
                onClick={() => {
                  navigator.clipboard.writeText(article);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                style={{
                  padding: '8px 16px',
                  backgroundColor: copied ? '#059669' : '#2563eb',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '14px',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s'
                }}
              >
                {copied ? 'Copied!' : 'Copy Story'}
              </button>
            </div>
          </div>
          {newsError && (
            <div style={{ color: '#dc2626', fontSize: '14px', marginBottom: '12px', padding: '8px', backgroundColor: '#fef2f2', borderRadius: '4px', border: '1px solid #fecaca' }}>
              {newsError}
            </div>
          )}
          <div
            style={{ 
              maxHeight: '400px', 
              overflowY: 'auto', 
              border: '1px solid #e5e7eb', 
              borderRadius: '4px', 
              padding: '12px',
              backgroundColor: '#f9fafb',
              fontSize: '14px',
              lineHeight: '1.6'
            }}
            dangerouslySetInnerHTML={{ 
              __html: article
                .split('\n\n')
                .filter(p => p.trim())
                .map(p => `<p style="margin-bottom: 16px;">${p}</p>`)
                .join('')
            }}
          />
        </div>
      )}
      
      {showUploadSection && (
        <AnalystNoteUpload 
          onTextExtracted={handleAnalystNoteTextExtracted} 
          ticker={ticker}
          aiProvider={aiProvider}
        />
      )}
      
      {/* Customize Context Modal */}
      <CustomizeContextModal
        isOpen={showCustomizeModal}
        onClose={() => setShowCustomizeModal(false)}
        ticker={ticker}
        onArticlesSelected={handleCustomContextGeneration}
        loading={loadingCustomContext}
      />

    </div>
  );
}
