'use client';

import { useState } from 'react';

interface PriceActionFormProps {
  onGenerate: (ticker: string) => Promise<void>;
}

export default function PriceActionForm({ onGenerate }: PriceActionFormProps) {
  const [ticker, setTicker] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleGenerate = async () => {
    setError('');
    if (!ticker.trim()) {
      setError('Please enter a stock ticker symbol.');
      return;
    }
    setLoading(true);
    try {
      await onGenerate(ticker.trim().toUpperCase());
    } catch (err: any) {
      setError(err.message || 'Failed to generate price action.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white shadow-lg rounded-2xl p-10 max-w-full space-y-6">
      <label htmlFor="ticker-input" className="block font-semibold text-xl text-gray-800">
        Stock Ticker
      </label>
      <input
        id="ticker-input"
        type="text"
        placeholder="Enter stock ticker (e.g. AAPL)"
        value={ticker}
        onChange={(e) => setTicker(e.target.value)}
        className="w-full rounded-lg border-2 border-gray-300 px-6 py-4 text-lg focus:outline-none focus:ring-4 focus:ring-blue-400 focus:border-blue-600"
      />
      {error && <p className="text-red-600 font-semibold">{error}</p>}
      <button
        type="button"
        onClick={handleGenerate}
        disabled={loading}
        className="w-full rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 py-4 text-white text-xl font-bold hover:from-blue-700 hover:to-indigo-700 disabled:opacity-60"
      >
        {loading ? 'Generating Price Action...' : 'Generate Price Action'}
      </button>
    </div>
  );
}
