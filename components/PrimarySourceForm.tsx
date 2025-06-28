'use client';

import { useState, useEffect } from 'react';

export default function PrimarySourceForm() {
  const [primaryUrl, setPrimaryUrl] = useState('');
  const [primaryText, setPrimaryText] = useState('');
  const [primaryOutput, setPrimaryOutput] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    console.log('PrimarySourceForm rendered');
  }, []);

  const generatePrimary = () => {
    console.log('Generate Primary Output button clicked');
    setPrimaryOutput('This is a fixed test output from the Generate Primary Output button.');
  };

  return (
    <div>
      <input
        placeholder="Primary URL"
        value={primaryUrl}
        onChange={(e) => setPrimaryUrl(e.target.value)}
        className="border rounded px-3 py-2 w-full mb-4"
      />
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
