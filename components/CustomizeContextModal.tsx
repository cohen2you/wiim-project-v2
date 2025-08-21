'use client';

import React, { useState, useEffect } from 'react';

interface Article {
  id: string;
  headline: string;
  created: string;
  body: string;
  url: string;
}

interface CustomizeContextModalProps {
  isOpen: boolean;
  onClose: () => void;
  ticker: string;
  onArticlesSelected: (selectedArticles: Article[]) => void;
  loading: boolean;
}

export default function CustomizeContextModal({
  isOpen,
  onClose,
  ticker,
  onArticlesSelected,
  loading
}: CustomizeContextModalProps) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [selectedArticles, setSelectedArticles] = useState<Set<string>>(new Set());
  const [fetchingArticles, setFetchingArticles] = useState(false);
  const [error, setError] = useState('');

  // Fetch articles when modal opens
  useEffect(() => {
    if (isOpen && ticker) {
      fetchArticles();
    }
  }, [isOpen, ticker]);

  const fetchArticles = async () => {
    setFetchingArticles(true);
    setError('');
    
    try {
      const res = await fetch('/api/bz/articles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, count: 20 }), // Fetch more articles for selection
      });
      
      const data = await res.json();
      if (!res.ok || !data.articles) throw new Error(data.error || 'Failed to fetch articles');
      
      setArticles(data.articles);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch articles');
    } finally {
      setFetchingArticles(false);
    }
  };

  const toggleArticleSelection = (articleId: string) => {
    const newSelected = new Set(selectedArticles);
    if (newSelected.has(articleId)) {
      newSelected.delete(articleId);
    } else {
      // Check if we're at the limit of 5 articles
      if (newSelected.size >= 5) {
        alert('You can only select up to 5 articles. Please deselect one first.');
        return;
      }
      newSelected.add(articleId);
    }
    setSelectedArticles(newSelected);
  };

  const handleConfirm = () => {
    const selected = articles.filter(article => selectedArticles.has(article.id));
    onArticlesSelected(selected);
    onClose();
  };

  const handleSelectAll = () => {
    // Only select up to 5 articles
    const limitedArticles = articles.slice(0, 5);
    setSelectedArticles(new Set(limitedArticles.map(article => article.id)));
  };

  const handleSelectNone = () => {
    setSelectedArticles(new Set());
  };

  if (!isOpen) return null;

  // Simple test modal to see if it's working
  return (
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
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 'bold' }}>Customize Context - Select Articles for {ticker}</h2>
          <button
            onClick={onClose}
            style={{ fontSize: '24px', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            ×
          </button>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <button
            onClick={handleSelectAll}
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
            onClick={handleSelectNone}
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
            {selectedArticles.size} of 5 articles selected (max 5)
          </span>
        </div>

        {error && (
          <div style={{ color: '#dc2626', backgroundColor: '#fef2f2', padding: '12px', borderRadius: '4px', marginBottom: '16px' }}>
            {error}
          </div>
        )}

        {fetchingArticles ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>
            Loading articles...
          </div>
        ) : (
          <div>
            {articles.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>
                No articles found for {ticker}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {articles.map((article) => (
                  <div
                    key={article.id}
                    style={{
                      border: selectedArticles.has(article.id) ? '2px solid #2563eb' : '1px solid #d1d5db',
                      borderRadius: '8px',
                      padding: '16px',
                      backgroundColor: selectedArticles.has(article.id) ? '#eff6ff' : 'white',
                      cursor: 'pointer'
                    }}
                    onClick={() => toggleArticleSelection(article.id)}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                      <input
                        type="checkbox"
                        checked={selectedArticles.has(article.id)}
                        onChange={() => toggleArticleSelection(article.id)}
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
                          {article.body.substring(0, 200)}...
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
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px', paddingTop: '16px', borderTop: '1px solid #d1d5db' }}>
          <button
            onClick={onClose}
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
            onClick={handleConfirm}
            disabled={selectedArticles.size === 0 || loading}
            style={{ 
              padding: '8px 16px',
              backgroundColor: selectedArticles.size === 0 || loading ? '#9ca3af' : '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: selectedArticles.size === 0 || loading ? 'not-allowed' : 'pointer'
            }}
          >
            {loading ? 'Generating Context...' : `Generate Context (${selectedArticles.size} articles)`}
          </button>
        </div>
      </div>
    </div>
    );
} 