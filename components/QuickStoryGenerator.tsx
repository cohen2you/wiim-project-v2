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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<QuickStoryResult | null>(null);
  const [storyText, setStoryText] = useState('');
  const [provider, setProvider] = useState<'openai' | 'gemini'>('openai');

  // Get backend URL from environment variable
  const NEWS_AGENT_URL = process.env.NEXT_PUBLIC_NEWS_AGENT_URL || 'http://localhost:3000';

  const handleGenerate = async () => {
    if (!ticker || !ticker.trim()) {
      setError('Please enter a ticker symbol');
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
              onChange={(e) => setTemplate(e.target.value)}
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

        {/* Custom Focus (only show for custom template) */}
        {template === 'custom' && (
          <div>
            <label htmlFor="customFocus" style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '6px' }}>
              Custom Focus
            </label>
            <textarea
              id="customFocus"
              value={customFocus}
              onChange={(e) => setCustomFocus(e.target.value)}
              placeholder="Describe what you want the story to focus on..."
              rows={3}
              style={{ 
                width: '100%', 
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
              disabled={loading}
            />
          </div>
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
                color: '#1f2937'
              }}
              dangerouslySetInnerHTML={{ __html: storyText }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
