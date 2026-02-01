'use client';

import React, { useState } from 'react';
import AddSubheadsButton from './AddSubheadsButton';

interface QuickStoryResult {
  story: string;
  priceAction: string;
  articlesUsed: number;
  relatedStocksUsed: number;
  hyperlinksFound?: number;
  hyperlinksExpected?: number;
  hyperlinkWarning?: string | null;
}

const STORY_TEMPLATES = [
  { value: 'earnings-reaction', label: 'Earnings Reaction' },
  { value: 'price-movement', label: 'Price Movement' },
  { value: 'sector-context', label: 'Sector Context' },
  { value: 'custom', label: 'Custom' },
];

const WORD_COUNT_OPTIONS = [
  { value: 300, label: '300 words' },
  { value: 400, label: '400 words' },
  { value: 500, label: '500 words' },
  { value: 600, label: '600 words' },
];

export default function QuickStoryGenerator() {
  const [ticker, setTicker] = useState('');
  const [wordCount, setWordCount] = useState(400);
  const [template, setTemplate] = useState('price-movement');
  const [relatedStocks, setRelatedStocks] = useState('');
  const [customFocus, setCustomFocus] = useState('');
  const [customSourceUrls, setCustomSourceUrls] = useState('');
  const [multiFactorMode, setMultiFactorMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<QuickStoryResult | null>(null);
  const [storyText, setStoryText] = useState('');
  const [provider, setProvider] = useState<'openai' | 'gemini'>('openai');
  
  // Article search state for custom template
  const [searchingArticles, setSearchingArticles] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedArticle, setSelectedArticle] = useState<any | null>(null);
  const [searchOffset, setSearchOffset] = useState(0);
  const [hasMoreArticles, setHasMoreArticles] = useState(false);
  const [addingWgoTechnical, setAddingWgoTechnical] = useState(false);

  // Get backend URL from environment variable
  const NEWS_AGENT_URL = process.env.NEXT_PUBLIC_NEWS_AGENT_URL || 'http://localhost:3000';

  // Search articles when custom focus is entered (on Enter key or button click)
  const handleSearchArticles = async () => {
    if (!customFocus || !customFocus.trim()) {
      setError('Please enter a custom focus to search for articles');
      return;
    }

    setSearchingArticles(true);
    setError('');
    setSearchResults([]);
    setSelectedArticle(null);
    setSearchOffset(0);

    try {
      const response = await fetch('/api/generate/quick-story/search-articles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customPrompt: customFocus,
          ticker: ticker.trim() || undefined, // Pass ticker from form if available
          offset: 0,
          limit: 5,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to search articles');
      }

      const data = await response.json();
      setSearchResults(data.articles || []);
      setHasMoreArticles(data.hasMore || false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to search articles');
    } finally {
      setSearchingArticles(false);
    }
  };

  // Load more articles
  const handleLoadMoreArticles = async () => {
    if (!customFocus || !customFocus.trim()) {
      return;
    }

    setSearchingArticles(true);
    const newOffset = searchOffset + 5;

    try {
      const response = await fetch('/api/generate/quick-story/search-articles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customPrompt: customFocus,
          ticker: ticker.trim() || undefined, // Pass ticker from form if available
          offset: newOffset,
          limit: 5,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to load more articles');
      }

      const data = await response.json();
      setSearchResults(prev => [...prev, ...(data.articles || [])]);
      setHasMoreArticles(data.hasMore || false);
      setSearchOffset(newOffset);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more articles');
    } finally {
      setSearchingArticles(false);
    }
  };

  const handleGenerate = async () => {
    if (!ticker || !ticker.trim()) {
      setError('Please enter a ticker symbol');
      return;
    }

    // For custom template, require article selection OR source URLs
    if (template === 'custom' && !selectedArticle && !customSourceUrls?.trim()) {
      setError('Please search and select an article, or provide source URL(s) for verification');
      return;
    }

    setLoading(true);
    setError('');
    setResult(null);
    setStoryText('');

    try {
      // Parse related stocks (comma-separated)
      const relatedStocksArray = relatedStocks
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter((s) => s && s !== ticker.toUpperCase());

      const response = await fetch('/api/generate/quick-story', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
          body: JSON.stringify({
          ticker: ticker.trim().toUpperCase(),
          wordCount,
          template,
          relatedStocks: relatedStocksArray,
          customFocus: template === 'custom' ? customFocus : undefined,
          customSourceUrls: template === 'custom' ? customSourceUrls : undefined,
          selectedArticleUrl: template === 'custom' && selectedArticle ? selectedArticle.url : undefined,
          multiFactorMode: template === 'sector-context' ? multiFactorMode : false,
          aiProvider: provider,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data: QuickStoryResult = await response.json();
      setResult(data);
      setStoryText(data.story);
    } catch (err: any) {
      console.error('Error generating quick story:', err);
      setError(err.message || 'Failed to generate story. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (storyText) {
      navigator.clipboard.writeText(storyText);
      // You could add a toast notification here
    }
  };

  const handleAddWgoTechnical = async () => {
    if (!ticker || !ticker.trim()) {
      setError('Please enter a ticker symbol');
      return;
    }

    if (!storyText || !storyText.trim()) {
      setError('Please generate a story first');
      return;
    }

    setAddingWgoTechnical(true);
    setError('');

    try {
      const response = await fetch('/api/generate/quick-story/add-wgo-technical', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ticker: ticker.trim(),
          currentStory: storyText,
          provider: provider,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to add WGO technical analysis');
      }

      const data = await response.json();
      setStoryText(data.story);
      console.log(`[QUICK STORY] Added WGO Technical Analysis: ${data.originalLength} -> ${data.updatedLength} chars`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add WGO technical analysis');
    } finally {
      setAddingWgoTechnical(false);
    }
  };

  return (
    <div style={{ width: '100%' }}>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Ticker Input */}
        <div>
          <label htmlFor="ticker" style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '6px' }}>
            Ticker Symbol *
          </label>
          <input
            id="ticker"
            type="text"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            placeholder="e.g., META"
            style={{ 
              width: '100%', 
              padding: '10px 12px', 
              border: '1px solid #d1d5db', 
              borderRadius: '6px', 
              fontSize: '14px',
              outline: 'none',
              transition: 'all 0.2s'
            }}
            onFocus={(e) => e.target.style.borderColor = '#7c3aed'}
            onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
            disabled={loading}
          />
        </div>

        {/* Word Count and Template in a row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div>
            <label htmlFor="wordCount" style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '6px' }}>
              Word Count
            </label>
            <select
              id="wordCount"
              value={wordCount}
              onChange={(e) => setWordCount(Number(e.target.value))}
              style={{ 
                width: '100%', 
                padding: '10px 12px', 
                border: '1px solid #d1d5db', 
                borderRadius: '6px', 
                fontSize: '14px',
                outline: 'none',
                backgroundColor: 'white',
                cursor: 'pointer'
              }}
              disabled={loading}
            >
              {WORD_COUNT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="template" style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '6px' }}>
              Story Template
            </label>
            <select
              id="template"
              value={template}
              onChange={(e) => {
                setTemplate(e.target.value);
                // Reset multi-factor mode when changing templates
                if (e.target.value !== 'sector-context') {
                  setMultiFactorMode(false);
                }
              }}
              style={{ 
                width: '100%', 
                padding: '10px 12px', 
                border: '1px solid #d1d5db', 
                borderRadius: '6px', 
                fontSize: '14px',
                outline: 'none',
                backgroundColor: 'white',
                cursor: 'pointer'
              }}
              disabled={loading}
            >
              {STORY_TEMPLATES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Multi-Factor Analysis Toggle (only show for sector-context template) */}
        {template === 'sector-context' && (
          <div style={{ 
            marginBottom: '16px', 
            padding: '12px', 
            backgroundColor: '#f9fafb', 
            border: '1px solid #e5e7eb', 
            borderRadius: '6px' 
          }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={multiFactorMode}
                onChange={(e) => setMultiFactorMode(e.target.checked)}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                disabled={loading}
              />
              <span style={{ fontSize: '14px', fontWeight: '600', color: '#374151' }}>
                Multi-Factor Analysis Mode
              </span>
            </label>
            <p style={{ fontSize: '12px', color: '#6B7280', marginTop: '6px', marginLeft: '26px' }}>
              Uses iterative generation to deeply analyze how multiple related companies' results affect the primary stock. Recommended when 3+ related stocks are provided.
            </p>
          </div>
        )}

        {/* Custom Focus (only show for custom template) */}
        {template === 'custom' && (
          <>
            <div style={{ marginBottom: '16px' }}>
              <label htmlFor="customFocus" style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '6px' }}>
                Custom Focus
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <textarea
                  id="customFocus"
                  value={customFocus}
                  onChange={(e) => {
                    setCustomFocus(e.target.value);
                    // Reset search when focus changes
                    if (selectedArticle) {
                      setSelectedArticle(null);
                      setSearchResults([]);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      handleSearchArticles();
                    }
                  }}
                  placeholder="Describe what you want the story to focus on... (Press Ctrl+Enter to search)"
                  rows={3}
                  style={{ 
                    flex: 1,
                    padding: '10px 12px', 
                    border: '1px solid #d1d5db', 
                    borderRadius: '6px', 
                    fontSize: '14px',
                    outline: 'none',
                    fontFamily: 'inherit',
                    resize: 'vertical'
                  }}
                  onFocus={(e) => e.target.style.borderColor = '#7c3aed'}
                  onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
                  disabled={loading || searchingArticles}
                />
                <button
                  type="button"
                  onClick={handleSearchArticles}
                  disabled={loading || searchingArticles || !customFocus.trim()}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: searchingArticles ? '#9ca3af' : '#7c3aed',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '14px',
                    fontWeight: '600',
                    cursor: searchingArticles || !customFocus.trim() ? 'not-allowed' : 'pointer',
                    whiteSpace: 'nowrap',
                    height: 'fit-content',
                    alignSelf: 'flex-start'
                  }}
                >
                  {searchingArticles ? 'Searching...' : 'Search Articles'}
                </button>
              </div>
              <p style={{ fontSize: '12px', color: '#6B7280', marginTop: '4px' }}>
                {customSourceUrls?.trim() 
                  ? 'Optional: Search for articles, or use the source URLs below for verification.'
                  : 'Enter your story idea and click "Search Articles" to find related Benzinga articles. Select one to generate your story.'}
              </p>
            </div>
            
            {/* Article Search Results */}
            {searchResults.length > 0 && (
              <div style={{ marginBottom: '16px', padding: '16px', backgroundColor: '#f9fafb', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#374151', marginBottom: '12px' }}>
                  Select an Article ({searchResults.length} found)
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {searchResults.map((article, index) => (
                    <div
                      key={index}
                      onClick={() => setSelectedArticle(article)}
                      style={{
                        padding: '12px',
                        border: selectedArticle?.url === article.url ? '2px solid #7c3aed' : '1px solid #d1d5db',
                        borderRadius: '6px',
                        backgroundColor: selectedArticle?.url === article.url ? '#f3f4f6' : 'white',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => {
                        if (selectedArticle?.url !== article.url) {
                          e.currentTarget.style.borderColor = '#7c3aed';
                          e.currentTarget.style.backgroundColor = '#f9fafb';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (selectedArticle?.url !== article.url) {
                          e.currentTarget.style.borderColor = '#d1d5db';
                          e.currentTarget.style.backgroundColor = 'white';
                        }
                      }}
                    >
                      <div style={{ fontSize: '14px', fontWeight: '600', color: '#111827', marginBottom: '4px' }}>
                        {article.headline}
                      </div>
                      {article.teaser && (
                        <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '4px' }}>
                          {article.teaser.substring(0, 150)}...
                        </div>
                      )}
                      <div style={{ fontSize: '11px', color: '#9ca3af' }}>
                        {article.created ? new Date(article.created).toLocaleDateString() : 'Date unknown'}
                      </div>
                    </div>
                  ))}
                </div>
                {hasMoreArticles && (
                  <button
                    type="button"
                    onClick={handleLoadMoreArticles}
                    disabled={searchingArticles}
                    style={{
                      marginTop: '12px',
                      padding: '8px 16px',
                      backgroundColor: searchingArticles ? '#9ca3af' : '#6b7280',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '13px',
                      fontWeight: '500',
                      cursor: searchingArticles ? 'not-allowed' : 'pointer',
                      width: '100%'
                    }}
                  >
                    {searchingArticles ? 'Loading...' : 'Show 5 More'}
                  </button>
                )}
                {selectedArticle && (
                  <div style={{ marginTop: '12px', padding: '8px', backgroundColor: '#dbeafe', borderRadius: '6px', fontSize: '13px', color: '#1e40af' }}>
                    ✓ Selected: {selectedArticle.headline}
                  </div>
                )}
              </div>
            )}
            <div style={{ marginBottom: '16px' }}>
              <label htmlFor="customSourceUrls" style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '6px' }}>
                Source URL(s) for Verification <span style={{ fontSize: '12px', fontWeight: '400', color: '#6B7280' }}>({selectedArticle ? 'Optional' : 'Required if no article selected'})</span>
              </label>
              <input
                id="customSourceUrls"
                type="text"
                value={customSourceUrls}
                onChange={(e) => {
                  setCustomSourceUrls(e.target.value);
                  // Clear selected article if URLs are provided (user is using URLs instead)
                  if (e.target.value.trim() && selectedArticle) {
                    setSelectedArticle(null);
                    setSearchResults([]);
                  }
                }}
                placeholder="https://example.com/article1, https://example.com/article2"
                style={{ 
                  width: '100%', 
                  padding: '10px 12px', 
                  border: '1px solid #d1d5db', 
                  borderRadius: '6px', 
                  fontSize: '14px',
                  outline: 'none',
                  fontFamily: 'inherit'
                }}
                onFocus={(e) => e.target.style.borderColor = '#7c3aed'}
                onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
                disabled={loading}
              />
              <p style={{ fontSize: '12px', color: '#6B7280', marginTop: '4px' }}>
                {selectedArticle 
                  ? 'Optional: Provide source URLs to verify information. If provided, the AI will cross-reference your custom focus with these sources.'
                  : 'Provide source URLs (comma-separated) to verify information in custom focus. The AI will cross-reference your custom focus with these sources and prioritize verified information. You can use this instead of searching for articles.'}
              </p>
            </div>
          </>
        )}

        {/* Related Stocks and AI Provider in a row */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
          <div>
            <label htmlFor="relatedStocks" style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '6px' }}>
              Related Stocks (comma-separated, optional)
            </label>
            <input
              id="relatedStocks"
              type="text"
              value={relatedStocks}
              onChange={(e) => setRelatedStocks(e.target.value.toUpperCase())}
              placeholder="e.g., AAPL, MSFT, NVDA"
              style={{ 
                width: '100%', 
                padding: '10px 12px', 
                border: '1px solid #d1d5db', 
                borderRadius: '6px', 
                fontSize: '14px',
                outline: 'none'
              }}
              onFocus={(e) => e.target.style.borderColor = '#7c3aed'}
              onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
              disabled={loading}
            />
            <p style={{ marginTop: '6px', fontSize: '12px', color: '#6b7280' }}>
              Include related stocks to provide market context (e.g., Magnificent Seven stocks)
            </p>
          </div>

          <div>
            <label htmlFor="provider" style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '6px' }}>
              AI Provider
            </label>
            <select
              id="provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value as 'openai' | 'gemini')}
              style={{ 
                width: '100%', 
                padding: '10px 12px', 
                border: '1px solid #d1d5db', 
                borderRadius: '6px', 
                fontSize: '14px',
                outline: 'none',
                backgroundColor: 'white',
                cursor: 'pointer'
              }}
              disabled={loading}
            >
              <option value="openai">OpenAI (GPT-4o)</option>
              <option value="gemini">Google (Gemini 3 Pro)</option>
            </select>
          </div>
        </div>

        {/* Generate Button */}
        <button
          onClick={handleGenerate}
          disabled={loading || !ticker.trim()}
          style={{
            width: '100%',
            padding: '12px 24px',
            backgroundColor: loading || !ticker.trim() ? '#9ca3af' : '#7c3aed',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontSize: '16px',
            fontWeight: '600',
            cursor: loading || !ticker.trim() ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s',
            boxShadow: loading || !ticker.trim() ? 'none' : '0 2px 4px rgba(124, 58, 237, 0.2)'
          }}
          onMouseEnter={(e) => {
            if (!loading && ticker.trim()) {
              e.currentTarget.style.backgroundColor = '#6d28d9';
              e.currentTarget.style.boxShadow = '0 4px 6px rgba(124, 58, 237, 0.3)';
            }
          }}
          onMouseLeave={(e) => {
            if (!loading && ticker.trim()) {
              e.currentTarget.style.backgroundColor = '#7c3aed';
              e.currentTarget.style.boxShadow = '0 2px 4px rgba(124, 58, 237, 0.2)';
            }
          }}
        >
          {loading ? 'Generating Story...' : 'Generate Quick Story'}
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div style={{ 
          marginTop: '20px', 
          padding: '12px 16px', 
          backgroundColor: '#fef2f2', 
          border: '1px solid #fecaca', 
          borderRadius: '8px' 
        }}>
          <p style={{ color: '#dc2626', fontSize: '14px', margin: 0 }}>{error}</p>
        </div>
      )}

      {/* Hyperlink Warning */}
      {result && result.hyperlinkWarning && (
        <div style={{ 
          marginTop: '20px', 
          padding: '12px 16px', 
          backgroundColor: '#fef3c7', 
          border: '1px solid #fbbf24', 
          borderRadius: '8px' 
        }}>
          <p style={{ color: '#92400e', fontSize: '14px', margin: 0, fontWeight: '500' }}>
            ⚠️ {result.hyperlinkWarning} The system attempted to add missing hyperlinks but some may still be missing. Please review the article.
          </p>
        </div>
      )}

      {/* Results */}
      {result && storyText && (
        <div style={{ marginTop: '30px', paddingTop: '24px', borderTop: '2px solid #e5e7eb' }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            marginBottom: '16px',
            flexWrap: 'wrap',
            gap: '12px'
          }}>
            <div style={{ fontSize: '13px', color: '#6b7280' }}>
              <span style={{ fontWeight: '600' }}>Articles used:</span> {result.articlesUsed} |{' '}
              <span style={{ fontWeight: '600' }}>Related stocks:</span> {result.relatedStocksUsed}
              {result.hyperlinksFound !== undefined && result.hyperlinksExpected !== undefined && (
                <>
                  {' | '}
                  <span style={{ fontWeight: '600' }}>Hyperlinks:</span>{' '}
                  <span style={{ 
                    color: result.hyperlinksFound >= result.hyperlinksExpected ? '#10b981' : '#ef4444',
                    fontWeight: '600'
                  }}>
                    {result.hyperlinksFound}/{result.hyperlinksExpected}
                  </span>
                </>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                onClick={handleCopy}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#e5e7eb',
                  color: '#374151',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#d1d5db'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#e5e7eb'}
              >
                Copy Story
              </button>
              <button
                onClick={handleAddWgoTechnical}
                disabled={addingWgoTechnical || !storyText}
                style={{
                  padding: '8px 16px',
                  backgroundColor: addingWgoTechnical ? '#9ca3af' : '#7c3aed',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: addingWgoTechnical || !storyText ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s',
                  opacity: addingWgoTechnical || !storyText ? 0.6 : 1
                }}
                onMouseEnter={(e) => {
                  if (!addingWgoTechnical && storyText) {
                    e.currentTarget.style.backgroundColor = '#6d28d9';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!addingWgoTechnical) {
                    e.currentTarget.style.backgroundColor = '#7c3aed';
                  }
                }}
              >
                {addingWgoTechnical ? 'Adding Technical Analysis...' : 'Add WGO Data'}
              </button>
              <AddSubheadsButton
                articleText={storyText}
                onArticleUpdate={setStoryText}
                backendUrl={NEWS_AGENT_URL}
              />
            </div>
          </div>

          <div style={{ 
            border: '1px solid #e5e7eb', 
            borderRadius: '8px', 
            padding: '20px', 
            backgroundColor: '#ffffff',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)'
          }}>
            <div
              style={{ 
                fontSize: '15px', 
                lineHeight: '1.7', 
                color: '#1f2937',
                fontFamily: 'inherit'
              }}
              dangerouslySetInnerHTML={{ __html: storyText }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
