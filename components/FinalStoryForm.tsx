'use client';

import { useState, useEffect } from 'react';

interface FinalStoryFormProps {
  primaryOutput: string;
  secondaryOutput: string;
  onComplete: (output: string) => void;
  onBack: () => void;
}

export default function FinalStoryForm({
  primaryOutput,
  secondaryOutput,
  onComplete,
  onBack,
}: FinalStoryFormProps) {
  const [lead, setLead] = useState('');
  const [whyItMatters, setWhyItMatters] = useState('');
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [leadInitialized, setLeadInitialized] = useState(false);
  const [whyInitialized, setWhyInitialized] = useState(false);

  // Initialize lead and whyItMatters text once from props
  useEffect(() => {
    if (!leadInitialized && primaryOutput?.trim()) {
      setLead(primaryOutput);
      setLeadInitialized(true);
    }
  }, [primaryOutput, leadInitialized]);

  useEffect(() => {
    if (!whyInitialized && secondaryOutput?.trim()) {
      setWhyItMatters(secondaryOutput);
      setWhyInitialized(true);
    }
  }, [secondaryOutput, whyInitialized]);

  const handleGenerate = async () => {
    setError('');
    setLoading(true);
    setOutput('');

    if (!lead.trim() || !whyItMatters.trim()) {
      setError('Lead and Why It Matters sections cannot be empty.');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/generate/final', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead,
          whatHappened: lead,
          whyItMatters,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Server error');
      }

      const data = await res.json();
      setOutput(data.result);
      onComplete(data.result);
    } catch (err: any) {
      setError(err.message || 'Error generating final story.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white shadow-lg rounded-2xl p-10 max-w-full space-y-8">
      <label className="block font-semibold text-xl text-gray-800" htmlFor="lead-text">
        Lead and What Happened
      </label>
      <textarea
        id="lead-text"
        rows={10}
        value={lead}
        onChange={(e) => setLead(e.target.value)}
        className="w-full rounded-lg border-2 border-gray-300 px-6 py-4 text-lg font-mono resize-none focus:outline-none focus:ring-4 focus:ring-blue-400 focus:border-blue-600"
      />

      <label className="block font-semibold text-xl text-gray-800" htmlFor="why-text">
        Why It Matters
      </label>
      <textarea
        id="why-text"
        rows={10}
        value={whyItMatters}
        onChange={(e) => setWhyItMatters(e.target.value)}
        className="w-full rounded-lg border-2 border-gray-300 px-6 py-4 text-lg font-mono resize-none focus:outline-none focus:ring-4 focus:ring-blue-400 focus:border-blue-600"
      />

      {error && <p className="text-red-600 font-semibold">{error}</p>}

      <div className="flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-gray-400 px-6 py-3 font-semibold hover:bg-gray-100"
        >
          Back
        </button>

        <button
          type="button"
          onClick={handleGenerate}
          disabled={loading}
          className="rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3 text-white font-bold hover:from-blue-700 hover:to-indigo-700 disabled:opacity-60"
        >
          {loading ? 'Generating...' : 'Generate Final Story'}
        </button>
      </div>

      {output && (
        <pre
          aria-live="polite"
          className="mt-6 whitespace-pre-wrap rounded-lg bg-gray-50 p-6 text-gray-900 text-lg shadow"
        >
          {output}
        </pre>
      )}
    </div>
  );
}
