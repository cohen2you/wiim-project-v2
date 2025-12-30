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
    if (!articleText) return;
    
    setIsLoading(true);
    setError(null);

    try {
      console.log('AddSubheadsButton: Calling API at', `${backendUrl}/api/seo/generate`);
      console.log('AddSubheadsButton: Article text length:', articleText.length);
      
      // Call the News-Agent-Project API
      const response = await fetch(`${backendUrl}/api/seo/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ articleText }),
      });

      console.log('AddSubheadsButton: Response status:', response.status);
      console.log('AddSubheadsButton: Response ok:', response.ok);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('AddSubheadsButton: Error response:', errorText);
        throw new Error(`HTTP ${response.status}: ${response.statusText}. ${errorText.substring(0, 100)}`);
      }

      const data = await response.json();
      console.log('AddSubheadsButton: Response data received:', data);
      
      // Update the parent state with the new optimized text
      if (data.optimizedText) {
        console.log('AddSubheadsButton: Updating article with optimized text, length:', data.optimizedText.length);
        onArticleUpdate(data.optimizedText);
      } else {
        console.warn('AddSubheadsButton: No optimizedText in response:', data);
        throw new Error('No optimizedText in response');
      }
      
    } catch (err) {
      console.error('AddSubheadsButton error:', err);
      if (err instanceof Error) {
        console.error('Error message:', err.message);
        setError(`Failed to generate subheads: ${err.message}`);
      } else {
        setError('Failed to generate subheads. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-2">
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
          gap: '8px'
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

