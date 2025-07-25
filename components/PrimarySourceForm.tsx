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

  useEffect(() => {
    console.log('PrimarySourceForm rendered');
  }, []);

  const generatePrimary = () => {
    console.log('Generate Primary Output button clicked');
    setPrimaryOutput('This is a fixed test output from the Generate Primary Output button.');
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
        className="bg-blue-600 text-white px-6 py-2 rounded"
      >
        Generate Primary Output
      </button>
      {primaryOutput && (
        <pre className="mt-4 whitespace-pre-wrap">{primaryOutput}</pre>
      )}
    </div>
  );
}
