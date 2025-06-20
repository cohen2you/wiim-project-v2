// components/PrimarySourceForm.tsx
'use client';

import { useState } from 'react';

interface PrimarySourceFormProps {
  onComplete: (output: string) => void;
}

export default function PrimarySourceForm({ onComplete }: PrimarySourceFormProps) {
  const [inputUrl, setInputUrl] = useState('');
  const [inputText, setInputText] = useState('');
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGenerate = async () => {
    setLoading(true);
    setOutput('');

    console.log({ sourceUrl: inputUrl, articleText: inputText });

    if (!inputUrl.trim() && !inputText.trim()) {
      setOutput('Please provide either a Primary Article URL or the full Primary Article Text before generating.');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/generate/primary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceUrl: inputUrl, articleText: inputText }),
      });

      const data = await res.json();
      const generated = data.result || '';
      setOutput(generated);

      if (onComplete) {
        onComplete(generated);
      }
    } catch (err) {
      console.error(err);
      setOutput('An error occurred.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto py-12 px-6 space-y-6">
      <div className="space-y-2">
        <label className="block text-sm font-medium">Primary Article URL</label>
        <input
          type="text"
          placeholder="Paste primary source URL"
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
          className="border rounded px-3 py-2 w-full"
        />
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium">Primary Article Text</label>
        <textarea
          placeholder="Paste full primary article text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          rows={10}
          className="border rounded px-3 py-2 w-full font-mono"
        />
      </div>

      <button
        onClick={handleGenerate}
        disabled={loading}
        className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? 'Generating...' : 'Generate Step 1 Output'}
      </button>

      {output && (
        <div className="bg-gray-50 border rounded p-6 mt-6 space-y-4 whitespace-pre-wrap">
          {output}
        </div>
      )}
    </div>
  );
}
