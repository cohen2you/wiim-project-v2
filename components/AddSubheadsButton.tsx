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
    if (!articleText) {
      setError('No article text to optimize');
      return;
    }
    
    setIsLoading(true);
    setError(null);

    try {
      const apiUrl = `${backendUrl}/api/seo/generate`;
      console.log('🔵 AddSubheadsButton: Starting request');
      console.log('🔵 API URL:', apiUrl);
      console.log('🔵 Backend URL:', backendUrl);
      console.log('🔵 Article text length:', articleText.length);
      console.log('🔵 Article text preview:', articleText.substring(0, 100) + '...');
      
      // Call the News-Agent-Project API
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ articleText }),
      });

      console.log('🔵 Response received');
      console.log('🔵 Response status:', response.status);
      console.log('🔵 Response ok:', response.ok);
      console.log('🔵 Response headers:', Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        let errorText = '';
        try {
          errorText = await response.text();
          console.error('🔴 Error response body:', errorText);
        } catch (e) {
          console.error('🔴 Could not read error response body');
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}${errorText ? `. ${errorText.substring(0, 200)}` : ''}`);
      }

      let data;
      try {
        data = await response.json();
        console.log('✅ Response data received:', data);
      } catch (e) {
        console.error('🔴 Could not parse JSON response');
        const text = await response.text();
        console.error('🔴 Response text:', text);
        throw new Error('Invalid JSON response from server');
      }
      
      // Update the parent state with the new optimized text
      if (data.optimizedText) {
        console.log('✅ Updating article with optimized text, length:', data.optimizedText.length);
        onArticleUpdate(data.optimizedText);
        setError(null); // Clear any previous errors
      } else {
        console.warn('⚠️ No optimizedText in response:', data);
        throw new Error('No optimizedText in response. Response: ' + JSON.stringify(data));
      }
      
    } catch (err) {
      console.error('🔴 AddSubheadsButton error:', err);
      if (err instanceof TypeError && err.message.includes('fetch')) {
        console.error('🔴 Network error - check if the backend server is running and CORS is configured');
        setError(`Network error: ${err.message}. Check browser console (F12) for details. Is the backend running at ${backendUrl}?`);
      } else if (err instanceof Error) {
        console.error('🔴 Error message:', err.message);
        setError(`Error: ${err.message}`);
      } else {
        console.error('🔴 Unknown error:', err);
        setError('Failed to generate subheads. Check browser console (F12) for details.');
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

