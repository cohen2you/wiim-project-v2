'use client';

import { useState, useEffect } from 'react';

// Utility to strip HTML tags and decode entities
function htmlToText(html: string): string {
  if (!html) return '';
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  return tempDiv.textContent || tempDiv.innerText || '';
}

export default function PrimarySourceForm() {
  const [primaryUrl, setPrimaryUrl] = useState('');
  const [primaryText, setPrimaryText] = useState('');
  const [primaryOutput, setPrimaryOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const [scrapeLoading, setScrapeLoading] = useState(false);
  const [scrapeError, setScrapeError] = useState('');
  const [generateError, setGenerateError] = useState('');

  useEffect(() => {
    console.log('PrimarySourceForm rendered');
  }, []);

  const generatePrimary = async () => {
    if (!primaryText.trim()) {
      setGenerateError('Please provide article text before generating.');
      return;
    }

    setLoading(true);
    setGenerateError('');
    setPrimaryOutput('');

    try {
      const res = await fetch('/api/generate/primary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceUrl: primaryUrl,
          articleText: primaryText,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to generate primary content.');
      }

      const data = await res.json();
      setPrimaryOutput(data.result);
    } catch (err: any) {
      setGenerateError(err.message || 'Error generating primary content.');
    } finally {
      setLoading(false);
    }
  };

  const handleScrape = async () => {
    setScrapeLoading(true);
    setScrapeError('');
    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: primaryUrl }),
      });
      const data = await res.json();
      if (!res.ok || !data.text) throw new Error(data.error || 'Failed to scrape article.');
      setPrimaryText(data.text);
    } catch (err: any) {
      setScrapeError(err.message || 'Failed to scrape article. Please cut and paste the text manually.');
    } finally {
      setScrapeLoading(false);
    }
  };

  return (
    <div>
      <input
        placeholder="Primary URL"
        value={primaryUrl}
        onChange={(e) => setPrimaryUrl(e.target.value)}
        className="border rounded px-3 py-2 w-full mb-4"
      />
      <button
        type="button"
        onClick={handleScrape}
        disabled={!primaryUrl || scrapeLoading}
        className="bg-green-600 text-white px-4 py-1 rounded mb-2"
      >
        {scrapeLoading ? 'Scraping...' : 'Auto-Fill from URL'}
      </button>
      {scrapeError && (
        <div className="text-red-600 text-sm mb-2">{scrapeError} Please cut and paste the article text manually.</div>
      )}
      <textarea
        placeholder="Primary Article Text"
        value={primaryText}
        onChange={(e) => setPrimaryText(e.target.value)}
        rows={8}
        className="border rounded px-3 py-2 w-full mb-4"
      />
      <button
        onClick={generatePrimary}
        disabled={loading || !primaryText.trim()}
        className="bg-blue-600 text-white px-6 py-2 rounded disabled:bg-gray-400"
      >
        {loading ? 'Generating...' : 'Generate Primary Output'}
      </button>
      {generateError && (
        <div className="text-red-600 text-sm mt-2">{generateError}</div>
      )}
      {primaryOutput && (
        <div className="mt-4">
          <h3 className="font-semibold mb-2">Generated Output:</h3>
          <pre className="whitespace-pre-wrap bg-gray-50 p-4 rounded border">{primaryOutput}</pre>
        </div>
      )}
    </div>
  );
}
