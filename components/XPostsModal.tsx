'use client';

import React, { useState, useEffect } from 'react';

interface XPost {
  id: string;
  text: string;
  created_at: string;
  author: {
    username: string;
    name: string;
    verified: boolean;
  } | null;
  metrics: {
    retweet_count: number;
    like_count: number;
    reply_count: number;
  };
  url: string;
}

interface XPostsModalProps {
  isOpen: boolean;
  onClose: () => void;
  ticker: string;
  onPostsSelected: (selectedPosts: XPost[]) => void;
  loading: boolean;
}

export default function XPostsModal({
  isOpen,
  onClose,
  ticker,
  onPostsSelected,
  loading
}: XPostsModalProps) {
  const [posts, setPosts] = useState<XPost[]>([]);
  const [selectedPosts, setSelectedPosts] = useState<Set<string>>(new Set());
  const [fetchingPosts, setFetchingPosts] = useState(false);
  const [error, setError] = useState('');

  // Fetch X posts when modal opens
  useEffect(() => {
    if (isOpen && ticker) {
      fetchPosts();
    }
  }, [isOpen, ticker]);

  const fetchPosts = async () => {
    setFetchingPosts(true);
    setError('');
    
    try {
      const res = await fetch('/api/x/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          topic: ticker, 
          count: 20 
        }),
      });
      
      const data = await res.json();
      if (!res.ok || !data.posts) throw new Error(data.error || 'Failed to fetch X posts');
      
      setPosts(data.posts);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch X posts');
    } finally {
      setFetchingPosts(false);
    }
  };

  const togglePostSelection = (postId: string) => {
    const newSelected = new Set(selectedPosts);
    if (newSelected.has(postId)) {
      newSelected.delete(postId);
    } else {
      // Check if we're at the limit of 5 posts
      if (newSelected.size >= 5) {
        alert('You can only select up to 5 X posts. Please deselect one first.');
        return;
      }
      newSelected.add(postId);
    }
    setSelectedPosts(newSelected);
  };

  const handleConfirm = () => {
    const selected = posts.filter(post => selectedPosts.has(post.id));
    onPostsSelected(selected);
    onClose();
  };

  const handleSelectAll = () => {
    // Only select up to 5 posts
    const limitedPosts = posts.slice(0, 5);
    setSelectedPosts(new Set(limitedPosts.map(post => post.id)));
  };

  const handleSelectNone = () => {
    setSelectedPosts(new Set());
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (!isOpen) return null;

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
          maxWidth: '900px',
          width: '90%',
          maxHeight: '80vh',
          overflow: 'auto'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 'bold' }}>Select X Posts for {ticker}</h2>
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
              backgroundColor: '#1da1f2', 
              color: 'white', 
              border: 'none', 
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Select All (Max 5)
          </button>
          <button
            onClick={handleSelectNone}
            style={{ 
              padding: '8px 12px', 
              marginRight: '8px',
              backgroundColor: '#6b7280', 
              color: 'white', 
              border: 'none', 
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Select None
          </button>
          <button
            onClick={fetchPosts}
            disabled={fetchingPosts}
            style={{ 
              padding: '8px 12px',
              backgroundColor: fetchingPosts ? '#6b7280' : '#10b981', 
              color: 'white', 
              border: 'none', 
              borderRadius: '4px',
              cursor: fetchingPosts ? 'not-allowed' : 'pointer',
              opacity: fetchingPosts ? 0.5 : 1
            }}
          >
            {fetchingPosts ? 'Refreshing...' : 'Refresh Posts'}
          </button>
        </div>

        {error && (
          <div style={{ 
            padding: '12px', 
            backgroundColor: '#fef2f2', 
            border: '1px solid #fecaca', 
            borderRadius: '4px', 
            color: '#dc2626',
            marginBottom: '16px'
          }}>
            {error}
          </div>
        )}

        {fetchingPosts && (
          <div style={{ textAlign: 'center', padding: '20px' }}>
            <p>Fetching X posts for {ticker}...</p>
          </div>
        )}

        {!fetchingPosts && posts.length === 0 && !error && (
          <div style={{ textAlign: 'center', padding: '20px' }}>
            <p>No X posts found for {ticker}. Try refreshing or check your X API configuration.</p>
          </div>
        )}

        {!fetchingPosts && posts.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '12px' }}>
              Select up to 5 X posts to integrate into your story. Posts will be added with hyperlinks.
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {posts.map((post) => (
                <div 
                  key={post.id} 
                  style={{ 
                    border: '1px solid #e5e7eb', 
                    borderRadius: '8px', 
                    padding: '16px',
                    backgroundColor: selectedPosts.has(post.id) ? '#f0f9ff' : 'white',
                    cursor: 'pointer'
                  }}
                  onClick={() => togglePostSelection(post.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <input
                      type="checkbox"
                      checked={selectedPosts.has(post.id)}
                      onChange={() => togglePostSelection(post.id)}
                      style={{ marginTop: '2px' }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                        <span style={{ fontWeight: '600', color: '#1f2937' }}>
                          {post.author?.name || 'Unknown'}
                        </span>
                        <span style={{ color: '#6b7280' }}>
                          @{post.author?.username || 'unknown'}
                        </span>
                        {post.author?.verified && (
                          <span style={{ color: '#1da1f2', fontSize: '14px' }}>✓</span>
                        )}
                        <span style={{ color: '#9ca3af', fontSize: '12px' }}>
                          {formatDate(post.created_at)}
                        </span>
                      </div>
                      
                      <p style={{ 
                        fontSize: '14px', 
                        lineHeight: '1.5', 
                        color: '#374151',
                        marginBottom: '8px'
                      }}>
                        {post.text}
                      </p>
                      
                      <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: '#6b7280' }}>
                        <span>❤️ {post.metrics.like_count || 0}</span>
                        <span>🔄 {post.metrics.retweet_count || 0}</span>
                        <span>💬 {post.metrics.reply_count || 0}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '20px' }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 20px',
              backgroundColor: '#6b7280',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={selectedPosts.size === 0 || loading}
            style={{
              padding: '10px 20px',
              backgroundColor: selectedPosts.size === 0 || loading ? '#6b7280' : '#1da1f2',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: selectedPosts.size === 0 || loading ? 'not-allowed' : 'pointer',
              opacity: selectedPosts.size === 0 || loading ? 0.5 : 1
            }}
          >
            {loading ? 'Adding to Story...' : `Add ${selectedPosts.size} Posts to Story`}
          </button>
        </div>
      </div>
    </div>
  );
}
