'use client';

import { useState, useEffect } from 'react';

interface SecondarySourceFormProps {
  initialPrimaryText?: string;
  onComplete?: (output: string) => void;
}

export default function SecondarySourceForm({ initialPrimaryText = '', onComplete }: SecondarySourceFormProps) {
  const [secondaryUrl, setSecondaryUrl] = useState('');
  const [outletName, setOutletName] = useState('');
  const [primaryText, setPrimaryText] = useState(initialPrimaryText);
  const [secondaryText, setSecondaryText] = useState('');
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setPrimaryText(initialPrimaryText);
  }, [initialPrimaryText]);

  const handleGenerate = async () => {
    setLoading(true);
    setOutput('');

    // ADD THIS LOG
    console.log('Secondary generate clicked with data:', {
      secondaryUrl,
      outletName,
      primaryText,
      secondaryText,
    });

    if (!primaryText.trim()) {
      setOutput('Primary Output Text is empty. Please fill it in before generating.');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/generate/secondary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secondaryUrl,
          outletName,
          primaryText,
          secondaryText,
        }),
      });

      const data = await res.json();
      const generated = data.result || 'No result returned.';
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
      <h1 className="text-2xl font-bold">Generate Secondary Article Section</h1>

      <div className="space-y-2">
        <label className="block text-sm font-medium">Secondary URL</label>
        <input
          type="text"
          placeholder="Paste secondary source URL"
          value={secondaryUrl}
          onChange={(e) => setSecondaryUrl(e.target.value)}
          className="border rounded px-3 py-2 w-full"
        />
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium">Outlet Name</label>
        <input
          type="text"
          placeholder="e.g., Benzinga"
          value={outletName}
          onChange={(e) => setOutletName(e.target.value)}
          className="border rounded px-3 py-2 w-full"
        />
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium">Primary Output Text</label>
        <textarea
          placeholder="Paste output from Primary section"
          value={primaryText}
          onChange={(e) => setPrimaryText(e.target.value)}
          rows={6}
          className="border rounded px-3 py-2 w-full font-mono"
        />
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium">Secondary Article Text</label>
        <textarea
          placeholder="Paste full secondary article text"
          value={secondaryText}
          onChange={(e) => setSecondaryText(e.target.value)}
          rows={10}
          className="border rounded px-3 py-2 w-full font-mono"
        />
      </div>

      <button
        onClick={handleGenerate}
        disabled={loading}
        className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? 'Generating...' : 'Generate Step 2 Output'}
      </button>

      {output && (
        <div className="bg-gray-50 border rounded p-6 mt-6 space-y-4 whitespace-pre-wrap">
          {output}
        </div>
      )}
    </div>
  );
}
