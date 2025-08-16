'use client';

import React, { useState } from 'react';

interface AnalystNoteUploadProps {
  onTextExtracted: (text: string, ticker: string) => void;
  ticker: string;
}

export default function AnalystNoteUpload({ onTextExtracted, ticker }: AnalystNoteUploadProps) {
  const [manualText, setManualText] = useState('');

  const handleUseText = () => {
    if (manualText.trim() && ticker.trim()) {
      onTextExtracted(manualText.trim(), ticker.toUpperCase());
      setManualText('');
    } else {
      alert('Please enter text content and ensure ticker is set.');
    }
  };

  const handleClear = () => {
    setManualText('');
  };

  return (
    <div style={{ 
      border: '1px solid #e5e7eb', 
      borderRadius: '8px', 
      padding: '20px', 
      marginBottom: '20px',
      backgroundColor: '#f9fafb'
    }}>
      <h2 style={{ marginTop: 0, marginBottom: '16px', color: '#374151' }}>
        Analyst Note Input
      </h2>
      
      <div style={{ marginBottom: '16px' }}>
        <textarea
          value={manualText}
          onChange={(e) => setManualText(e.target.value)}
          placeholder="Paste your analyst note text here..."
          rows={8}
          style={{
            width: '100%',
            fontFamily: 'monospace',
            fontSize: '14px',
            padding: '12px',
            border: '1px solid #d1d5db',
            borderRadius: '4px',
            backgroundColor: '#ffffff',
            resize: 'vertical'
          }}
        />
      </div>

      <div style={{ marginBottom: '16px' }}>
        <button
          onClick={handleUseText}
          disabled={!manualText.trim() || !ticker.trim()}
          style={{
            padding: '8px 16px',
            background: !manualText.trim() || !ticker.trim() ? '#9ca3af' : '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: !manualText.trim() || !ticker.trim() ? 'not-allowed' : 'pointer',
            marginRight: '8px'
          }}
        >
          Use This Text
        </button>
        
        <button
          onClick={handleClear}
          style={{
            padding: '8px 16px',
            background: '#6b7280',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Clear
        </button>
      </div>
    </div>
  );
} 