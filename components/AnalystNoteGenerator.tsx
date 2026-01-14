'use client';

import { useState } from 'react';
import AnalystNoteUpload from './AnalystNoteUpload';

export default function AnalystNoteGenerator() {
  const [ticker, setTicker] = useState('');
  const [provider, setProvider] = useState<'openai' | 'gemini'>('openai');

  const handleTextExtracted = (text: string, tickerParam?: string) => {
    // Handle the extracted text - could be used for further processing
    console.log('Analyst note text extracted:', text.substring(0, 100));
    if (tickerParam) {
      setTicker(tickerParam);
    }
  };

  return (
    <section style={{ 
      padding: '32px', 
      backgroundColor: 'white', 
      borderRadius: '12px', 
      boxShadow: '0 4px 16px rgba(139, 92, 246, 0.25)',
      border: '4px solid #8b5cf6',
      marginTop: '40px'
    }}>
      <h2 style={{ 
        fontSize: '28px', 
        fontWeight: '700', 
        marginBottom: '24px', 
        color: '#1e293b',
        borderBottom: '2px solid #e5e7eb',
        paddingBottom: '16px'
      }}>
        Analyst Note Generator
      </h2>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ 
          display: 'block', 
          fontSize: '14px', 
          fontWeight: '600', 
          marginBottom: '8px', 
          color: '#374151' 
        }}>
          AI Provider
        </label>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as 'openai' | 'gemini')}
          style={{
            width: '100%',
            padding: '10px 12px',
            border: '1px solid #d1d5db',
            borderRadius: '8px',
            fontSize: '14px',
            backgroundColor: 'white',
            cursor: 'pointer',
            transition: 'all 0.2s'
          }}
        >
          <option value="openai">OpenAI (GPT-4o-mini)</option>
          <option value="gemini">Gemini (2.5 Flash)</option>
        </select>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ 
          display: 'block', 
          fontSize: '14px', 
          fontWeight: '600', 
          marginBottom: '8px', 
          color: '#374151' 
        }}>
          Stock Ticker (Optional - will be extracted from notes if not provided)
        </label>
        <input
          type="text"
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          placeholder="e.g. AAPL"
          style={{
            width: '100%',
            padding: '10px 12px',
            border: '1px solid #d1d5db',
            borderRadius: '8px',
            fontSize: '14px',
            backgroundColor: 'white'
          }}
        />
      </div>

      <AnalystNoteUpload 
        onTextExtracted={handleTextExtracted} 
        ticker={ticker}
        aiProvider={provider}
      />
    </section>
  );
}
