'use client';

import React, { useState, useRef, useEffect } from 'react';
import CustomizeContextModal from './CustomizeContextModal';

interface StoryComponent {
  id: string;
  type: 'headline' | 'lead' | 'technical' | 'analystRatings' | 'edgeRatings' | 'newsContext' | 'priceAction' | 'alsoReadLink';
  content: string;
  order: number;
  isActive: boolean;
}

interface ModularStoryBuilderProps {
  ticker: string;
  currentArticle: string;
  onStoryUpdate: (story: string) => void;
  aiProvider?: 'openai' | 'gemini';
}

export default function ModularStoryBuilder({ ticker, currentArticle, onStoryUpdate, aiProvider = 'openai' }: ModularStoryBuilderProps) {
  const [components, setComponents] = useState<StoryComponent[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string>('');
  const [showCustomizeModal, setShowCustomizeModal] = useState(false);
  const [loadingCustomContext, setLoadingCustomContext] = useState(false);
  const [originalStory, setOriginalStory] = useState<string>('');
  const [hasBaseStory, setHasBaseStory] = useState(false);
  const articleRef = useRef<HTMLDivElement>(null);

  // Check if we have a base story (more than just scraped content)
  useEffect(() => {
    if (currentArticle && currentArticle.length > 200 && !currentArticle.includes('Benzinga')) {
      setHasBaseStory(true);
    } else {
      setHasBaseStory(false);
    }
  }, [currentArticle]);



  // Helper function to rebuild article from components
  const rebuildArticle = (updatedComponents: StoryComponent[]) => {
    const activeComponents = updatedComponents
      .filter(comp => comp.isActive)
      .sort((a, b) => a.order - b.order);
    
    const parts = activeComponents.map(comp => comp.content);
    let article = parts.join('\n\n');
    
    // Insert Also Read link in the middle of the article
    const alsoReadComponent = activeComponents.find(comp => comp.type === 'alsoReadLink');
    if (alsoReadComponent) {
      const paragraphs = article.split('\n\n').filter(p => p.trim());
      if (paragraphs.length >= 3) {
        // Insert in the middle of the article
        // For stories with 3+ paragraphs, place it after the middle paragraph
        // For stories with 4+ paragraphs, place it after the second paragraph (more towards middle)
        const insertIndex = paragraphs.length >= 4 ? 2 : Math.floor(paragraphs.length / 2);
        const newParagraphs = [...paragraphs];
        newParagraphs.splice(insertIndex + 1, 0, alsoReadComponent.content);
        article = newParagraphs.join('\n\n');
      } else {
        // If story is too short, just add at the end
        article += '\n\n' + alsoReadComponent.content;
      }
    }
    
    return article;
  };

  // Add a new component
  const addComponent = async (type: StoryComponent['type']) => {
    setLoading(type);
    setError('');
    
    try {
      let endpoint = '';
      let requestBody: any = { ticker };
      
      switch (type) {
        case 'headline':
          endpoint = '/api/generate/headline';
          break;
        case 'lead':
          endpoint = '/api/generate/lead-paragraph';
          break;
        case 'technical':
          endpoint = '/api/generate/technical-analysis';
          break;
        case 'analystRatings':
          endpoint = '/api/generate/add-analyst-ratings';
          requestBody.existingStory = currentArticle;
          requestBody.aiProvider = aiProvider;
          break;
        case 'edgeRatings':
          endpoint = '/api/generate/add-edge-ratings';
          requestBody.existingStory = currentArticle;
          requestBody.aiProvider = aiProvider;
          break;
        case 'newsContext':
          endpoint = '/api/generate/add-context';
          requestBody.existingStory = currentArticle;
          break;
        case 'priceAction':
          endpoint = '/api/generate/add-price-action';
          requestBody.story = currentArticle;
          break;
        case 'alsoReadLink':
          endpoint = '/api/generate/add-also-read';
          requestBody.story = currentArticle;
          break;
      }
      
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      
      const data = await res.json();
      if (!res.ok || !data) throw new Error(data.error || `Failed to generate ${type}`);
      
      let content = '';
      if (type === 'priceAction' || type === 'alsoReadLink' || type === 'analystRatings' || type === 'edgeRatings' || type === 'newsContext') {
        // For these types, use the complete story to preserve existing content (like integrated hyperlinks)
        // The API returns the complete enhanced story with the new content integrated
        onStoryUpdate(data.story);
        
        // Extract content for display purposes
        if (type === 'analystRatings') {
          // Extract analyst ratings section from the story or use the analystRatingsContent from response
          // Should include all three paragraphs (consensus/ratings and two analysis paragraphs)
          if (data.analystRatingsContent) {
            content = data.analystRatingsContent;
          } else {
            // Try to extract from the story (should capture all three paragraphs)
            const analystRatingsMatch = data.story.match(/(?:Analysts|The analyst)[\s\S]*?(?=\n\n(?:[A-Z][a-z]+:|Price Action:|Also Read:|Read Next:|Benzinga Edge)|$)/i);
            content = analystRatingsMatch ? analystRatingsMatch[0].trim() : '';
          }
          // Continue to create component for analystRatings
        } else if (type === 'edgeRatings') {
          // Extract the edge ratings section from the story or use the edgeRatings from response
          // Should include both paragraphs (rankings and analysis)
          if (data.edgeRatings) {
            content = data.edgeRatings;
          } else {
            // Try to extract from the story (should capture both paragraphs)
            const edgeRatingsMatch = data.story.match(/Benzinga Edge rankings[\s\S]*?(?=\n\n(?:[A-Z][a-z]+:|Price Action:|Also Read:|Read Next:)|$)/i);
            content = edgeRatingsMatch ? edgeRatingsMatch[0].trim() : '';
          }
          // Continue to create component for edgeRatings
        } else if (type === 'newsContext') {
          // For news context, use the complete story to preserve integrated hyperlinks
          // Don't create a separate component for news context since it's integrated
          return; // Exit early since we've updated the story directly
        } else if (type === 'priceAction') {
          // Extract the price action line from the story or use the priceActionLine from response
          if (data.priceActionLine) {
            content = data.priceActionLine;
          } else {
            // Try to extract from the story
            const priceActionMatch = data.story.match(/<strong>[A-Z]+ Price Action:<\/strong>.*?(?=\n\n|Read Next:|Also Read:|$)/s);
            if (priceActionMatch) {
              content = priceActionMatch[0].trim();
            } else {
              // Fallback: try to find it without strong tags
              const priceActionMatch2 = data.story.match(/[A-Z]+ Price Action:.*?(?=\n\n|Read Next:|Also Read:|$)/s);
              content = priceActionMatch2 ? priceActionMatch2[0].trim() : '';
            }
          }
          // Continue to create component for priceAction
        } else if (type === 'alsoReadLink') {
          // Extract the Also Read link from the story or use the alsoReadLink from response
          if (data.alsoReadLink) {
            content = data.alsoReadLink;
          } else {
            // Try to extract from the story
            const alsoReadMatch = data.story.match(/Also Read:.*?(?=\n\n|Read Next:|Price Action:|$)/s);
            content = alsoReadMatch ? alsoReadMatch[0].trim() : '';
          }
          // Continue to create component for alsoReadLink
        }
      } else {
        // Standard content extraction
        content = data[type] || data.headline || data.lead || data.technicalAnalysis || '';
      }
       
       // Create component for priceAction, alsoReadLink, edgeRatings, and analystRatings
       if (type === 'priceAction' || type === 'alsoReadLink' || type === 'edgeRatings' || type === 'analystRatings') {
         // For these types, the story has already been updated by the API
         // We just need to create a component for display/management purposes
         const newComponent: StoryComponent = {
           id: `${type}-${Date.now()}`,
           type,
           content,
           order: components.length,
           isActive: true
         };
         
         const updatedComponents = [...components, newComponent];
         setComponents(updatedComponents);
         
         // The story has already been updated via onStoryUpdate(data.story) above
         // No need to update it again
         return;
       }
       
       // For standalone components (headline, lead, technical), create separate components
       const newComponent: StoryComponent = {
         id: `${type}-${Date.now()}`,
         type,
         content,
         order: components.length,
         isActive: true
       };
       
       const updatedComponents = [...components, newComponent];
       setComponents(updatedComponents);
       
       // If we have a base story, append the new component to it instead of rebuilding
       if (hasBaseStory) {
         const baseStory = currentArticle;
         const newStory = baseStory + '\n\n' + content;
         onStoryUpdate(newStory);
       } else {
         // Update the story by rebuilding from components (original behavior)
         const newStory = rebuildArticle(updatedComponents);
         onStoryUpdate(newStory);
       }
      
    } catch (err: any) {
      setError(err.message || `Failed to generate ${type}`);
    } finally {
      setLoading(null);
    }
  };

  // Add headline and lead paragraph together
  const addHeadlineAndLead = async () => {
    setLoading('headlineAndLead');
    setError('');
    
    try {
      // Generate headline
      const headlineRes = await fetch('/api/generate/headline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, aiProvider }),
      });
      
      const headlineData = await headlineRes.json();
      if (!headlineRes.ok || !headlineData.headline) throw new Error(headlineData.error || 'Failed to generate headline');
      
      // Generate lead paragraph
      const leadRes = await fetch('/api/generate/lead-paragraph', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, aiProvider }),
      });
      
      const leadData = await leadRes.json();
      if (!leadRes.ok || !leadData.lead) throw new Error(leadData.error || 'Failed to generate lead paragraph');
      
      // Create headline component
      const headlineComponent: StoryComponent = {
        id: `headline-${Date.now()}`,
        type: 'headline',
        content: headlineData.headline,
        order: components.length,
        isActive: true
      };
      
      // Create lead component
      const leadComponent: StoryComponent = {
        id: `lead-${Date.now() + 1}`,
        type: 'lead',
        content: leadData.lead,
        order: components.length + 1,
        isActive: true
      };
      
             const updatedComponents = [...components, headlineComponent, leadComponent];
       setComponents(updatedComponents);
       
       // If we have a base story, prepend the headline and lead to it
       if (hasBaseStory) {
         const baseStory = currentArticle;
         const newStory = headlineData.headline + '\n\n' + leadData.lead + '\n\n' + baseStory;
         onStoryUpdate(newStory);
       } else {
         // Update the story by rebuilding from components (original behavior)
         const newStory = rebuildArticle(updatedComponents);
         onStoryUpdate(newStory);
       }
      
    } catch (err: any) {
      setError(err.message || 'Failed to generate headline and lead paragraph');
    } finally {
      setLoading(null);
    }
  };

  // Handle custom context generation
  const handleCustomContextGeneration = async (selectedArticles: any[]) => {
    setLoadingCustomContext(true);
    setError('');
    
    try {
            const res = await fetch('/api/generate/add-custom-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker,
          existingStory: currentArticle,
          selectedArticles,
          aiProvider
        }),
      });
      
      const data = await res.json();
      if (!res.ok || !data.story) throw new Error(data.error || 'Failed to add custom context');
      
      // The API now returns the complete enhanced story with integrated hyperlinks
      // For custom context, we replace the entire story since hyperlinks are integrated throughout
      onStoryUpdate(data.story);
      
    } catch (err: any) {
      setError(err.message || 'Failed to add custom context');
    } finally {
      setLoadingCustomContext(false);
    }
  };



  // Toggle component visibility
  const toggleComponent = (id: string) => {
    const updatedComponents = components.map(comp => 
      comp.id === id ? { ...comp, isActive: !comp.isActive } : comp
    );
    setComponents(updatedComponents);
    
    // Update the story
    const newStory = rebuildArticle(updatedComponents);
    onStoryUpdate(newStory);
  };

  // Remove component
  const removeComponent = (id: string) => {
    const updatedComponents = components.filter(comp => comp.id !== id);
    setComponents(updatedComponents);
    
    // Update the story
    const newStory = rebuildArticle(updatedComponents);
    onStoryUpdate(newStory);
  };

  // Reorder components
  const moveComponent = (id: string, direction: 'up' | 'down') => {
    const currentIndex = components.findIndex(comp => comp.id === id);
    if (currentIndex === -1) return;
    
    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= components.length) return;
    
    const updatedComponents = [...components];
    [updatedComponents[currentIndex], updatedComponents[newIndex]] = 
    [updatedComponents[newIndex], updatedComponents[currentIndex]];
    
    // Update order numbers
    updatedComponents.forEach((comp, index) => {
      comp.order = index;
    });
    
    setComponents(updatedComponents);
    
    // Update the story
    const newStory = rebuildArticle(updatedComponents);
    onStoryUpdate(newStory);
  };

  const getComponentLabel = (type: StoryComponent['type']) => {
    switch (type) {
      case 'headline': return 'Headline';
      case 'lead': return 'Lead Paragraph';
      case 'technical': return 'Technical Analysis';
      case 'analystRatings': return 'Analyst Ratings';
      case 'edgeRatings': return 'Edge Ratings';
      case 'newsContext': return 'News Context';
      case 'priceAction': return 'Price Action';
      case 'alsoReadLink': return 'Also Read Link';
      default: return type;
    }
  };

  const [copied, setCopied] = useState(false);

  const handleCopyArticle = async () => {
    // Get the content from currentArticle (which includes integrated hyperlinks) or rebuild from components
    const formattedText = currentArticle || rebuildArticle(components);
    
    console.log('Content to copy:', formattedText);
    console.log('Content length:', formattedText.length);
    
    if (!formattedText || formattedText.trim().length === 0) {
      console.log('No content to copy');
      alert('No content to copy. Please add some story components first.');
      return;
    }
    
    // Create a temporary textarea element
    const textArea = document.createElement('textarea');
    textArea.value = formattedText;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    
    // Select and copy the text
    textArea.focus();
    textArea.select();
    
    try {
      const success = document.execCommand('copy');
      if (success) {
        console.log('Article copied successfully');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000); // Reset after 2 seconds
      } else {
        throw new Error('execCommand returned false');
      }
    } catch (err) {
      console.error('Failed to copy article:', err);
      alert('Failed to copy article. Please try again.');
    }
    
    // Clean up
    document.body.removeChild(textArea);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {hasBaseStory && (
        <div style={{ 
          fontSize: '14px', 
          color: '#059669', 
          padding: '12px', 
          backgroundColor: '#f0fdf4', 
          borderRadius: '6px', 
          border: '1px solid #bbf7d0',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <span style={{ fontSize: '16px' }}>✓</span>
          <div>
            <strong>Base Story Detected:</strong> Components like "Add Analyst Ratings", "Add Edge Ratings", and "Add Context" will enhance your existing story rather than replace it.
          </div>
        </div>
      )}
      
      {/* Component Controls */}
      <div style={{ backgroundColor: '#f9fafb', padding: '16px', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
        <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>Add Story Components</h3>
        <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '16px' }}>
          Click any button below to add that component to your story. Components can be reordered, toggled on/off, or removed independently.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px' }}>
          {/* Combined Headline & Lead button */}
          <button
            onClick={addHeadlineAndLead}
            disabled={loading === 'headlineAndLead'}
            style={{
              padding: '8px 12px',
              fontSize: '14px',
              backgroundColor: loading === 'headlineAndLead' ? '#6b7280' : '#059669',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: loading === 'headlineAndLead' ? 'not-allowed' : 'pointer',
              opacity: loading === 'headlineAndLead' ? 0.5 : 1,
              gridColumn: 'span 2'
            }}
          >
            {loading === 'headlineAndLead' ? 'Generating...' : 'Add Headline & Lead'}
          </button>
          
          {/* Individual component buttons */}
          {(['technical', 'analystRatings', 'edgeRatings', 'newsContext', 'priceAction', 'alsoReadLink'] as const).map(type => (
            <button
              key={type}
              onClick={() => addComponent(type)}
              disabled={loading === type}
              style={{
                padding: '8px 12px',
                fontSize: '14px',
                backgroundColor: loading === type ? '#6b7280' : '#2563eb',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: loading === type ? 'not-allowed' : 'pointer',
                opacity: loading === type ? 0.5 : 1
              }}
            >
              {loading === type ? 'Adding...' : `Add ${getComponentLabel(type)}`}
            </button>
          ))}
          
          {/* Custom Context button */}
          <button
            onClick={() => setShowCustomizeModal(true)}
            disabled={loadingCustomContext}
            style={{
              padding: '8px 12px',
              fontSize: '14px',
              backgroundColor: loadingCustomContext ? '#6b7280' : '#7c3aed',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: loadingCustomContext ? 'not-allowed' : 'pointer',
              opacity: loadingCustomContext ? 0.5 : 1
            }}
          >
            {loadingCustomContext ? 'Generating...' : 'Add Custom Context'}
          </button>
        </div>
        {error && <p style={{ color: '#dc2626', fontSize: '14px', marginTop: '8px' }}>{error}</p>}
        

      </div>

      {/* Component List */}
      {components.length > 0 && (
        <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>Story Components</h3>
          <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '16px' }}>
            Manage your story components. Use checkboxes to show/hide components, arrows to reorder, and X to remove.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {components.map((component, index) => (
              <div key={component.id} style={{ 
                border: '1px solid #e5e7eb', 
                borderRadius: '4px', 
                padding: '12px',
                backgroundColor: component.isActive ? '#f9fafb' : '#f3f4f6'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="checkbox"
                      checked={component.isActive}
                      onChange={() => toggleComponent(component.id)}
                      style={{ borderRadius: '4px' }}
                    />
                    <span style={{ 
                      fontWeight: '500',
                      color: component.isActive ? '#111827' : '#6b7280'
                    }}>
                      {getComponentLabel(component.type)}
                    </span>
                    <span style={{ fontSize: '14px', color: '#6b7280' }}>(Order: {component.order + 1})</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <button
                      onClick={() => moveComponent(component.id, 'up')}
                      disabled={index === 0}
                      style={{
                        padding: '4px 8px',
                        fontSize: '12px',
                        backgroundColor: '#e5e7eb',
                        color: '#374151',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: index === 0 ? 'not-allowed' : 'pointer',
                        opacity: index === 0 ? 0.5 : 1
                      }}
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => moveComponent(component.id, 'down')}
                      disabled={index === components.length - 1}
                      style={{
                        padding: '4px 8px',
                        fontSize: '12px',
                        backgroundColor: '#e5e7eb',
                        color: '#374151',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: index === components.length - 1 ? 'not-allowed' : 'pointer',
                        opacity: index === components.length - 1 ? 0.5 : 1
                      }}
                      title="Move down"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => removeComponent(component.id)}
                      style={{
                        padding: '4px 8px',
                        fontSize: '12px',
                        backgroundColor: '#ef4444',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer'
                      }}
                      title="Remove component"
                    >
                      ×
                    </button>
                  </div>
                </div>
                {component.isActive && (
                  <div style={{ 
                    fontSize: '14px', 
                    color: '#374151', 
                    maxHeight: '128px', 
                    overflowY: 'auto', 
                    borderTop: '1px solid #e5e7eb', 
                    paddingTop: '8px' 
                  }}>
                    {component.content.substring(0, 200)}
                    {component.content.length > 200 && '...'}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Preview */}
      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: '600' }}>Story Preview</h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleCopyArticle}
              style={{
                padding: '8px 16px',
                backgroundColor: copied ? '#059669' : '#2563eb',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '14px',
                cursor: 'pointer',
                transition: 'background-color 0.2s'
              }}
            >
              {copied ? 'Copied!' : 'Copy Article'}
            </button>
          </div>
        </div>
        <div
          ref={articleRef}
          data-modular-article="true"
          style={{ maxWidth: 'none' }}
          dangerouslySetInnerHTML={{ 
            __html: (currentArticle || rebuildArticle(components))
              .split('\n\n')
              .filter(p => p.trim())
              .map(p => `<p style="margin-bottom: 16px; line-height: 1.6;">${p}</p>`)
              .join('')
              .replace('[STOCK_CHART_PLACEHOLDER]', 
                ticker ? `
                  <div style="text-align: center; margin: 20px 0;">
                    <p style="font-size: 14px; color: #666; margin-bottom: 10px;">
                      [5-Day Stock Chart for ${ticker} - Chart will be embedded when pasted into WordPress]
                    </p>
                  </div>
                ` : ''
              ) 
          }}
        />
      </div>
      
      {/* Customize Context Modal */}
      <CustomizeContextModal
        isOpen={showCustomizeModal}
        onClose={() => setShowCustomizeModal(false)}
        ticker={ticker}
        onArticlesSelected={handleCustomContextGeneration}
        loading={loadingCustomContext}
      />
    </div>
  );
} 