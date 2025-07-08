'use client';

import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';

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
  const [loadingNarratives, setLoadingNarratives] = useState(false);
  const [loadingNarrativeStory, setLoadingNarrativeStory] = useState(false);
  const [loadingHyperlinks, setLoadingHyperlinks] = useState(false);
  const [error, setError] = useState('');
  const [finalOutput, setFinalOutput] = useState('');
  const [hyperlinkedOutput, setHyperlinkedOutput] = useState('');

  // New state for narrative options and selected narrative
  const [narrativeOptions, setNarrativeOptions] = useState<string[]>([]);
  const [selectedNarrativeIndex, setSelectedNarrativeIndex] = useState<number | null>(null);
  const [narrativeStory, setNarrativeStory] = useState('');

  // New states for Lead Generator
  const [lead, setLead] = useState('');
  const [leadLoading, setLeadLoading] = useState(false);
  const [leadError, setLeadError] = useState('');

  // Helper to detect outlet name from URL
  function detectOutletName(url: string): string | null {
    try {
      const hostname = new URL(url).hostname.replace('www.', '').toLowerCase();
      if (hostname.includes('cnbc')) return 'CNBC';
      if (hostname.includes('wsj')) return 'The Wall Street Journal';
      if (hostname.includes('bloomberg')) return 'Bloomberg';
      if (hostname.includes('benzinga')) return 'Benzinga';
      if (hostname.includes('reuters')) return 'Reuters';
      const firstPart = hostname.split('.')[0];
      return firstPart.charAt(0).toUpperCase() + firstPart.slice(1);
    } catch {
      return null;
    }
  }

  async function fetchPriceAction(tickerSymbol: string) {
    setLoadingPriceAction(true);
    setError('');
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
          outletName: '', // Let backend derive outlet dynamically
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
    setHyperlinkedOutput('');
    setNarrativeOptions([]);
    setSelectedNarrativeIndex(null);
    setNarrativeStory('');
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

    const primaryOutlet = detectOutletName(primaryUrl) || 'Primary Source';
    const secondaryOutlet = detectOutletName(secondaryUrl) || 'Secondary Source';

    try {
      const res = await fetch('/api/generate/final', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead: primaryOutput,
          whatHappened: primaryOutput,
          whyItMatters: secondaryOutput,
          priceAction,
          primaryUrl: primaryUrl.trim(),
          secondaryUrl: secondaryUrl.trim(),
          primaryOutlet,
          secondaryOutlet,
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

  // New: Generate Narrative Options
  async function generateNarrativeOptions() {
    setError('');
    setNarrativeOptions([]);
    setSelectedNarrativeIndex(null);
    setNarrativeStory('');
    if (!finalOutput.trim()) {
      setError('Generate the final story first.');
      return;
    }
    setLoadingNarratives(true);
    try {
      const res = await fetch('/api/generate/narratives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyText: finalOutput }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate narrative options');
      setNarrativeOptions(data.options || []);
    } catch (e: any) {
      setError(e.message || 'Failed to generate narrative options');
    } finally {
      setLoadingNarratives(false);
    }
  }

  // New: Generate narrative story based on selected option
  async function generateNarrativeStory(index: number) {
    setError('');
    setNarrativeStory('');
    setLoadingNarrativeStory(true);
    try {
      const optionText = narrativeOptions[index];
      const res = await fetch('/api/generate/narrative-story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ finalStory: finalOutput, narrativeOption: optionText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate narrative story');
      setNarrativeStory(data.narrative || '');
      setSelectedNarrativeIndex(index);
    } catch (e: any) {
      setError(e.message || 'Failed to generate narrative story');
    } finally {
      setLoadingNarrativeStory(false);
    }
  }

  async function addHyperlinks() {
    if (!finalOutput.trim()) {
      setError('No final story to add hyperlinks to.');
      return;
    }
    setLoadingHyperlinks(true);
    setError('');
    try {
      const res = await fetch('/api/add-hyperlinks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: narrativeStory || finalOutput,
          primaryUrl: primaryUrl.trim(),
          secondaryUrl: secondaryUrl.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add hyperlinks');
      setHyperlinkedOutput(data.result || '');
    } catch (e: any) {
      setError(e.message || 'Failed to add hyperlinks');
    } finally {
      setLoadingHyperlinks(false);
    }
  }

  // Copy plain final output
  const copyFinalOutput = () => {
    if (!finalOutput) return;
    navigator.clipboard.writeText(finalOutput);
    alert('Final output copied to clipboard!');
  };

  // Copy hyperlinked output (rendered markdown)
  const copyHyperlinkedOutput = () => {
    if (!hyperlinkedOutput) return;
    navigator.clipboard.writeText(hyperlinkedOutput);
    alert('Hyperlinked output copied to clipboard!');
  };

  // Lead generator function
  async function generateLead(style: string) {
    if (!primaryText.trim()) {
      setLeadError('Please enter primary article text first.');
      return;
    }
    setLead('');
    setLeadError('');
    setLeadLoading(true);
    try {
      const res = await fetch('/api/generate/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleText: primaryText, style }),
      });
      if (!res.ok) throw new Error('Failed to generate lead');
      const data = await res.json();
      setLead(data.lead);
    } catch (error: any) {
      setLeadError(error.message);
    } finally {
      setLeadLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 700, margin: 'auto', padding: 20, fontFamily: 'Arial, sans-serif' }}>
      <h1>Market Story Generator</h1>

      {/* Ticker Input */}
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

      {/* Primary Article */}
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
        <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>
          Current Primary URL: {primaryUrl || <i>None entered</i>}
        </div>
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

      {/* Secondary Article */}
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
        <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>
          Current Secondary URL: {secondaryUrl || <i>None entered</i>}
        </div>
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

      {/* Narrative Options */}
      {narrativeOptions.length > 0 && (
        <div style={{ marginTop: 30 }}>
          <h2>Narrative Options</h2>
          <p>Select one to generate a Narrative Story:</p>
          {narrativeOptions.map((option, i) => (
            <button
              key={i}
              onClick={() => generateNarrativeStory(i)}
              disabled={loadingNarrativeStory}
              style={{
                display: 'block',
                margin: '8px 0',
                padding: '8px 12px',
                width: '100%',
                backgroundColor: i === selectedNarrativeIndex ? '#0070f3' : '#eee',
                color: i === selectedNarrativeIndex ? '#fff' : '#000',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              {option}
            </button>
          ))}
        </div>
      )}

      {/* Narrative Story Output */}
      {narrativeStory && (
        <div style={{ marginTop: 30 }}>
          <h2>Narrative Story</h2>
          <textarea
            readOnly
            value={narrativeStory}
            rows={15}
            style={{ width: '100%', fontFamily: 'monospace', fontSize: 14, marginTop: 10 }}
          />
        </div>
      )}

      {/* Add Hyperlinks Button */}
      <button
        onClick={addHyperlinks}
        disabled={loadingHyperlinks || (!finalOutput.trim() && !narrativeStory.trim())}
        style={{ marginTop: 20, padding: '10px 20px', fontSize: 16, width: '100%' }}
      >
        {loadingHyperlinks ? 'Adding Hyperlinks...' : 'Add Hyperlinks'}
      </button>

      {/* Render Hyperlinked Output as clickable Markdown */}
      {hyperlinkedOutput && (
        <div style={{ marginTop: 30 }}>
          <h2>Final Output With Hyperlinks</h2>
          <div
            style={{
              border: '1px solid #ccc',
              padding: 10,
              fontFamily: 'monospace',
              fontSize: 14,
              whiteSpace: 'pre-wrap',
              marginTop: 10,
            }}
          >
            <ReactMarkdown>{hyperlinkedOutput}</ReactMarkdown>
          </div>
          <button
            onClick={copyHyperlinkedOutput}
            disabled={!hyperlinkedOutput}
            style={{ marginTop: 6, padding: '6px 12px', fontWeight: 'bold' }}
          >
            Copy Hyperlinked Output
          </button>
        </div>
      )}

      {/* Final Generate Story button */}
      <button
        onClick={generateFinalStory}
        disabled={loadingFinal}
        style={{ marginTop: 20, padding: '10px 20px', fontSize: 16, width: '100%' }}
      >
        {loadingFinal ? 'Generating Full Story...' : 'Generate Final Story'}
      </button>

      {/* Generate Narrative Options button */}
      <button
        onClick={generateNarrativeOptions}
        disabled={loadingNarratives || !finalOutput.trim()}
        style={{ marginTop: 20, padding: '10px 20px', fontSize: 16, width: '100%' }}
      >
        {loadingNarratives ? 'Generating Narrative Options...' : 'Provide Narrative Options'}
      </button>

      {/* Lead Generator Section */}
      <div style={{ marginTop: 30, padding: 10, border: '1px solid #4caf50', borderRadius: 6 }}>
        <h2 style={{ marginBottom: 10, color: '#4caf50' }}>Lead Generator</h2>
        <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          {['longer', 'shorter', 'more narrative', 'more context'].map((style) => (
            <button
              key={style}
              onClick={() => generateLead(style)}
              disabled={leadLoading}
              style={{
                backgroundColor: '#4caf50',
                color: 'white',
                padding: '8px 16px',
                borderRadius: 4,
                border: 'none',
                cursor: leadLoading ? 'not-allowed' : 'pointer',
              }}
            >
              {leadLoading ? 'Generating...' : style.charAt(0).toUpperCase() + style.slice(1)}
            </button>
          ))}
        </div>
        {leadError && <p style={{ color: 'red', marginBottom: 10 }}>{leadError}</p>}
        {lead && (
          <textarea
            readOnly
            value={lead}
            rows={6}
            style={{ width: '100%', fontFamily: 'monospace', fontSize: 14, padding: 10, borderRadius: 4, borderColor: '#4caf50' }}
          />
        )}
      </div>
    </div>
  );
}
