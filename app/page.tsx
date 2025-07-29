'use client';

import React, { useState, useEffect, useRef } from 'react';
import LocalDate from '../components/LocalDate';
import AnalystNoteUpload from '../components/AnalystNoteUpload';
import StockChart from '../components/StockChart';

export default function PRStoryGeneratorPage() {
  const [ticker, setTicker] = useState('');
  const [prs, setPRs] = useState<any[]>([]);
  const [loadingPRs, setLoadingPRs] = useState(false);
  const [prError, setPRError] = useState('');
  const [selectedPR, setSelectedPR] = useState<any | null>(null);
  const [primaryText, setPrimaryText] = useState('');
  const [priceAction, setPriceAction] = useState<any | null>(null);
  const [loadingPrice, setLoadingPrice] = useState(false);
  const [article, setArticle] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');
  const [tenNewestArticles, setTenNewestArticles] = useState<any[]>([]);
  const [loadingTenArticles, setLoadingTenArticles] = useState(false);
  const [tenArticlesError, setTenArticlesError] = useState('');
  const [selectedArticle, setSelectedArticle] = useState<any | null>(null);
  const [analystSummary, setAnalystSummary] = useState('');
  const [priceSummary, setPriceSummary] = useState('');
  const [loadingStory, setLoadingStory] = useState(false);
  const [prFetchAttempted, setPrFetchAttempted] = useState(false);
  const [lastPrTicker, setLastPrTicker] = useState('');
  const [showUploadSection, setShowUploadSection] = useState(false);
  const [copied, setCopied] = useState(false);

  // Client-only: Convert PR or Article HTML body to plain text when selected
  useEffect(() => {
    if (selectedPR && selectedPR.body) {
      if (typeof window !== 'undefined') {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = selectedPR.body;
        setPrimaryText(tempDiv.textContent || tempDiv.innerText || '');
      }
    } else if (selectedArticle && selectedArticle.body) {
      if (typeof window !== 'undefined') {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = selectedArticle.body;
        setPrimaryText(tempDiv.textContent || tempDiv.innerText || '');
      }
    } else {
      setPrimaryText('');
    }
  }, [selectedPR, selectedArticle]);

  useEffect(() => {
    console.log('Ticker:', ticker); // Debug log for ticker state
  }, [ticker]);

  // Fetch PRs for ticker
  const fetchPRs = async () => {
    setLoadingPRs(true);
    setPRError('');
    setPRs([]);
    setSelectedPR(null);
    setArticle('');
    setTenNewestArticles([]); // Clear articles
    setSelectedArticle(null); // Clear article selection
    setPrFetchAttempted(true); // Mark that fetch has been attempted
    setLastPrTicker(ticker); // Store the last attempted ticker
    setShowUploadSection(false); // Close analyst note input
    try {
      const res = await fetch('/api/bz/prs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker }),
      });
      const data = await res.json();
      if (!res.ok || !data.prs) throw new Error(data.error || 'Failed to fetch PRs');
      setPRs(data.prs);
    } catch (err: any) {
      setPRError(err.message || 'Failed to fetch PRs');
    } finally {
      setLoadingPRs(false);
    }
  };

  // Fetch price action for ticker
  const fetchPriceAction = async () => {
    setLoadingPrice(true);
    setPriceAction(null);
    setShowUploadSection(false); // Close analyst note input
    try {
      const res = await fetch('/api/bz/priceaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker }),
      });
      const data = await res.json();
      if (!res.ok || !data.priceAction) throw new Error(data.error || 'Failed to fetch price action');
      setPriceAction(data.priceAction);
    } catch (err: any) {
      setPriceAction(null);
    } finally {
      setLoadingPrice(false);
    }
  };

  const fetchAnalystSummary = async () => {
    try {
      const res = await fetch('/api/generate/analyst-ratings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker }),
      });
      const data = await res.json();
      console.log('Analyst ratings API response:', data); // Debug log
      if (data.ratings && data.ratings.length > 0) {
        setAnalystSummary(data.ratings.join(' '));
      } else {
        setAnalystSummary('No recent analyst ratings available.');
      }
    } catch (err) {
      console.error('Error fetching analyst ratings:', err);
      setAnalystSummary('Failed to fetch analyst ratings.');
    }
  };

  const fetchPriceSummary = async () => {
    try {
      const res = await fetch('/api/bz/priceaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker }),
      });
      const data = await res.json();
      console.log('Price action API response:', data); // Debug log
      if (data.priceAction) {
        setPriceSummary(data.priceAction);
      } else {
        setPriceSummary('No recent price action available.');
      }
    } catch (err) {
      console.error('Error fetching price action:', err);
      setPriceSummary('Failed to fetch price action.');
    }
  };

  // Generate article (stub OpenAI call)
  const generateArticle = async () => {
    setGenerating(true);
    setGenError('');
    setArticle('');
    setLoadingStory(true);

    // Fetch analyst ratings and price action in parallel and use their returned values
    const [analyst, price] = await Promise.all([
      (async () => {
        try {
          const res = await fetch('/api/generate/analyst-ratings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticker }),
          });
          const data = await res.json();
          return (data.ratings && data.ratings.length > 0)
            ? data.ratings.join(' ')
            : 'No recent analyst ratings available.';
        } catch {
          return 'Failed to fetch analyst ratings.';
        }
      })(),
      (async () => {
        try {
          const res = await fetch('/api/bz/priceaction', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticker }),
          });
          const data = await res.json();
          return data.priceAction || 'No recent price action available.';
        } catch {
          return 'Failed to fetch price action.';
        }
      })()
    ]);

    setAnalystSummary(analyst);
    setPriceSummary(price);

    try {
      // Calculate storyDay and storyDate for the selected PR, article, or analyst note
      let storyDay = '';
      let storyDate = '';
      let createdDateStr = selectedPR?.created || selectedArticle?.created || null;
      let dateReference = '';
      let sourceDateFormatted = '';
      
      if (createdDateStr) {
        const createdDate = new Date(createdDateStr);
        const now = new Date();
        const daysOld = Math.floor((now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysOld < 7) {
          // Day of week (e.g., Thursday)
          const day = createdDate.toLocaleDateString('en-US', { weekday: 'long' });
          dateReference = `on ${day}`;
        } else {
          // Month Day (e.g., July 12)
          const dateStr = createdDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
          dateReference = `on ${dateStr}`;
        }
        // Format the actual date for reference in paragraphs
        sourceDateFormatted = createdDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
      } else if (primaryText && ticker && !selectedPR && !selectedArticle) {
        // For analyst notes, try to extract date from the text first
        const dateMatch = primaryText.match(/(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i);
        if (dateMatch) {
          const [_, day, month, year] = dateMatch;
          const analystDate = new Date(`${month} ${day}, ${year}`);
          const dayName = analystDate.toLocaleDateString('en-US', { weekday: 'long' });
          dateReference = `on ${dayName}`;
          sourceDateFormatted = analystDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
        } else {
          // Fallback to today's date if no date found in text
          const today = new Date();
          const day = today.toLocaleDateString('en-US', { weekday: 'long' });
          dateReference = `on ${day}`;
          sourceDateFormatted = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
        }
      }
      
      // Calculate priceActionDay for today
      const today = new Date();
      const priceActionDay = `on ${today.toLocaleDateString('en-US', { weekday: 'long' })}`;
      const res = await fetch('/api/generate/story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker,
          sourceText: primaryText,
          analystSummary: analyst,
          priceSummary: price,
          sourceDate: createdDateStr,
          storyDay,
          storyDate,
          dateReference,
          priceActionDay,
          sourceUrl: selectedPR?.url || selectedArticle?.url || '',
          sourceDateFormatted,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.story) throw new Error(data.error || 'Failed to generate story');
      setArticle(data.story);
    } catch (err: any) {
      setGenError(err.message || 'Failed to generate story');
    } finally {
      setGenerating(false);
      setLoadingStory(false);
    }
  };

  // Fetch 10 newest articles for ticker
  const fetchTenNewestArticles = async () => {
    setLoadingTenArticles(true);
    setTenArticlesError('');
    setTenNewestArticles([]);
    setSelectedArticle(null);
    setPRs([]); // Clear PRs
    setSelectedPR(null); // Clear PR selection
    setPrFetchAttempted(false); // Clear PR fetch attempt state
    setLastPrTicker(''); // Clear last PR ticker
    setShowUploadSection(false); // Close analyst note input
    try {
      const res = await fetch('/api/bz/articles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, count: 10 }),
      });
      const data = await res.json();
      if (!res.ok || !data.articles) throw new Error(data.error || 'Failed to fetch articles');
      setTenNewestArticles(data.articles);
    } catch (err: any) {
      setTenArticlesError(err.message || 'Failed to fetch articles');
    } finally {
      setLoadingTenArticles(false);
    }
  };

  // When PR is selected, fetch price action and prepare for generation
  const handleSelectPR = async (pr: any) => {
    setSelectedPR(pr);
    setArticle('');
    await fetchPriceAction();
  };

  const handleClearAll = () => {
    setTicker('');
    setPRs([]);
    setSelectedPR(null);
    setArticle('');
    setTenNewestArticles([]);
    setSelectedArticle(null);
    setAnalystSummary('');
    setPriceSummary('');
    setGenError('');
    setPrFetchAttempted(false);
    setLastPrTicker('');
    setShowUploadSection(false);
  };

  const handleAnalystNoteTextExtracted = (text: string, noteTicker: string) => {
    if (text && noteTicker) {
      setTicker(noteTicker);
      setPrimaryText(text);
      setSelectedPR(null);
      setSelectedArticle(null);
      setArticle('');
      setPRs([]);
      setTenNewestArticles([]);
      setPrFetchAttempted(false);
      setLastPrTicker('');
    } else if (!text && !noteTicker) {
      // Clear everything when manual text input is requested
      setTicker('');
      setPrimaryText('');
      setSelectedPR(null);
      setSelectedArticle(null);
      setArticle('');
      setPRs([]);
      setTenNewestArticles([]);
      setPrFetchAttempted(false);
      setLastPrTicker('');
    }
  };

  const articleRef = useRef<HTMLDivElement>(null);

  const handleCopyArticle = async () => {
    if (articleRef.current) {
      // Get the article HTML content
      let htmlContent = articleRef.current.innerHTML;
      
            // Generate a static chart image if ticker exists
      if (ticker) {
        try {
          // Use TradingView's static chart API
          const chartUrl = `https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.html?symbol=${ticker}&interval=D&symbols=${ticker}&colorTheme=light&isTransparent=false&autosize=true&largeChartUrl=https%3A%2F%2Fwww.tradingview.com%2Fsymbol%2F${ticker}%2F`;
          
          // Use a simple chart image from a reliable source
          const chartImage = `
            <div style="text-align: center; margin: 20px 0;">
              <img src="https://finviz.com/chart.ashx?t=${ticker}&ty=c&ta=1&p=d&s=l" alt="5-Day Stock Chart for ${ticker}" style="max-width: 100%; height: auto; border: 1px solid #e5e7eb; border-radius: 8px;" />
              <p style="font-size: 12px; color: #666; margin-top: 10px;">5-Day Stock Chart for ${ticker}</p>
            </div>
          `;
          
          const finalHtmlContent = htmlContent + chartImage;
          
          // Create a clipboard item with both HTML and text formats
          const clipboardItem = new ClipboardItem({
            'text/html': new Blob([finalHtmlContent], { type: 'text/html' }),
            'text/plain': new Blob([articleRef.current?.innerText || ''], { type: 'text/plain' })
          });
          
          navigator.clipboard.write([clipboardItem]);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
          return;
        } catch (error) {
          console.log('Failed to generate chart image:', error);
        }
      }
      
      // Fallback: Add chart placeholder if image capture failed
      if (ticker) {
        const chartPlaceholder = `
          <div style="text-align: center; margin: 20px 0;">
            <p style="font-size: 14px; color: #666; margin-bottom: 10px;">
              [5-Day Stock Chart for ${ticker} - Chart will be embedded when pasted into WordPress]
            </p>
          </div>
        `;
        htmlContent += chartPlaceholder;
      }
      
      // Get text content with proper line breaks
      const textContent = articleRef.current.innerText;
      
      // Create a clipboard item with both HTML and text formats
      const clipboardItem = new ClipboardItem({
        'text/html': new Blob([htmlContent], { type: 'text/html' }),
        'text/plain': new Blob([textContent], { type: 'text/plain' })
      });
      
      navigator.clipboard.write([clipboardItem]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000); // Reset after 2 seconds
    }
  };

  return (
    <div style={{ maxWidth: 700, margin: 'auto', padding: 20, fontFamily: 'Arial, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1>Benzinga PR Story Generator</h1>
        <button
          onClick={handleClearAll}
          style={{ padding: '6px 12px', background: '#b91c1c', color: 'white', border: 'none', borderRadius: 4 }}
        >
          Clear All Data
        </button>
      </div>
      <div style={{ marginBottom: 20 }}>
        <label>
          Stock Ticker:{' '}
          <input
            type="text"
            value={ticker}
            onChange={e => setTicker(e.target.value.toUpperCase())}
            placeholder="e.g. AAPL"
            style={{ fontSize: 16, padding: 6, width: 120 }}
            disabled={loadingPRs}
          />
        </label>
      </div>
      
      <div style={{ marginBottom: 20 }}>
        <button
          onClick={fetchPRs}
          /* disabled={loadingPRs || !ticker.trim()} */
          style={{ marginRight: 10, padding: '6px 12px' }}
        >
          {loadingPRs ? 'Fetching PRs...' : 'Fetch PRs'}
        </button>
        <button
          onClick={fetchTenNewestArticles}
          /* disabled={loadingTenArticles || !ticker.trim()} */
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
      </div>
      
      {showUploadSection && (
        <AnalystNoteUpload onTextExtracted={handleAnalystNoteTextExtracted} ticker={ticker} />
      )}
      
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
            {prs.map(pr => (
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
                  disabled={generating}
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
                        View Full PR
                      </a>
                    </>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {tenArticlesError && <div style={{ color: 'red', marginBottom: 10 }}>{tenArticlesError}</div>}
      {tenNewestArticles.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <h2>10 Newest Newsfeed Posts</h2>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {tenNewestArticles.map(article => (
              <li key={article.id} style={{ marginBottom: 10 }}>
                <button
                  style={{
                    background: selectedArticle?.id === article.id ? '#2563eb' : '#f3f4f6',
                    color: selectedArticle?.id === article.id ? 'white' : 'black',
                    border: '1px solid #ccc',
                    borderRadius: 4,
                    padding: 8,
                    width: '100%',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                  onClick={() => setSelectedArticle(article)}
                  disabled={generating}
                >
                  <strong>{article.headline || '[No Headline]'}</strong>
                  <br />
                  <span style={{ fontSize: 12, color: '#666' }}>
                    <LocalDate dateString={article.created} />
                  </span>
                  <br />
                  <span style={{ fontSize: 13, color: selectedArticle?.id === article.id ? 'white' : '#444' }}>
                    {article.body && article.body !== '[No body text]'
                      ? article.body.substring(0, 100) + (article.body.length > 100 ? '...' : '')
                      : '[No body text]'}
                  </span>
                  {article.url && (
                    <>
                      <br />
                      <a href={article.url} target="_blank" rel="noopener noreferrer" style={{ color: selectedArticle?.id === article.id ? 'white' : '#2563eb', textDecoration: 'underline', fontSize: 13 }}>
                        View Full Article
                      </a>
                    </>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {/* Show textarea and generate button for selected PR, article, or analyst note */}
      {(selectedPR || selectedArticle || (primaryText && ticker)) && (
        <div style={{ marginBottom: 20 }}>
          <h2>
            {selectedPR ? 'Selected PR' : 
             selectedArticle ? 'Selected Article' : 
             'Analyst Note Content'}
          </h2>
          <div style={{ background: '#f9fafb', padding: 10, borderRadius: 4, marginBottom: 10 }}>
            {selectedPR && (
              <>
                <strong>{selectedPR.headline}</strong>
                <br />
                <LocalDate dateString={selectedPR.created} />
              </>
            )}
            {selectedArticle && (
              <>
                <strong>{selectedArticle.headline}</strong>
                <br />
                <LocalDate dateString={selectedArticle.created} />
              </>
            )}
            {!selectedPR && !selectedArticle && primaryText && ticker && (
              <strong>Analyst Note for {ticker}</strong>
            )}
            <textarea
              value={primaryText}
              onChange={e => setPrimaryText(e.target.value)}
              rows={16}
              style={{ width: '100%', fontFamily: 'monospace', fontSize: 14, marginTop: 10 }}
            />
            {(selectedPR ? selectedPR.url : selectedArticle?.url) && (
              <div style={{ marginTop: 8 }}>
                <a
                  href={selectedPR ? selectedPR.url : selectedArticle.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#2563eb', textDecoration: 'underline', fontSize: 13 }}
                >
                  View Full {selectedPR ? 'PR' : 'Article'}
                </a>
              </div>
            )}
          </div>
          <button
            onClick={generateArticle}
            disabled={generating}
            style={{ padding: '8px 16px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 4 }}
          >
            {generating ? 'Generating Story...' : 'Generate Story'}
          </button>
        </div>
      )}
      {genError && <div style={{ color: 'red', marginBottom: 10 }}>{genError}</div>}
      {article && (
        <div style={{ marginBottom: 20 }}>
          <h2>Generated Article</h2>
          <div
            ref={articleRef}
            style={{
              border: '1px solid #ccc',
              borderRadius: 4,
              padding: 16,
              background: '#fff',
              fontSize: 16,
              fontFamily: 'Georgia, serif',
              marginTop: 10,
              whiteSpace: 'pre-wrap',
            }}
            dangerouslySetInnerHTML={{ 
              __html: article.replace('[STOCK_CHART_PLACEHOLDER]', 
                ticker ? `
                  <div style="text-align: center; margin: 20px 0;">
                    <p style="font-size: 14px; color: #666; margin-bottom: 10px;">
                      [5-Day Stock Chart for ${ticker} - Chart will be embedded when pasted into WordPress]
                    </p>
                  </div>
                ` : ''
              ) 
            }}
          />
          {ticker && (
            <div style={{ marginTop: 20, textAlign: 'center' }}>
              <StockChart ticker={ticker} width={600} height={400} />
            </div>
          )}
          <button
            onClick={handleCopyArticle}
            style={{ 
              marginTop: 10, 
              padding: '8px 16px', 
              background: copied ? '#059669' : '#2563eb', 
              color: 'white', 
              border: 'none', 
              borderRadius: 4 
            }}
          >
            {copied ? 'Copied!' : 'Copy Article'}
          </button>
        </div>
      )}
    </div>
  );
}
