'use client';

import React, { useState } from 'react';

export default function MarketStoryPage() {
  const [ticker, setTicker] = useState('');
  const [primaryUrl, setPrimaryUrl] = useState('');
  const [primaryText, setPrimaryText] = useState('');
  const [primaryOutput, setPrimaryOutput] = useState('');
  const [secondaryUrl, setSecondaryUrl] = useState('');
  const [secondaryText, setSecondaryText] = useState('');
  const [secondaryOutput, setSecondaryOutput] = useState('');
  const [priceAction, setPriceAction] = useState('');
  const [loadingPriceAction, setLoadingPriceAction] = useState(false);
  const [loadingPrimary, setLoadingPrimary] = useState(false);
  const [loadingSecondary, setLoadingSecondary] = useState(false);
  const [loadingFinal, setLoadingFinal] = useState(false);
  const [error, setError] = useState('');
  const [finalOutput, setFinalOutput] = useState('');

  async function fetchPriceAction(tickerSymbol: string) {
    setLoadingPriceAction(true);
    try {
      const res = await fetch('/api/generate/priceaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: tickerSymbol }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch price action');
      setPriceAction(data.priceAction);
    } catch (e: any) {
      setError(e.message || 'Error fetching price action');
    } finally {
      setLoadingPriceAction(false);
    }
  }

  async function generatePrimary() {
    if (!primaryText.trim()) {
      setError('Please enter primary article text');
      return;
    }
    setLoadingPrimary(true);
    setError('');
    try {
      const res = await fetch('/api/generate/primary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceUrl: primaryUrl, articleText: primaryText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Primary generation failed');
      setPrimaryOutput(data.result || '');
    } catch (e: any) {
      setError(e.message || 'Primary generation failed');
    } finally {
      setLoadingPrimary(false);
    }
  }

  async function generateSecondary() {
    if (!secondaryText.trim() && !secondaryUrl.trim()) {
      setError('Please enter secondary article text or URL');
      return;
    }
    setLoadingSecondary(true);
    setError('');
    try {
      const res = await fetch('/api/generate/secondary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceUrl: secondaryUrl.trim() || undefined,
          articleText: secondaryText.trim() || undefined,
          primaryText: primaryOutput,
          outletName: 'Benzinga',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Secondary generation failed');
      setSecondaryOutput(data.result || '');
    } catch (e: any) {
      setError(e.message || 'Secondary generation failed');
    } finally {
      setLoadingSecondary(false);
    }
  }

  async function generateFinalStory() {
    setError('');
    setFinalOutput('');
    if (!ticker.trim()) {
      setError('Please enter ticker symbol');
      return;
    }
    if (!primaryOutput.trim()) {
      setError('Please generate primary output first');
      return;
    }
    if (!secondaryOutput.trim()) {
      setError('Please generate secondary output first');
      return;
    }
    setLoadingFinal(true);

    try {
      const res = await fetch('/api/generate/final', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead: primaryOutput,
          whatHappened: primaryOutput,
          whyItMatters: secondaryOutput,
          priceAction,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Final generation failed');
      setFinalOutput(data.result || '');
    } catch (e: any) {
      setError(e.message || 'Error generating final story');
    } finally {
      setLoadingFinal(false);
    }
  }

  // Copy final output text to clipboard
  const copyFinalOutput = () => {
    if (!finalOutput) return;
    navigator.clipboard.writeText(finalOutput);
    alert('Final output copied to clipboard!');
  };

  return (
    <div style={{ maxWidth: 700, margin: 'auto', padding: 20, fontFamily: 'Arial, sans-serif' }}>
      <h1>Market Story Generator</h1>

      {/* Ticker Input + Fetch Price Action Button */}
      <div style={{ marginBottom: 20 }}>
        <label>
          Stock Ticker:{' '}
          <input
            type="text"
            value={ticker}
            onChange={e => setTicker(e.target.value.toUpperCase())}
            placeholder="e.g. AAPL"
            style={{ fontSize: 16, padding: 6, width: 120 }}
            disabled={loadingFinal || loadingPriceAction}
          />
        </label>
        <button
          onClick={() => fetchPriceAction(ticker.trim().toUpperCase())}
          disabled={loadingPriceAction || !ticker.trim()}
          style={{ marginLeft: 10, padding: '6px 12px' }}
        >
          {loadingPriceAction ? 'Fetching Price Action...' : 'Fetch Price Action'}
        </button>
      </div>

      {/* Primary Article URL + Text + Generate Primary Button */}
      <div style={{ marginBottom: 20 }}>
        <label>
          Primary Article URL:
          <input
            type="url"
            value={primaryUrl}
            onChange={e => setPrimaryUrl(e.target.value)}
            placeholder="https://example.com/article1"
            style={{ width: '100%', fontSize: 14, padding: 6, marginTop: 4 }}
            disabled={loadingFinal || loadingPrimary}
          />
        </label>
        <label style={{ display: 'block', marginTop: 10 }}>
          Primary Article Text:
          <textarea
            rows={6}
            value={primaryText}
            onChange={e => setPrimaryText(e.target.value)}
            placeholder="Paste primary article text here"
            style={{ width: '100%', fontSize: 14, padding: 6, marginTop: 4 }}
            disabled={loadingFinal || loadingPrimary}
          />
        </label>
        <button
          onClick={generatePrimary}
          disabled={loadingPrimary || loadingFinal || !primaryText.trim()}
          style={{ marginTop: 6, padding: '6px 12px' }}
        >
          {loadingPrimary ? 'Generating Primary...' : 'Generate Primary Output'}
        </button>
      </div>

      {/* Secondary Article URL + Text + Generate Secondary Button */}
      <div style={{ marginBottom: 20 }}>
        <label>
          Secondary Article URL:
          <input
            type="url"
            value={secondaryUrl}
            onChange={e => setSecondaryUrl(e.target.value)}
            placeholder="https://example.com/article2"
            style={{ width: '100%', fontSize: 14, padding: 6, marginTop: 4 }}
            disabled={loadingFinal || loadingSecondary}
          />
        </label>
        <label style={{ display: 'block', marginTop: 10 }}>
          Secondary Article Text:
          <textarea
            rows={6}
            value={secondaryText}
            onChange={e => setSecondaryText(e.target.value)}
            placeholder="Paste secondary article text here"
            style={{ width: '100%', fontSize: 14, padding: 6, marginTop: 4 }}
            disabled={loadingFinal || loadingSecondary}
          />
        </label>
        <button
          onClick={generateSecondary}
          disabled={loadingSecondary || loadingFinal || (!secondaryText.trim() && !secondaryUrl.trim())}
          style={{ marginTop: 6, padding: '6px 12px' }}
        >
          {loadingSecondary ? 'Generating Secondary...' : 'Generate Secondary Output'}
        </button>
      </div>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      {/* Outputs */}
      <div style={{ marginTop: 30 }}>
        <h2>Primary Output</h2>
        <textarea
          readOnly
          value={primaryOutput}
          rows={8}
          style={{ width: '100%', fontFamily: 'monospace', fontSize: 14 }}
        />

        <h2>Secondary Output</h2>
        <textarea
          readOnly
          value={secondaryOutput}
          rows={8}
          style={{ width: '100%', fontFamily: 'monospace', fontSize: 14, marginTop: 10 }}
        />

        <h2>Price Action</h2>
        <textarea
          readOnly
          value={priceAction}
          rows={6}
          style={{ width: '100%', fontFamily: 'monospace', fontSize: 14, marginTop: 10 }}
        />

        <h2>Final Output</h2>
        <textarea
          readOnly
          value={finalOutput}
          rows={20}
          style={{ width: '100%', fontFamily: 'monospace', fontSize: 14, marginTop: 10 }}
        />
        <button
          onClick={copyFinalOutput}
          disabled={!finalOutput}
          style={{ marginTop: 6, padding: '6px 12px', fontWeight: 'bold' }}
        >
          Copy Final Output
        </button>
      </div>

      {/* Final Generate Button at the bottom */}
      <button
        onClick={generateFinalStory}
        disabled={loadingFinal}
        style={{ marginTop: 20, padding: '10px 20px', fontSize: 16, width: '100%' }}
      >
        {loadingFinal ? 'Generating Full Story...' : 'Generate Final Story'}
      </button>
    </div>
  );
}
