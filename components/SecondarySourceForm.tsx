'use client';

import { useState } from 'react';

interface SecondarySourceFormProps {
  primaryOutput: string;
  onComplete: (output: string) => void;
  onBack?: () => void;
}

export default function SecondarySourceForm({ primaryOutput, onComplete, onBack }: SecondarySourceFormProps) {
  const [sourceUrl, setSourceUrl] = useState('');
  const [articleText, setArticleText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleGenerate = async () => {
    setError('');
    setLoading(true);

    console.log('Sending to /api/generate/secondary:', {
      sourceUrl,
      primaryText: primaryOutput,
      articleText,
      outletName: 'Benzinga',
    });

    if (!sourceUrl.trim() && !articleText.trim()) {
      setError('Please provide either a Secondary Article URL or the full Secondary Article Text.');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/generate/secondary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceUrl,
          primaryText: primaryOutput,
          articleText,
          outletName: 'Benzinga',
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Server error');
      }

      const data = await res.json();
      onComplete(data.result);
    } catch (err: any) {
      setError(err.message || 'Error generating secondary output.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white shadow-lg rounded-2xl p-10 max-w-full space-y-6">
      <label htmlFor="source-url" className="block font-semibold text-xl text-gray-800">
        Secondary Article URL
      </label>
      <input
        id="source-url"
        type="text"
        placeholder="Paste secondary source URL"
        value={sourceUrl}
        onChange={(e) => setSourceUrl(e.target.value)}
        className="w-full rounded-lg border-2 border-gray-300 px-6 py-4 text-lg focus:outline-none focus:ring-4 focus:ring-blue-400 focus:border-blue-600"
      />

      <label htmlFor="article-text" className="block font-semibold text-xl text-gray-800 mt-8">
        Secondary Article Text
      </label>
      <textarea
        id="article-text"
        rows={12}
        placeholder="Paste full secondary article text"
        value={articleText}
        onChange={(e) => setArticleText(e.target.value)}
        className="w-full rounded-lg border-2 border-gray-300 px-6 py-4 text-lg font-mono resize-none focus:outline-none focus:ring-4 focus:ring-blue-400 focus:border-blue-600"
      />

      {error && <p className="text-red-600 font-semibold">{error}</p>}

      <div className="flex justify-end space-x-4 mt-4">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-gray-400 px-6 py-3 font-semibold hover:bg-gray-100"
          >
            Back
          </button>
        )}
        <button
          type="button"
          onClick={handleGenerate}
          disabled={loading}
          className="rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3 text-white font-bold hover:from-blue-700 hover:to-indigo-700 disabled:opacity-60"
        >
          {loading ? 'Generating...' : 'Generate Step 2 Output'}
        </button>
      </div>
    </div>
  );
}
