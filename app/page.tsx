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
  const [showUploadSection, setShowUploadSection] = useState(false);
  const [showCustomizeModal, setShowCustomizeModal] = useState(false);
  const [loadingCustomContext, setLoadingCustomContext] = useState(false);
  const [contextError, setContextError] = useState('');
  const [copied, setCopied] = useState(false);
  const [loadingStandardStory, setLoadingStandardStory] = useState(false);
  const [loadingBaseStory, setLoadingBaseStory] = useState(false);
  const [standardStoryError, setStandardStoryError] = useState('');

  // Mode state
  const [useModularApproach, setUseModularApproach] = useState(true);

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

    setLoadingPRs(true);
    setPrError('');
    setPrs([]);
    setSelectedPR(null);
    setLastPrTicker(ticker);

    try {
      const res = await fetch('/api/bz/articles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch articles');

      setPrs(data.articles || []);
      setPrFetchAttempted(true);
    } catch (err: any) {
      setPrError(err.message || 'Failed to fetch articles');
    } finally {
      setLoadingPRs(false);
    }
  };

  const handleSelectPR = (pr: PR) => {
    setSelectedPR(selectedPR?.id === pr.id ? null : pr);
    setPrimaryText(pr.body);
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

  const handleAnalystNoteTextExtracted = (text: string) => {
    setPrimaryText(text);
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
          scrapedUrl: sourceUrl
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
          selectedArticles 
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
    setShowManualInput(false);
    setShowUploadSection(false);
    setShowCustomizeModal(false);
    setLoadingCustomContext(false);
    setLoadingStandardStory(false);
    setLoadingBaseStory(false);
    setPrFetchAttempted(false);
    setLastPrTicker('');
  };

  const handleStandardStoryGeneration = async (type: 'wiiim' | 'wgo' | 'wgoNoNews') => {
    if (!ticker.trim()) {
      setTickerError('Please enter a stock ticker');
      return;
    }

    setLoadingStandardStory(true);
    setStandardStoryError('');
    setArticle('');

    try {
      let endpoint = '';
      let requestBody: any = { ticker };

      switch (type) {
        case 'wiiim':
          endpoint = '/api/generate/wiiim';
          break;
        case 'wgo':
          endpoint = '/api/generate/wgo';
          break;
        case 'wgoNoNews':
          endpoint = '/api/generate/wgo-no-news';
          break;
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const data = await res.json();
      if (!res.ok || !data.story) throw new Error(data.error || `Failed to generate ${type} story`);

      setArticle(data.story);
    } catch (err: any) {
      setStandardStoryError(err.message || `Failed to generate ${type} story`);
    } finally {
      setLoadingStandardStory(false);
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
          onClick={() => setShowUploadSection(!showUploadSection)}
          style={{ padding: '6px 12px' }}
        >
          Analyst Note Upload
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
          />
        </div>
      )}

      {/* Standard Mode Story Display */}
      {ticker && !useModularApproach && article && (
        <div style={{ marginBottom: 20, backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '600' }}>Generated Story</h3>
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
        <AnalystNoteUpload onTextExtracted={handleAnalystNoteTextExtracted} ticker={ticker} />
      )}
      
      {/* Customize Context Modal */}
      <CustomizeContextModal
        isOpen={showCustomizeModal}
        onClose={() => setShowCustomizeModal(false)}
        ticker={ticker}
        onArticlesSelected={handleCustomContextGeneration}
        loading={loadingCustomContext}
      />
      
      {prError && <div style={{ color: 'red', marginBottom: 10 }}>{prError}</div>}
      {prs.length === 0 && !loadingPRs && lastPrTicker && prFetchAttempted && (
        <div style={{ color: '#b91c1c', marginBottom: 20 }}>
          No press releases found for the past 7 days for {lastPrTicker}.
        </div>
      )}
      {prs.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <h2>Select a Press Release</h2>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {prs.map(pr => {
              if (hideUnselectedPRs && selectedPR?.id !== pr.id) {
                return null;
              }
              return (
                <li key={pr.id} style={{ marginBottom: 10 }}>
                  <button
                    style={{
                      background: selectedPR?.id === pr.id ? '#2563eb' : '#f3f4f6',
                      color: selectedPR?.id === pr.id ? 'white' : 'black',
                      border: '1px solid #ccc',
                      borderRadius: 4,
                      padding: 8,
                      width: '100%',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                    onClick={() => handleSelectPR(pr)}
                  >
                    <strong>{pr.headline || '[No Headline]'}</strong>
                    <br />
                    <span style={{ fontSize: 12, color: '#666' }}>
                      <LocalDate dateString={pr.created} />
                    </span>
                    <br />
                    <span style={{ fontSize: 13, color: selectedPR?.id === pr.id ? 'white' : '#444' }}>
                      {pr.body && pr.body !== '[No body text]'
                        ? pr.body.substring(0, 100) + (pr.body.length > 100 ? '...' : '')
                        : '[No body text]'}
                    </span>
                    {pr.url && (
                      <>
                        <br />
                        <a href={pr.url} target="_blank" rel="noopener noreferrer" style={{ color: selectedPR?.id === pr.id ? 'white' : '#2563eb', textDecoration: 'underline', fontSize: 13 }}>
                          View Original
                        </a>
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
