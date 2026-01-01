'use client';

import { useState, useRef, useEffect } from 'react';
import AddSubheadsButton from './AddSubheadsButton';

interface EarningsPreviewResult {
  ticker: string;
  preview?: string;
  earningsDate?: string | null;
  error?: string;
}

export default function EarningsPreviewGenerator() {
  const [tickers, setTickers] = useState('');
  const [previews, setPreviews] = useState<EarningsPreviewResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [provider, setProvider] = useState<'openai' | 'gemini'>('openai');

  const previewRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [addingNewsIndex, setAddingNewsIndex] = useState<number | null>(null);
  const [newsErrors, setNewsErrors] = useState<{ [key: number]: string | null }>({});

  // Get backend URL from environment variable
  const NEWS_AGENT_URL = process.env.NEXT_PUBLIC_NEWS_AGENT_URL || 'http://localhost:3000';
  
  // Debug log to verify URL is set correctly
  useEffect(() => {
    console.log('🔵 EarningsPreviewGenerator: NEWS_AGENT_URL =', NEWS_AGENT_URL);
  }, []);

  // Function to update a specific preview text
  const updatePreviewText = (index: number, newText: string) => {
    setPreviews(prev => prev.map((preview, i) =>
      i === index ? { ...preview, preview: newText } : preview
    ));
  };

  // Function to add Benzinga news to an article
  const handleAddBenzingaNews = async (index: number) => {
    const preview = previews[index];
    if (!preview || !preview.preview || preview.error) {
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
          ticker: preview.ticker.toUpperCase(),
          articleText: preview.preview,
          storyType: 'earnings-preview'
        })
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${response.statusText}${errorText ? `. ${errorText.substring(0, 200)}` : ''}`);
      }

      const data = await response.json();

      if (data.success && data.newsSection) {
        // Append the news section to the article
        const updatedArticle = preview.preview + '\n\n' + data.newsSection;
        updatePreviewText(index, updatedArticle);
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

  const copyPreviewHTML = async (index: number) => {
    const targetDiv = previewRefs.current[index];
    if (!targetDiv) return;

    try {
      const clone = targetDiv.cloneNode(true) as HTMLElement;
      const copyButton = clone.querySelector('button');
      if (copyButton) {
        copyButton.remove();
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
        const cloneForText = targetDiv.cloneNode(true) as HTMLElement;
        const copyButtonInClone = cloneForText.querySelector('button');
        if (copyButtonInClone) {
          copyButtonInClone.remove();
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

  const generateEarningsPreview = async () => {
    if (!tickers.trim()) {
      setError('Please enter ticker(s) first.');
      return;
    }

    setPreviews([]);
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/generate/earnings-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          tickers, 
          provider
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to generate earnings preview');
      }

      const data = await res.json();
      setPreviews(data.previews || []);
    } catch (error: unknown) {
      console.error('Error generating earnings preview:', error);
      if (error instanceof Error) setError(error.message);
      else setError(String(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section style={{ 
      padding: '32px', 
      backgroundColor: 'white', 
      borderRadius: '12px', 
      boxShadow: '0 4px 16px rgba(139, 92, 246, 0.25)',
      border: '4px solid #8b5cf6',
      marginTop: '40px'
    }}>
      <h2 style={{ 
        fontSize: '28px', 
        fontWeight: '700', 
        marginBottom: '24px', 
        color: '#1e293b',
        borderBottom: '2px solid #e5e7eb',
        paddingBottom: '16px'
      }}>
        Earnings Preview Generator
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
        onFocus={(e) => e.target.style.borderColor = '#8b5cf6'}
        onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
        onKeyPress={(e) => {
          if (e.key === 'Enter' && !loading && tickers.trim()) {
            generateEarningsPreview();
          }
        }}
      />

      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
        <button
          onClick={generateEarningsPreview}
          disabled={loading || !tickers.trim()}
          style={{
            padding: '12px 24px',
            backgroundColor: loading || !tickers.trim() ? '#9ca3af' : '#8b5cf6',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontSize: '15px',
            fontWeight: '600',
            cursor: loading || !tickers.trim() ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s',
            boxShadow: loading || !tickers.trim() ? 'none' : '0 2px 4px rgba(139, 92, 246, 0.3)',
            flex: 1
          }}
          onMouseEnter={(e) => {
            if (!loading && tickers.trim()) {
              e.currentTarget.style.backgroundColor = '#7c3aed';
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 4px 8px rgba(139, 92, 246, 0.4)';
            }
          }}
          onMouseLeave={(e) => {
            if (!loading && tickers.trim()) {
              e.currentTarget.style.backgroundColor = '#8b5cf6';
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 2px 4px rgba(139, 92, 246, 0.3)';
            }
          }}
        >
          {loading ? 'Generating Preview...' : 'Generate Earnings Preview'}
        </button>
      </div>

      {error && (
        <div style={{
          padding: '12px 16px',
          backgroundColor: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: '8px',
          marginTop: '20px'
        }}>
          <p style={{ color: '#dc2626', fontSize: '14px', margin: 0 }}>{error}</p>
        </div>
      )}

      {previews.length > 0 && (
        <div style={{ marginTop: '24px' }}>
          {previews.map((preview, i) => {
            if (preview.error) {
              return (
                <div key={i} style={{
                  padding: '16px',
                  border: '1px solid #fecaca',
                  borderRadius: '8px',
                  backgroundColor: '#fef2f2',
                  marginBottom: '24px'
                }}>
                  <p style={{ fontWeight: '600', color: '#991b1b', marginBottom: '8px', fontSize: '16px' }}>{preview.ticker}</p>
                  <p style={{ color: '#dc2626', fontSize: '14px', margin: 0 }}>{preview.error}</p>
                </div>
              );
            }

            return (
              <div
                key={i}
                ref={el => { previewRefs.current[i] = el; }}
                style={{
                  padding: '24px',
                  border: '1px solid #e9d5ff',
                  borderRadius: '12px',
                  backgroundColor: '#faf5ff',
                  marginBottom: '24px'
                }}
              >
                {preview.earningsDate && (
                  <p style={{
                    fontSize: '12px',
                    color: '#6b7280',
                    marginBottom: '16px',
                    fontStyle: 'italic',
                    margin: '0 0 16px 0'
                  }}>
                    Earnings Date: {new Date(preview.earningsDate).toLocaleDateString('en-US', { 
                      month: 'long', 
                      day: 'numeric', 
                      year: 'numeric' 
                    })}
                  </p>
                )}

                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'flex-end', 
                  alignItems: 'flex-start', 
                  gap: '8px', 
                  marginBottom: '16px',
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                  MozUserSelect: 'none',
                  msUserSelect: 'none'
                }}>
                  <button
                    onClick={() => handleAddBenzingaNews(i)}
                    disabled={addingNewsIndex === i || !preview.preview || !!preview.error}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: addingNewsIndex === i || !preview.preview || !!preview.error ? '#9ca3af' : '#6366f1',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '13px',
                      fontWeight: '500',
                      cursor: addingNewsIndex === i || !preview.preview || !!preview.error ? 'not-allowed' : 'pointer',
                      transition: 'all 0.2s',
                      userSelect: 'none',
                      WebkitUserSelect: 'none',
                      MozUserSelect: 'none',
                      msUserSelect: 'none'
                    }}
                    onMouseEnter={(e) => {
                      if (addingNewsIndex !== i && preview.preview && !preview.error) {
                        e.currentTarget.style.backgroundColor = '#4f46e5';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (addingNewsIndex !== i && preview.preview && !preview.error) {
                        e.currentTarget.style.backgroundColor = '#6366f1';
                      }
                    }}
                  >
                    {addingNewsIndex === i ? 'Adding News...' : 'Add Benzinga News'}
                  </button>
                  <AddSubheadsButton
                    articleText={preview.preview || ''}
                    onArticleUpdate={(newText) => updatePreviewText(i, newText)}
                    backendUrl={NEWS_AGENT_URL}
                  />
                  <button
                    onClick={() => copyPreviewHTML(i)}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: copiedIndex === i ? '#10b981' : '#e9d5ff',
                      color: copiedIndex === i ? 'white' : '#6b21a8',
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
                        e.currentTarget.style.backgroundColor = '#ddd6fe';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (copiedIndex !== i) {
                        e.currentTarget.style.backgroundColor = '#e9d5ff';
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
                  {preview.preview?.split('\n\n').filter((p: string) => p.trim()).map((paragraph: string, pIndex: number) => {
                    let processedParagraph = paragraph.trim();
                    
                    // Convert markdown bold to HTML bold
                    processedParagraph = processedParagraph.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

                    return (
                      <p 
                        key={pIndex} 
                        style={{
                          marginBottom: '16px',
                          marginTop: 0
                        }}
                        dangerouslySetInnerHTML={(processedParagraph.includes('<strong>') || processedParagraph.includes('<a ') || processedParagraph.includes('<ul>') || processedParagraph.includes('<h2>') || processedParagraph.includes('<h3>')) ? { __html: processedParagraph } : undefined}
                      >
                        {!(processedParagraph.includes('<strong>') || processedParagraph.includes('<a ') || processedParagraph.includes('<ul>') || processedParagraph.includes('<h2>') || processedParagraph.includes('<h3>')) ? processedParagraph : null}
                      </p>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

