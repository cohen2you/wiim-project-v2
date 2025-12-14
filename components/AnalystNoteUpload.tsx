'use client';

import React, { useState, useRef } from 'react';

interface AnalystNoteUploadProps {
  onTextExtracted: (text: string, ticker: string) => void;
  ticker: string;
  aiProvider?: 'openai' | 'gemini';
}

export default function AnalystNoteUpload({ onTextExtracted, ticker, aiProvider = 'openai' }: AnalystNoteUploadProps) {
  const [manualText, setManualText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isGeneratingArticle, setIsGeneratingArticle] = useState(false);
  const [generatedArticle, setGeneratedArticle] = useState('');
  const [articleError, setArticleError] = useState('');
  const [isCheckingNumbers, setIsCheckingNumbers] = useState(false);
  const [numberChecks, setNumberChecks] = useState<any>(null);
  const [numberCheckError, setNumberCheckError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      await processFiles(files);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      await processFiles(Array.from(files));
    }
  };

  const processFiles = async (files: File[]) => {
    setIsProcessing(true);
    try {
      const file = files[0]; // Process first file
      const fileType = file.type;
      let extractedText = '';

      if (fileType === 'text/plain' || file.name.endsWith('.txt')) {
        // Handle text files
        extractedText = await file.text();
      } else if (fileType === 'application/pdf' || file.name.endsWith('.pdf')) {
        // Handle PDF files - send to API for extraction
        const formData = new FormData();
        formData.append('file', file);
        
        const response = await fetch('/api/extract-pdf', {
          method: 'POST',
          body: formData,
        });
        
        const data = await response.json();
        
        if (response.ok && data.text) {
          extractedText = data.text;
          console.log(`Successfully extracted ${data.text.length} characters from PDF${data.pageCount ? ` (${data.pageCount} pages)` : ''}`);
        } else {
          // If PDF extraction fails, show helpful message
          const errorMsg = data.error || 'Failed to extract text from PDF.';
          alert(`${errorMsg} Please copy and paste the text from the PDF manually into the text area below.`);
          setIsProcessing(false);
          return;
        }
      } else {
        alert('Unsupported file type. Please upload a .txt or .pdf file, or paste the text manually.');
        setIsProcessing(false);
        return;
      }

      if (extractedText.trim()) {
        setManualText(extractedText.trim());
      } else {
        alert('No text could be extracted from the file.');
      }
    } catch (error) {
      console.error('Error processing file:', error);
      alert('Error processing file. Please try again or paste the text manually.');
    } finally {
      setIsProcessing(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleClickUpload = () => {
    fileInputRef.current?.click();
  };

  const handleGenerateArticle = async () => {
    if (!manualText.trim()) {
      alert('Please enter or upload analyst note text first.');
      return;
    }

    setIsGeneratingArticle(true);
    setArticleError('');
    setGeneratedArticle('');

    try {
      const response = await fetch('/api/generate/analyst-article', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analystNoteText: manualText.trim(),
          ticker: ticker.trim() || undefined, // Pass ticker if available, otherwise let API extract it
          aiProvider
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.article) {
        throw new Error(data.error || 'Failed to generate article');
      }

      setGeneratedArticle(data.article);
      setNumberChecks(null); // Reset number checks when new article is generated
    } catch (error: any) {
      console.error('Error generating article:', error);
      setArticleError(error.message || 'Failed to generate article');
    } finally {
      setIsGeneratingArticle(false);
    }
  };

  const handleCheckNumbers = async () => {
    if (!generatedArticle || !manualText.trim()) {
      alert('Please generate an article first.');
      return;
    }

    setIsCheckingNumbers(true);
    setNumberCheckError('');
    setNumberChecks(null);

    try {
      const response = await fetch('/api/check-numbers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          article: generatedArticle,
          sourceText: manualText.trim()
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to check numbers');
      }

      setNumberChecks(data);
    } catch (error: any) {
      console.error('Error checking numbers:', error);
      setNumberCheckError(error.message || 'Failed to check numbers');
    } finally {
      setIsCheckingNumbers(false);
    }
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
      
      {/* Drag and Drop Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClickUpload}
        style={{
          border: `2px dashed ${isDragging ? '#2563eb' : '#d1d5db'}`,
          borderRadius: '8px',
          padding: '40px',
          textAlign: 'center',
          backgroundColor: isDragging ? '#eff6ff' : '#ffffff',
          cursor: 'pointer',
          transition: 'all 0.2s',
          marginBottom: '16px',
          position: 'relative'
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.pdf"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
        {isProcessing ? (
          <div>
            <div style={{ fontSize: '16px', color: '#2563eb', marginBottom: '8px' }}>
              Processing file...
            </div>
            <div style={{ fontSize: '14px', color: '#6b7280' }}>
              Please wait while we extract the text
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>📄</div>
            <div style={{ fontSize: '16px', fontWeight: '500', color: '#374151', marginBottom: '8px' }}>
              {isDragging ? 'Drop your analyst note here' : 'Drag & drop your analyst note here'}
            </div>
            <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '12px' }}>
              or click to browse
            </div>
            <div style={{ fontSize: '12px', color: '#9ca3af' }}>
              Supports .txt and .pdf files
            </div>
          </div>
        )}
      </div>
      
      <div style={{ marginBottom: '16px' }}>
        <textarea
          value={manualText}
          onChange={(e) => setManualText(e.target.value)}
          placeholder="Or paste your analyst note text here..."
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
            cursor: 'pointer',
            marginRight: '8px'
          }}
        >
          Clear
        </button>

        {manualText.trim() && (
          <button
            onClick={handleGenerateArticle}
            disabled={isGeneratingArticle}
            style={{
              padding: '8px 16px',
              background: isGeneratingArticle ? '#9ca3af' : '#059669',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: isGeneratingArticle ? 'not-allowed' : 'pointer',
              fontWeight: '500'
            }}
          >
            {isGeneratingArticle ? 'Generating Article...' : 'Generate Article'}
          </button>
        )}
      </div>

      {articleError && (
        <div style={{ 
          marginBottom: '16px', 
          padding: '12px', 
          backgroundColor: '#fef2f2', 
          border: '1px solid #fecaca', 
          borderRadius: '4px',
          color: '#dc2626'
        }}>
          Error: {articleError}
        </div>
      )}

      {generatedArticle && (
        <div style={{ 
          marginTop: '20px',
          padding: '20px',
          backgroundColor: '#ffffff',
          border: '1px solid #e5e7eb',
          borderRadius: '8px'
        }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            marginBottom: '16px',
            flexWrap: 'wrap',
            gap: '8px'
          }}>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '600', color: '#374151' }}>
              Generated Article
            </h3>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={handleCheckNumbers}
                disabled={isCheckingNumbers}
                style={{
                  padding: '6px 12px',
                  background: isCheckingNumbers ? '#9ca3af' : '#059669',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: isCheckingNumbers ? 'not-allowed' : 'pointer',
                  fontSize: '14px',
                  fontWeight: '500'
                }}
              >
                {isCheckingNumbers ? 'Checking...' : 'Check Numbers'}
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(generatedArticle);
                  alert('Article copied to clipboard!');
                }}
                style={{
                  padding: '6px 12px',
                  background: '#2563eb',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                Copy Article
              </button>
            </div>
          </div>
          <div
            style={{
              maxHeight: '600px',
              overflowY: 'auto',
              padding: '16px',
              backgroundColor: '#f9fafb',
              borderRadius: '4px',
              border: '1px solid #e5e7eb',
              whiteSpace: 'pre-wrap',
              fontSize: '14px',
              lineHeight: '1.6',
              fontFamily: 'Arial, sans-serif',
              marginBottom: '20px'
            }}
            dangerouslySetInnerHTML={{ 
              __html: generatedArticle
                .split('\n\n')
                .filter(p => p.trim())
                .map(p => `<p style="margin-bottom: 16px;">${p.replace(/\n/g, '<br>')}</p>`)
                .join('')
            }}
          />
          
          {numberCheckError && (
            <div style={{ 
              marginTop: '16px',
              padding: '12px',
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '4px',
              color: '#dc2626'
            }}>
              Error: {numberCheckError}
            </div>
          )}
          
          {numberChecks && (
            <div style={{
              marginTop: '20px',
              padding: '16px',
              backgroundColor: '#f9fafb',
              border: '1px solid #e5e7eb',
              borderRadius: '8px'
            }}>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                marginBottom: '16px'
              }}>
                <h4 style={{ margin: 0, fontSize: '16px', fontWeight: '600', color: '#374151' }}>
                  Number Verification Results
                </h4>
                <div style={{ fontSize: '14px', color: '#6b7280' }}>
                  {numberChecks.summary.matches} of {numberChecks.summary.total} verified ({numberChecks.summary.matchRate}%)
                </div>
              </div>
              
              <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                {numberChecks.checks.map((check: any, index: number) => (
                  <div
                    key={index}
                    style={{
                      padding: '12px',
                      marginBottom: '8px',
                      backgroundColor: check.found ? '#f0fdf4' : '#fef2f2',
                      border: `1px solid ${check.found ? '#bbf7d0' : '#fecaca'}`,
                      borderRadius: '4px'
                    }}
                  >
                    <div style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      marginBottom: '8px',
                      gap: '8px'
                    }}>
                      <span style={{
                        fontSize: '18px',
                        fontWeight: 'bold',
                        color: check.found ? '#059669' : '#dc2626'
                      }}>
                        {check.number}
                      </span>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: '500',
                        backgroundColor: check.found ? '#d1fae5' : '#fee2e2',
                        color: check.found ? '#065f46' : '#991b1b'
                      }}>
                        {check.found ? '✓ Verified' : '✗ Not Found'}
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
                      <strong>In article:</strong> {check.articleContext.substring(0, 100)}
                      {check.articleContext.length > 100 ? '...' : ''}
                    </div>
                    {check.sourceContext && (
                      <div style={{ fontSize: '12px', color: '#6b7280' }}>
                        <strong>In source:</strong> {check.sourceContext.substring(0, 100)}
                        {check.sourceContext.length > 100 ? '...' : ''}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
} 