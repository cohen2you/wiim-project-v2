'use client';

import React, { useState, useRef, useEffect } from 'react';

interface AnalystNote {
  id: string;
  text: string;
  filename: string;
  ticker?: string;
  isIncluded: boolean;
  isExpanded: boolean;
}

interface AnalystNoteUploadProps {
  onTextExtracted: (text: string, ticker: string) => void;
  ticker: string;
  aiProvider?: 'openai' | 'gemini';
}

export default function AnalystNoteUpload({ onTextExtracted, ticker, aiProvider = 'openai' }: AnalystNoteUploadProps) {
  const [notes, setNotes] = useState<AnalystNote[]>([]);
  const [manualText, setManualText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isGeneratingArticle, setIsGeneratingArticle] = useState(false);
  const [headline, setHeadline] = useState('');
  const [generatedArticle, setGeneratedArticle] = useState('');
  const [articleError, setArticleError] = useState('');
  const [isCheckingNumbers, setIsCheckingNumbers] = useState(false);
  const [numberChecks, setNumberChecks] = useState<any>(null);
  const [numberCheckError, setNumberCheckError] = useState('');
  const [isRegeneratingHeadline, setIsRegeneratingHeadline] = useState(false);
  const [previousHeadlines, setPreviousHeadlines] = useState<string[]>([]);
  const [combinedTextPreview, setCombinedTextPreview] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const articleEditorRef = useRef<HTMLDivElement>(null);
  const lastArticleContentRef = useRef<string>('');
  const isInternalUpdateRef = useRef<boolean>(false);

  // Sync contentEditable with state when article is generated externally (not from user typing)
  useEffect(() => {
    console.log('useEffect triggered. generatedArticle length:', generatedArticle?.length, 'isInternalUpdate:', isInternalUpdateRef.current, 'ref exists:', !!articleEditorRef.current);
    
    if (articleEditorRef.current && generatedArticle && generatedArticle !== lastArticleContentRef.current) {
      // Only update if this is an external change (not from user typing)
      // isInternalUpdateRef is set to true during onInput/onBlur, so we skip those
      if (!isInternalUpdateRef.current) {
        console.log('Updating contentEditable with new article');
        // This is an external update (e.g., new article generated)
        // Save cursor position if user is editing
        const selection = window.getSelection();
        const range = selection?.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
        const hadFocus = document.activeElement === articleEditorRef.current;
        
        // Update content
        articleEditorRef.current.innerHTML = generatedArticle;
        lastArticleContentRef.current = generatedArticle;
        console.log('ContentEditable updated. New innerHTML length:', articleEditorRef.current.innerHTML.length);
        
        // Restore cursor position if it was saved and element had focus
        if (range && hadFocus && selection) {
          try {
            selection.removeAllRanges();
            selection.addRange(range);
          } catch (e) {
            // If restoring fails, cursor will be at start (acceptable for new content)
          }
        }
      } else {
        console.log('Skipping update - internal change');
        // This was an internal update (user typing), just sync the ref
        lastArticleContentRef.current = generatedArticle;
      }
    } else {
      console.log('Skipping useEffect update:', {
        hasRef: !!articleEditorRef.current,
        hasArticle: !!generatedArticle,
        isDifferent: generatedArticle !== lastArticleContentRef.current
      });
    }
    // Reset the flag after processing
    isInternalUpdateRef.current = false;
  }, [generatedArticle]);

  // Extract ticker from text - matches backend patterns
  const extractTickerFromText = (text: string): string | null => {
    // Pattern 1: "(LULU, Buy, $303 PT)" - very common in analyst notes
    const pattern1 = /\(([A-Z]{1,5}),\s*(?:Buy|Sell|Hold|Outperform|Underperform|Neutral|Overweight|Underweight|Equal Weight|Market Perform|Strong Buy|Strong Sell|Positive|Negative|Neutral).*?\)/i;
    const match1 = text.match(pattern1);
    if (match1) {
      console.log('Frontend: Extracted ticker using pattern 1:', match1[1].toUpperCase());
      return match1[1].toUpperCase();
    }
    
    // Pattern 2: "(NASDAQ:LULU)" or "(NYSE:LULU)"
    const pattern2 = /\((?:NASDAQ|NYSE|AMEX|OTC|Nasdaq|NYSE):([A-Z]{1,5})\)/i;
    const match2 = text.match(pattern2);
    if (match2) {
      console.log('Frontend: Extracted ticker using pattern 2:', match2[1].toUpperCase());
      return match2[1].toUpperCase();
    }
    
    // Pattern 3: "(LULU)" - ticker in parentheses alone
    const pattern3 = /\(([A-Z]{1,5})\)/;
    const match3 = text.match(pattern3);
    if (match3) {
      const potentialTicker = match3[1].toUpperCase();
      const invalidTickers = ['THE', 'AND', 'FOR', 'ARE', 'WAS', 'HAS', 'HAD', 'WILL', 'THIS', 'THAT', 'INC', 'CORP', 'LLC', 'LTD'];
      if (!invalidTickers.includes(potentialTicker) && potentialTicker.length >= 2) {
        console.log('Frontend: Extracted ticker using pattern 3:', potentialTicker);
        return potentialTicker;
      }
    }
    
    // Pattern 4: "LULU US" at start of line
    const pattern4 = /^([A-Z]{1,5})\s+US\b/mi;
    const match4 = text.match(pattern4);
    if (match4) {
      console.log('Frontend: Extracted ticker using pattern 4:', match4[1].toUpperCase());
      return match4[1].toUpperCase();
    }
    
    console.log('Frontend: No ticker found in text');
    return null;
  };

  const handleUseText = () => {
    if (manualText.trim()) {
      // Only extract ticker from the note text, don't use main app ticker
      const extractedTicker = extractTickerFromText(manualText.trim()) || undefined;
      console.log('Frontend: Manual entry, extracted ticker:', extractedTicker);
      const newNote: AnalystNote = {
        id: Date.now().toString(),
        text: manualText.trim(),
        filename: 'Manual Entry',
        ticker: extractedTicker,
        isIncluded: true,
        isExpanded: false
      };
      setNotes([...notes, newNote]);
      setManualText('');
      updateCombinedPreview([...notes, newNote]);
    } else {
      alert('Please enter text content.');
    }
  };

  const handleClear = () => {
    setManualText('');
  };

  const updateCombinedPreview = (notesList: AnalystNote[]) => {
    const includedNotes = notesList.filter(n => n.isIncluded);
    if (includedNotes.length === 0) {
      setCombinedTextPreview('');
      return;
    }
    
    const combined = includedNotes.map((note, index) => {
      return `=== ANALYST NOTE ${index + 1}: ${note.filename}${note.ticker ? ` (${note.ticker})` : ''} ===\n\n${note.text}\n\n`;
    }).join('\n');
    
    setCombinedTextPreview(combined);
  };

  const handleNoteToggle = (noteId: string) => {
    const updatedNotes = notes.map(note => 
      note.id === noteId ? { ...note, isIncluded: !note.isIncluded } : note
    );
    setNotes(updatedNotes);
    updateCombinedPreview(updatedNotes);
  };

  const handleNoteExpand = (noteId: string) => {
    const updatedNotes = notes.map(note => 
      note.id === noteId ? { ...note, isExpanded: !note.isExpanded } : note
    );
    setNotes(updatedNotes);
  };

  const handleNoteEdit = (noteId: string, newText: string) => {
    const updatedNotes = notes.map(note => {
      if (note.id === noteId) {
        const updatedTicker = extractTickerFromText(newText) || note.ticker;
        return { ...note, text: newText, ticker: updatedTicker };
      }
      return note;
    });
    setNotes(updatedNotes);
    updateCombinedPreview(updatedNotes);
  };

  const handleNoteRemove = (noteId: string) => {
    const updatedNotes = notes.filter(note => note.id !== noteId);
    setNotes(updatedNotes);
    updateCombinedPreview(updatedNotes);
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
    const newNotes: AnalystNote[] = [];
    
    try {
      for (const file of files) {
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
            // If PDF extraction fails, skip this file and continue
            const errorMsg = data.error || 'Failed to extract text from PDF.';
            console.warn(`${file.name}: ${errorMsg}`);
            continue;
          }
        } else {
          console.warn(`Unsupported file type: ${file.name}`);
          continue;
        }

        if (extractedText.trim()) {
          // Only extract ticker from the note text, don't use main app ticker
          const extractedTicker = extractTickerFromText(extractedText.trim()) || undefined;
          console.log(`Frontend: Processed file ${file.name}, extracted ticker:`, extractedTicker);
          const newNote: AnalystNote = {
            id: `${Date.now()}-${Math.random()}`,
            text: extractedText.trim(),
            filename: file.name,
            ticker: extractedTicker,
            isIncluded: true,
            isExpanded: false
          };
          newNotes.push(newNote);
        }
      }

      if (newNotes.length > 0) {
        const updatedNotes = [...notes, ...newNotes];
        setNotes(updatedNotes);
        updateCombinedPreview(updatedNotes);
      } else {
        alert('No text could be extracted from the uploaded files.');
      }
    } catch (error) {
      console.error('Error processing files:', error);
      alert('Error processing files. Please try again or paste the text manually.');
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
    const includedNotes = notes.filter(n => n.isIncluded);
    
    if (includedNotes.length === 0 && !manualText.trim()) {
      alert('Please upload or enter at least one analyst note first.');
      return;
    }

    // If there's manual text but no notes, use manual text
    let textToUse = '';
    if (includedNotes.length > 0) {
      textToUse = includedNotes.map(note => note.text).join('\n\n=== NEXT ANALYST NOTE ===\n\n');
    } else {
      textToUse = manualText.trim();
    }

    if (!textToUse.trim()) {
      alert('Please enter or upload analyst note text first.');
      return;
    }

    setIsGeneratingArticle(true);
    setArticleError('');
    setGeneratedArticle('');
    setHeadline(''); // Clear headline when generating new article
    setPreviousHeadlines([]); // Reset previous headlines

    try {
      // Determine ticker - ONLY use tickers from notes, NOT from the main app
      // This ensures price action is based on the ticker in the analyst notes
      let finalTicker: string | undefined = undefined;
      if (includedNotes.length > 0) {
        const noteTickers = includedNotes.map(n => n.ticker).filter(Boolean);
        if (noteTickers.length > 0) {
          // Use the first ticker found, or warn if multiple different tickers
          finalTicker = noteTickers[0];
          if (new Set(noteTickers).size > 1) {
            console.warn('Multiple different tickers found in notes:', noteTickers);
            // Still use the first one, but log the warning
          }
        }
      }
      
      // If no ticker from notes, don't pass ticker - let API extract it from text
      // This ensures we never use the main app's ticker for analyst note articles

      const response = await fetch('/api/generate/analyst-article', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analystNoteText: textToUse,
          ticker: finalTicker, // Only ticker from notes, or undefined to let API extract
          aiProvider,
          multipleNotes: includedNotes.length > 1 ? includedNotes.map(n => ({ text: n.text, filename: n.filename, ticker: n.ticker })) : undefined
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('API error response:', data);
        throw new Error(data.error || 'Failed to generate article');
      }

      if (!data.article || !data.article.trim()) {
        console.error('Article is empty or missing. Response data:', {
          hasHeadline: !!data.headline,
          headlineLength: data.headline?.length,
          hasArticle: !!data.article,
          articleLength: data.article?.length,
          fullResponse: data
        });
        throw new Error(data.error || 'Generated article is empty. Please try again.');
      }

      // Set headline and article body separately
      setHeadline(data.headline || '');
      
      // Update article content - this will trigger useEffect to sync with contentEditable
      const newArticle = data.article || '';
      
      console.log('Setting generated article. Length:', newArticle.length);
      console.log('Article preview:', newArticle.substring(0, 200));
      
      // Ensure isInternalUpdateRef is false so useEffect will update the contentEditable
      isInternalUpdateRef.current = false;
      setGeneratedArticle(newArticle);
      
      setPreviousHeadlines([data.headline || '']); // Track headline for regeneration
      setNumberChecks(null); // Reset number checks when new article is generated
    } catch (error: any) {
      console.error('Error generating article:', error);
      setArticleError(error.message || 'Failed to generate article');
    } finally {
      setIsGeneratingArticle(false);
    }
  };

  const handleCheckNumbers = async () => {
    // Get the current content from the contentEditable div (may have been edited)
    let currentArticleContent = generatedArticle;
    if (articleEditorRef.current) {
      currentArticleContent = articleEditorRef.current.innerHTML;
      // Update state to match what's actually in the editor
      setGeneratedArticle(currentArticleContent);
      lastArticleContentRef.current = currentArticleContent;
    }

    if (!currentArticleContent || !currentArticleContent.trim()) {
      alert('Please generate an article first.');
      return;
    }

    const includedNotes = notes.filter(n => n.isIncluded);
    let sourceText = '';
    
    if (includedNotes.length > 0) {
      sourceText = includedNotes.map(note => note.text).join('\n\n');
    } else if (manualText.trim()) {
      sourceText = manualText.trim();
    } else {
      alert('No source text available for verification.');
      return;
    }

    setIsCheckingNumbers(true);
    setNumberCheckError('');
    setNumberChecks(null);

    try {
      // Use the current content from the editor (includes any manual edits)
      const response = await fetch('/api/check-numbers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          article: currentArticleContent,
          sourceText: sourceText
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
          multiple
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
        {isProcessing ? (
          <div>
            <div style={{ fontSize: '16px', color: '#2563eb', marginBottom: '8px' }}>
              Processing files...
            </div>
            <div style={{ fontSize: '14px', color: '#6b7280' }}>
              Please wait while we extract the text
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>📄</div>
            <div style={{ fontSize: '16px', fontWeight: '500', color: '#374151', marginBottom: '8px' }}>
              {isDragging ? 'Drop your analyst notes here' : 'Drag & drop your analyst notes here'}
            </div>
            <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '12px' }}>
              or click to browse (multiple files supported)
            </div>
            <div style={{ fontSize: '12px', color: '#9ca3af' }}>
              Supports .txt and .pdf files
            </div>
          </div>
        )}
      </div>

      {/* Notes List - Card View */}
      {notes.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            marginBottom: '12px'
          }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600', color: '#374151' }}>
              Uploaded Notes ({notes.length})
            </h3>
            <div style={{ fontSize: '14px', color: '#6b7280' }}>
              {notes.filter(n => n.isIncluded).length} selected
            </div>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {notes.map((note) => (
              <div
                key={note.id}
                style={{
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  padding: '16px',
                  backgroundColor: note.isIncluded ? '#ffffff' : '#f9fafb',
                  opacity: note.isIncluded ? 1 : 0.7
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                  <input
                    type="checkbox"
                    checked={note.isIncluded}
                    onChange={() => handleNoteToggle(note.id)}
                    style={{ marginTop: '4px', cursor: 'pointer' }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <div>
                        <div style={{ fontSize: '14px', fontWeight: '600', color: '#374151' }}>
                          {note.filename}
                        </div>
                        {note.ticker && (
                          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
                            Ticker: {note.ticker}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          onClick={() => handleNoteExpand(note.id)}
                          style={{
                            padding: '4px 8px',
                            background: '#f3f4f6',
                            color: '#374151',
                            border: '1px solid #d1d5db',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '12px'
                          }}
                        >
                          {note.isExpanded ? 'Collapse' : 'Expand'}
                        </button>
                        <button
                          onClick={() => handleNoteRemove(note.id)}
                          style={{
                            padding: '4px 8px',
                            background: '#fee2e2',
                            color: '#dc2626',
                            border: '1px solid #fecaca',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '12px'
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    
                    {note.isExpanded && (
                      <div style={{ marginTop: '12px' }}>
                        <textarea
                          value={note.text}
                          onChange={(e) => handleNoteEdit(note.id, e.target.value)}
                          rows={8}
                          style={{
                            width: '100%',
                            fontFamily: 'monospace',
                            fontSize: '12px',
                            padding: '8px',
                            border: '1px solid #d1d5db',
                            borderRadius: '4px',
                            backgroundColor: '#ffffff',
                            resize: 'vertical'
                          }}
                        />
                      </div>
                    )}
                    
                    {!note.isExpanded && (
                      <div style={{ 
                        fontSize: '12px', 
                        color: '#6b7280',
                        marginTop: '8px',
                        maxHeight: '60px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}>
                        {note.text.substring(0, 200)}...
                      </div>
                    )}
                    
                    <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '8px' }}>
                      {note.text.length.toLocaleString()} characters
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Combined Text Preview */}
      {combinedTextPreview && notes.filter(n => n.isIncluded).length > 1 && (
        <div style={{ 
          marginBottom: '20px',
          padding: '12px',
          backgroundColor: '#f0f9ff',
          border: '1px solid #bae6fd',
          borderRadius: '8px'
        }}>
          <div style={{ fontSize: '14px', fontWeight: '600', color: '#0369a1', marginBottom: '8px' }}>
            Combined Preview ({notes.filter(n => n.isIncluded).length} notes)
          </div>
          <div style={{ 
            fontSize: '12px', 
            color: '#0c4a6e',
            maxHeight: '150px',
            overflowY: 'auto',
            fontFamily: 'monospace',
            whiteSpace: 'pre-wrap'
          }}>
            {combinedTextPreview.substring(0, 1000)}
            {combinedTextPreview.length > 1000 ? '...' : ''}
          </div>
        </div>
      )}
      
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

        {(manualText.trim() || notes.filter(n => n.isIncluded).length > 0) && (
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
            {isGeneratingArticle 
              ? 'Generating Article...' 
              : notes.filter(n => n.isIncluded).length > 1
                ? `Generate Article from ${notes.filter(n => n.isIncluded).length} Notes`
                : 'Generate Article'}
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

      {(headline || generatedArticle) && (
        <div style={{ 
          marginTop: '20px',
          padding: '20px',
          backgroundColor: '#ffffff',
          border: '1px solid #e5e7eb',
          borderRadius: '8px'
        }}>
          {/* Headline Section */}
          {headline && (
            <div style={{ marginBottom: '24px' }}>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                marginBottom: '12px',
                flexWrap: 'wrap',
                gap: '8px'
              }}>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '600', color: '#374151' }}>
                  Headline
                </h3>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={async () => {
                      setIsRegeneratingHeadline(true);
                      try {
                        const includedNotes = notes.filter(n => n.isIncluded);
                        const textForHeadline = includedNotes.length > 0
                          ? includedNotes.map(note => note.text).join('\n\n=== NEXT ANALYST NOTE ===\n\n')
                          : manualText.trim();
                        
                        const tickerForHeadline = includedNotes.length > 0
                          ? (includedNotes.find(n => n.ticker)?.ticker || ticker.trim() || undefined)
                          : (ticker.trim() || undefined);

                        const response = await fetch('/api/generate/headline', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            analystNoteText: textForHeadline,
                            ticker: tickerForHeadline,
                            aiProvider,
                            existingHeadlines: previousHeadlines
                          }),
                        });

                        const data = await response.json();
                        if (!response.ok || !data.headline) {
                          throw new Error(data.error || 'Failed to regenerate headline');
                        }

                        setHeadline(data.headline);
                        setPreviousHeadlines([...previousHeadlines, data.headline]);
                      } catch (error: any) {
                        console.error('Error regenerating headline:', error);
                        alert(error.message || 'Failed to regenerate headline');
                      } finally {
                        setIsRegeneratingHeadline(false);
                      }
                    }}
                    disabled={isRegeneratingHeadline}
                    style={{
                      padding: '6px 12px',
                      background: isRegeneratingHeadline ? '#9ca3af' : '#8b5cf6',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: isRegeneratingHeadline ? 'not-allowed' : 'pointer',
                      fontSize: '14px',
                      fontWeight: '500'
                    }}
                  >
                    {isRegeneratingHeadline ? 'Updating...' : 'Update'}
                  </button>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(headline);
                      alert('Headline copied to clipboard!');
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
                    Copy
                  </button>
                </div>
              </div>
              <div
                contentEditable
                suppressContentEditableWarning
                onInput={(e) => {
                  const target = e.target as HTMLElement;
                  setHeadline(target.textContent || '');
                }}
                onBlur={(e) => {
                  const target = e.target as HTMLElement;
                  setHeadline(target.textContent || '');
                }}
                style={{
                  width: '100%',
                  padding: '12px',
                  backgroundColor: '#f9fafb',
                  borderRadius: '4px',
                  border: '1px solid #e5e7eb',
                  fontSize: '18px',
                  fontWeight: '600',
                  fontFamily: 'Arial, sans-serif',
                  outline: 'none',
                  minHeight: '50px'
                }}
              >
                {headline}
              </div>
            </div>
          )}

          {/* Article Body Section */}
          {generatedArticle && (
            <>
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
                    {isCheckingNumbers ? 'Checking...' : 'Check Numbers/Quotes'}
                  </button>
                  <button
                    onClick={() => {
                      // Copy the HTML content (with formatting)
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
                ref={articleEditorRef}
                contentEditable
                suppressContentEditableWarning
                onInput={(e) => {
                  const target = e.target as HTMLElement;
                  const newContent = target.innerHTML;
                  
                  // Mark as internal update to prevent cursor jumping
                  isInternalUpdateRef.current = true;
                  setGeneratedArticle(newContent);
                  lastArticleContentRef.current = newContent;
                  
                  // Reset number checks when article is edited
                  setNumberChecks(null);
                }}
                onBlur={(e) => {
                  const target = e.target as HTMLElement;
                  const newContent = target.innerHTML;
                  
                  // Mark as internal update
                  isInternalUpdateRef.current = true;
                  setGeneratedArticle(newContent);
                  lastArticleContentRef.current = newContent;
                }}
                style={{
                  width: '100%',
                  minHeight: '400px',
                  maxHeight: '600px',
                  padding: '16px',
                  backgroundColor: '#f9fafb',
                  borderRadius: '4px',
                  border: '1px solid #e5e7eb',
                  fontSize: '14px',
                  lineHeight: '1.6',
                  fontFamily: 'Arial, sans-serif',
                  marginBottom: '20px',
                  overflowY: 'auto',
                  whiteSpace: 'pre-wrap',
                  outline: 'none'
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
                <>
                  {/* Number Verification Results */}
                  {numberChecks.numbers && numberChecks.numbers.checks.length > 0 && (
                    <div style={{
                  marginTop: '20px',
                  padding: '16px',
                  backgroundColor: '#f9fafb',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  marginBottom: '20px'
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
                      {numberChecks.numbers.summary.matches} of {numberChecks.numbers.summary.total} verified ({numberChecks.numbers.summary.matchRate}%)
                    </div>
                  </div>
                  
                  <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                    {numberChecks.numbers.checks.map((check: any, index: number) => (
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

                  {/* Quote Verification Results */}
                  {numberChecks.quotes && (
                    <div style={{
                  marginTop: '20px',
                  padding: '16px',
                  backgroundColor: '#f9fafb',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px'
                }}>
                  <h4 style={{ margin: 0, marginBottom: '16px', fontSize: '16px', fontWeight: '600', color: '#374151' }}>
                    Quote Verification Results
                  </h4>
                  
                  {numberChecks.quotes.checks.length === 0 ? (
                    <div style={{
                      padding: '12px',
                      backgroundColor: '#f3f4f6',
                      border: '1px solid #e5e7eb',
                      borderRadius: '4px',
                      color: '#6b7280',
                      fontSize: '14px'
                    }}>
                      No direct quotes in generated article.
                    </div>
                  ) : (
                    <>
                      <div style={{ 
                        fontSize: '14px', 
                        color: '#6b7280',
                        marginBottom: '16px'
                      }}>
                        {numberChecks.quotes.summary.exact} exact, {numberChecks.quotes.summary.paraphrased || 0} paraphrased, {numberChecks.quotes.summary.notFound || 0} not found ({numberChecks.quotes.summary.exactRate}% exact)
                      </div>
                      
                      <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                        {numberChecks.quotes.checks.map((check: any, index: number) => {
                          const getStatusColor = () => {
                            if (check.status === 'exact') return { bg: '#f0fdf4', border: '#bbf7d0', text: '#059669', badge: '#d1fae5', badgeText: '#065f46' };
                            if (check.status === 'paraphrased') return { bg: '#fffbeb', border: '#fde68a', text: '#d97706', badge: '#fef3c7', badgeText: '#92400e' };
                            return { bg: '#fef2f2', border: '#fecaca', text: '#dc2626', badge: '#fee2e2', badgeText: '#991b1b' };
                          };
                          const colors = getStatusColor();
                          
                          const handleRemoveQuote = () => {
                            if (!articleEditorRef.current) return;
                            
                            const currentContent = articleEditorRef.current.innerHTML;
                            // Extract just the quote text (without the quote marks)
                            const quoteText = check.quote.replace(/^['"]|['"]$/g, '').trim();
                            
                            // Escape special regex characters in the quote text
                            const escapedQuote = quoteText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                            
                            // Try removing with double quotes (body quotes) - match the full quote with quotes
                            let newContent = currentContent;
                            const doubleQuotePattern = new RegExp(`"${escapedQuote}"`, 'gi');
                            if (doubleQuotePattern.test(newContent)) {
                              newContent = newContent.replace(doubleQuotePattern, quoteText);
                            } else {
                              // Try with single quotes (headline quotes)
                              const singleQuotePattern = new RegExp(`'${escapedQuote}'`, 'gi');
                              if (singleQuotePattern.test(newContent)) {
                                newContent = newContent.replace(singleQuotePattern, quoteText);
                              } else {
                                // If exact match not found, try without quotes (in case quotes were already removed)
                                const noQuotePattern = new RegExp(escapedQuote, 'gi');
                                newContent = newContent.replace(noQuotePattern, quoteText);
                              }
                            }
                            
                            // Update the contentEditable
                            articleEditorRef.current.innerHTML = newContent;
                            setGeneratedArticle(newContent);
                            lastArticleContentRef.current = newContent;
                            
                            // Clear checks so user can re-check
                            setNumberChecks(null);
                            
                            // Show confirmation
                            alert('Quote removed. Click "Check Numbers/Quotes" again to verify.');
                          };
                          
                          const handleJumpToQuote = () => {
                            if (!articleEditorRef.current) return;
                            
                            const currentContent = articleEditorRef.current.innerHTML;
                            const quoteText = check.quote.replace(/^['"]|['"]$/g, '').trim();
                            const escapedQuote = quoteText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                            
                            // Try to find the quote in the content
                            const doubleQuotePattern = new RegExp(`"${escapedQuote}"`, 'gi');
                            const singleQuotePattern = new RegExp(`'${escapedQuote}'`, 'gi');
                            
                            let searchIndex = -1;
                            if (doubleQuotePattern.test(currentContent)) {
                              const match = currentContent.match(doubleQuotePattern);
                              if (match) {
                                searchIndex = currentContent.indexOf(match[0]);
                              }
                            } else if (singleQuotePattern.test(currentContent)) {
                              const match = currentContent.match(singleQuotePattern);
                              if (match) {
                                searchIndex = currentContent.indexOf(match[0]);
                              }
                            }
                            
                            if (searchIndex !== -1) {
                              // Scroll to the quote and highlight it
                              articleEditorRef.current.focus();
                              const range = document.createRange();
                              const selection = window.getSelection();
                              
                              try {
                                // Find the text node containing the quote
                                const walker = document.createTreeWalker(
                                  articleEditorRef.current,
                                  NodeFilter.SHOW_TEXT,
                                  null
                                );
                                
                                let node;
                                let charCount = 0;
                                while (node = walker.nextNode()) {
                                  const nodeLength = node.textContent?.length || 0;
                                  if (charCount + nodeLength >= searchIndex) {
                                    range.setStart(node, searchIndex - charCount);
                                    range.setEnd(node, Math.min(searchIndex - charCount + quoteText.length, nodeLength));
                                    selection?.removeAllRanges();
                                    selection?.addRange(range);
                                    articleEditorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                    break;
                                  }
                                  charCount += nodeLength;
                                }
                              } catch (e) {
                                console.error('Error jumping to quote:', e);
                              }
                            }
                          };
                          
                          return (
                            <div
                              key={index}
                              style={{
                                padding: '12px',
                                marginBottom: '8px',
                                backgroundColor: colors.bg,
                                border: `1px solid ${colors.border}`,
                                borderRadius: '4px'
                              }}
                            >
                              <div style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                marginBottom: '8px',
                                gap: '8px',
                                flexWrap: 'wrap'
                              }}>
                                <span style={{
                                  fontSize: '16px',
                                  fontWeight: '600',
                                  color: colors.text,
                                  fontStyle: 'italic',
                                  flex: 1
                                }}>
                                  {check.quote}
                                </span>
                                <span style={{
                                  padding: '2px 8px',
                                  borderRadius: '4px',
                                  fontSize: '12px',
                                  fontWeight: '500',
                                  backgroundColor: colors.badge,
                                  color: colors.badgeText
                                }}>
                                  {check.status === 'exact' ? '✓ Exact Match' : 
                                   check.status === 'paraphrased' ? `⚠ Paraphrased (${Math.round((check.similarityScore || 0) * 100)}% similar)` : 
                                   '✗ Not Found in Source'}
                                </span>
                                <div style={{ display: 'flex', gap: '4px' }}>
                                  <button
                                    onClick={handleJumpToQuote}
                                    style={{
                                      padding: '4px 8px',
                                      background: '#2563eb',
                                      color: 'white',
                                      border: 'none',
                                      borderRadius: '4px',
                                      cursor: 'pointer',
                                      fontSize: '12px',
                                      fontWeight: '500'
                                    }}
                                    title="Jump to this quote in the article"
                                  >
                                    Jump to Quote
                                  </button>
                                  {check.status !== 'exact' && (
                                    <button
                                      onClick={handleRemoveQuote}
                                      style={{
                                        padding: '4px 8px',
                                        background: '#dc2626',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontSize: '12px',
                                        fontWeight: '500'
                                      }}
                                      title="Remove quote marks from this text (convert to regular text)"
                                    >
                                      Remove Quotes
                                    </button>
                                  )}
                                </div>
                              </div>
                              {check.status === 'paraphrased' && check.sourceContext && (
                                <div style={{ fontSize: '12px', color: '#92400e', marginBottom: '8px', padding: '8px', backgroundColor: '#fef3c7', borderRadius: '4px' }}>
                                  <strong>Similar text in source:</strong> {check.sourceContext.substring(0, 200)}
                                  {check.sourceContext.length > 200 ? '...' : ''}
                                </div>
                              )}
                              {check.status === 'exact' && check.sourceContext && (
                                <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px' }}>
                                  <strong>Found in source:</strong> {check.sourceContext.substring(0, 150)}
                                  {check.sourceContext.length > 150 ? '...' : ''}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </> 
                  )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
} 