'use client';

import React, { useState, useRef, useEffect } from 'react';
import CustomizeContextModal from './CustomizeContextModal';
import XPostsModal from './XPostsModal';

interface StoryComponent {
  id: string;
  type: 'headline' | 'lead' | 'technical' | 'analystRatings' | 'edgeRatings' | 'newsContext' | 'priceAction' | 'alsoReadLink' | 'xPosts';
  content: string;
  order: number;
  isActive: boolean;
}

interface ModularStoryBuilderProps {
  ticker: string;
  currentArticle: string;
  onStoryUpdate: (story: string) => void;
}

export default function ModularStoryBuilder({ ticker, currentArticle, onStoryUpdate }: ModularStoryBuilderProps) {
  const [components, setComponents] = useState<StoryComponent[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string>('');
  const [showCustomizeModal, setShowCustomizeModal] = useState(false);
  const [showXPostsModal, setShowXPostsModal] = useState(false);
  const [loadingCustomContext, setLoadingCustomContext] = useState(false);
  const [loadingXPosts, setLoadingXPosts] = useState(false);
  const [loadingFinalize, setLoadingFinalize] = useState(false);
  const [originalStory, setOriginalStory] = useState<string>('');
  const [isFinalized, setIsFinalized] = useState(false);
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
          break;
        case 'edgeRatings':
          endpoint = '/api/generate/add-edge-ratings';
          requestBody.existingStory = currentArticle;
          break;
        case 'newsContext':
          endpoint = '/api/generate/add-context';
          requestBody.existingStory = currentArticle;
          break;
        case 'priceAction':
          endpoint = '/api/generate/add-price-action';
          requestBody.existingStory = currentArticle;
          break;
        case 'alsoReadLink':
          endpoint = '/api/generate/add-also-read';
          requestBody.existingStory = currentArticle;
          break;
        case 'xPosts':
          setShowXPostsModal(true);
          setLoading(null);
          return;
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const data = await res.json();
      if (!res.ok || !data.story) throw new Error(data.error || `Failed to generate ${type}`);

      // For components that directly update the story (when we have a base story)
      if (hasBaseStory && ['analystRatings', 'edgeRatings', 'newsContext', 'priceAction', 'alsoReadLink'].includes(type)) {
        onStoryUpdate(data.story);
      } else {
        // For standalone components, add to the list
        const newComponent: StoryComponent = {
          id: Date.now().toString(),
          type,
          content: data.story,
          order: components.length,
          isActive: true,
        };
        
        setComponents(prev => [...prev, newComponent]);
        
        // Rebuild the article with the new component
        const updatedComponents = [...components, newComponent];
        const rebuiltArticle = rebuildArticle(updatedComponents);
        onStoryUpdate(rebuiltArticle);
      }
      
    } catch (err: any) {
      setError(err.message || `Failed to generate ${type}`);
    } finally {
      setLoading(null);
    }
  };

  // Handle X Posts selection
  const handleXPostsGeneration = async (selectedPosts: any[]) => {
    if (!currentArticle) {
      setError('No existing story to add X posts to');
      return;
    }
    
    setLoadingXPosts(true);
    setError('');
    
    try {
      const res = await fetch('/api/generate/add-x-posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          ticker, 
          existingStory: currentArticle,
          selectedPosts 
        }),
      });
      
      const data = await res.json();
      if (!res.ok || !data.story) throw new Error(data.error || 'Failed to add X posts to story');
      
      onStoryUpdate(data.story);
    } catch (err: any) {
      setError(err.message || 'Failed to add X posts to story');
    } finally {
      setLoadingXPosts(false);
    }
  };

  // Add headline and lead to existing article
  const addHeadlineAndLead = async () => {
    setLoading('headlineAndLead');
    setError('');
    
    try {
      const [headlineRes, leadRes] = await Promise.all([
        fetch('/api/generate/headline', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker }),
        }),
        fetch('/api/generate/lead-paragraph', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker }),
        }),
      ]);

      const [headlineData, leadData] = await Promise.all([
        headlineRes.json(),
        leadRes.json(),
      ]);

      if (!headlineRes.ok || !leadRes.ok) {
        throw new Error('Failed to generate headline or lead');
      }

      const combinedContent = `${headlineData.story}\n\n${leadData.story}\n\n${currentArticle}`;
      onStoryUpdate(combinedContent);
      
    } catch (err: any) {
      setError(err.message || 'Failed to generate headline and lead');
    } finally {
      setLoading(null);
    }
  };

  // Finalize the story
  const handleFinalize = async () => {
    if (!currentArticle) {
      setError('No story to finalize');
      return;
    }
    
    setLoadingFinalize(true);
    setError('');
    setOriginalStory(currentArticle);
    
    try {
      const res = await fetch('/api/generate/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          ticker, 
          existingStory: currentArticle
        }),
      });
      
      const data = await res.json();
      if (!res.ok || !data.story) throw new Error(data.error || 'Failed to finalize story');
      
      onStoryUpdate(data.story);
      setIsFinalized(true);
    } catch (err: any) {
      setError(err.message || 'Failed to finalize story');
    } finally {
      setLoadingFinalize(false);
    }
  };

  // Undo finalize
  const handleUndoFinalize = () => {
    if (originalStory) {
      onStoryUpdate(originalStory);
      setIsFinalized(false);
    }
  };

  // Toggle component visibility
  const toggleComponent = (id: string) => {
    setComponents(prev => prev.map(comp => 
      comp.id === id ? { ...comp, isActive: !comp.isActive } : comp
    ));
  };

  // Remove component
  const removeComponent = (id: string) => {
    setComponents(prev => prev.filter(comp => comp.id !== id));
  };

  const componentTypeToLabel: Record<StoryComponent['type'], string> = {
    headline: 'Headline',
    lead: 'Lead Paragraph',
    technical: 'Technical Analysis',
    analystRatings: 'Analyst Ratings',
    edgeRatings: 'Edge Ratings',
    newsContext: 'News Context',
    priceAction: 'Price Action',
    alsoReadLink: 'Also Read Link',
    xPosts: 'X Posts',
  };

  return (
    <div style={{ backgroundColor: '#f8fafc', padding: '20px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
      <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', color: '#1e293b' }}>
        Modular Story Builder
      </h3>
      
      {/* Component Buttons */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '20px' }}>
        <button
          onClick={addHeadlineAndLead}
          disabled={loading === 'headlineAndLead'}
          style={{ 
            padding: '8px 16px', 
            backgroundColor: loading === 'headlineAndLead' ? '#6b7280' : '#059669', 
            color: 'white', 
            border: 'none', 
            borderRadius: '4px',
            fontSize: '14px',
            cursor: loading === 'headlineAndLead' ? 'not-allowed' : 'pointer'
          }}
        >
          {loading === 'headlineAndLead' ? 'Generating...' : 'Add Headline & Lead'}
        </button>
        
        <button
          onClick={() => addComponent('technical')}
          disabled={loading === 'technical'}
          style={{ 
            padding: '8px 16px', 
            backgroundColor: loading === 'technical' ? '#6b7280' : '#2563eb', 
            color: 'white', 
            border: 'none', 
            borderRadius: '4px',
            fontSize: '14px',
            cursor: loading === 'technical' ? 'not-allowed' : 'pointer'
          }}
        >
          {loading === 'technical' ? 'Generating...' : 'Add Technical Analysis'}
        </button>
        
        <button
          onClick={() => addComponent('analystRatings')}
          disabled={loading === 'analystRatings'}
          style={{ 
            padding: '8px 16px', 
            backgroundColor: loading === 'analystRatings' ? '#6b7280' : '#7c3aed', 
            color: 'white', 
            border: 'none', 
            borderRadius: '4px',
            fontSize: '14px',
            cursor: loading === 'analystRatings' ? 'not-allowed' : 'pointer'
          }}
        >
          {loading === 'analystRatings' ? 'Generating...' : 'Add Analyst Ratings'}
        </button>
        
        <button
          onClick={() => addComponent('edgeRatings')}
          disabled={loading === 'edgeRatings'}
          style={{ 
            padding: '8px 16px', 
            backgroundColor: loading === 'edgeRatings' ? '#6b7280' : '#dc2626', 
            color: 'white', 
            border: 'none', 
            borderRadius: '4px',
            fontSize: '14px',
            cursor: loading === 'edgeRatings' ? 'not-allowed' : 'pointer'
          }}
        >
          {loading === 'edgeRatings' ? 'Generating...' : 'Add Edge Ratings'}
        </button>
        
        <button
          onClick={() => addComponent('newsContext')}
          disabled={loading === 'newsContext'}
          style={{ 
            padding: '8px 16px', 
            backgroundColor: loading === 'newsContext' ? '#6b7280' : '#059669', 
            color: 'white', 
            border: 'none', 
            borderRadius: '4px',
            fontSize: '14px',
            cursor: loading === 'newsContext' ? 'not-allowed' : 'pointer'
          }}
        >
          {loading === 'newsContext' ? 'Generating...' : 'Add Context'}
        </button>
        
        <button
          onClick={() => addComponent('priceAction')}
          disabled={loading === 'priceAction'}
          style={{ 
            padding: '8px 16px', 
            backgroundColor: loading === 'priceAction' ? '#6b7280' : '#f59e0b', 
            color: 'white', 
            border: 'none', 
            borderRadius: '4px',
            fontSize: '14px',
            cursor: loading === 'priceAction' ? 'not-allowed' : 'pointer'
          }}
        >
          {loading === 'priceAction' ? 'Generating...' : 'Add Price Action'}
        </button>
        
        <button
          onClick={() => addComponent('alsoReadLink')}
          disabled={loading === 'alsoReadLink'}
          style={{ 
            padding: '8px 16px', 
            backgroundColor: loading === 'alsoReadLink' ? '#6b7280' : '#10b981', 
            color: 'white', 
            border: 'none', 
            borderRadius: '4px',
            fontSize: '14px',
            cursor: loading === 'alsoReadLink' ? 'not-allowed' : 'pointer'
          }}
        >
          {loading === 'alsoReadLink' ? 'Generating...' : 'Add Also Read'}
        </button>
        
        <button
          onClick={() => addComponent('xPosts')}
          disabled={loading === 'xPosts'}
          style={{ 
            padding: '8px 16px', 
            backgroundColor: loading === 'xPosts' ? '#6b7280' : '#1da1f2', 
            color: 'white', 
            border: 'none', 
            borderRadius: '4px',
            fontSize: '14px',
            cursor: loading === 'xPosts' ? 'not-allowed' : 'pointer'
          }}
        >
          {loading === 'xPosts' ? 'Generating...' : 'Add X Posts'}
        </button>
        
        <button
          onClick={() => setShowCustomizeModal(true)}
          style={{ 
            padding: '8px 16px', 
            backgroundColor: '#8b5cf6', 
            color: 'white', 
            border: 'none', 
            borderRadius: '4px',
            fontSize: '14px',
            cursor: 'pointer'
          }}
        >
          Customize Context
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div style={{ 
          padding: '12px', 
          backgroundColor: '#fef2f2', 
          border: '1px solid #fecaca', 
          borderRadius: '4px', 
          color: '#dc2626', 
          marginBottom: '16px' 
        }}>
          {error}
        </div>
      )}

      {/* Finalize and Copy Buttons */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <button
          onClick={handleFinalize}
          disabled={loadingFinalize || !currentArticle}
          style={{ 
            padding: '10px 20px', 
            backgroundColor: loadingFinalize || !currentArticle ? '#6b7280' : '#059669', 
            color: 'white', 
            border: 'none', 
            borderRadius: '4px',
            fontSize: '14px',
            fontWeight: '500',
            cursor: loadingFinalize || !currentArticle ? 'not-allowed' : 'pointer'
          }}
        >
          {loadingFinalize ? 'Finalizing...' : 'Finalize'}
        </button>
        
        {isFinalized && (
          <button
            onClick={handleUndoFinalize}
            style={{ 
              padding: '10px 20px', 
              backgroundColor: '#f59e0b', 
              color: 'white', 
              border: 'none', 
              borderRadius: '4px',
              fontSize: '14px',
              fontWeight: '500',
              cursor: 'pointer'
            }}
          >
            Undo Finalize
          </button>
        )}
        
        <button
          onClick={() => {
            navigator.clipboard.writeText(currentArticle);
          }}
          style={{ 
            padding: '10px 20px', 
            backgroundColor: '#2563eb', 
            color: 'white', 
            border: 'none', 
            borderRadius: '4px',
            fontSize: '14px',
            fontWeight: '500',
            cursor: 'pointer'
          }}
        >
          Copy Article
        </button>
      </div>

      {/* Current Article Display */}
      {currentArticle && (
        <div style={{ marginBottom: '16px' }}>
          <h4 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '8px', color: '#374151' }}>
            Current Article ({currentArticle.length} characters)
          </h4>
          <div
            ref={articleRef}
            style={{ 
              maxHeight: '400px', 
              overflowY: 'auto', 
              border: '1px solid #e5e7eb', 
              borderRadius: '4px', 
              padding: '12px',
              backgroundColor: 'white',
              fontSize: '14px',
              lineHeight: '1.6'
            }}
            dangerouslySetInnerHTML={{ 
              __html: currentArticle
                .split('\n\n')
                .filter(p => p.trim())
                .map(p => `<p style="margin-bottom: 16px;">${p}</p>`)
                .join('')
            }}
          />
        </div>
      )}

      {/* Component List */}
      {components.length > 0 && (
        <div>
          <h4 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '8px', color: '#374151' }}>
            Generated Components
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {components.map(component => (
              <div
                key={component.id}
                style={{
                  padding: '12px',
                  backgroundColor: component.isActive ? '#f0fdf4' : '#f3f4f6',
                  border: '1px solid #d1d5db',
                  borderRadius: '4px',
                  fontSize: '14px'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontWeight: '500', color: '#374151' }}>
                    {componentTypeToLabel[component.type]}
                  </span>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                      onClick={() => toggleComponent(component.id)}
                      style={{
                        padding: '4px 8px',
                        backgroundColor: component.isActive ? '#059669' : '#6b7280',
                        color: 'white',
                        border: 'none',
                        borderRadius: '2px',
                        fontSize: '12px',
                        cursor: 'pointer'
                      }}
                    >
                      {component.isActive ? 'Active' : 'Inactive'}
                    </button>
                    <button
                      onClick={() => removeComponent(component.id)}
                      style={{
                        padding: '4px 8px',
                        backgroundColor: '#dc2626',
                        color: 'white',
                        border: 'none',
                        borderRadius: '2px',
                        fontSize: '12px',
                        cursor: 'pointer'
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <div style={{ 
                  maxHeight: '100px', 
                  overflowY: 'auto', 
                  fontSize: '12px', 
                  color: '#6b7280',
                  lineHeight: '1.4'
                }}>
                  {component.content.substring(0, 200)}...
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Customize Context Modal */}
      <CustomizeContextModal
        isOpen={showCustomizeModal}
        onClose={() => setShowCustomizeModal(false)}
        ticker={ticker}
        onArticlesSelected={async (selectedArticles) => {
          setLoadingCustomContext(true);
          setError('');
          
          try {
            const res = await fetch('/api/generate/add-custom-context', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                ticker, 
                existingStory: currentArticle,
                selectedArticles 
              }),
            });
            
            const data = await res.json();
            if (!res.ok || !data.story) throw new Error(data.error || 'Failed to add custom context');
            
            onStoryUpdate(data.story);
            setShowCustomizeModal(false);
          } catch (err: any) {
            setError(err.message || 'Failed to add custom context');
          } finally {
            setLoadingCustomContext(false);
          }
        }}
        loading={loadingCustomContext}
      />

      {/* X Posts Modal */}
      <XPostsModal
        isOpen={showXPostsModal}
        onClose={() => setShowXPostsModal(false)}
        ticker={ticker}
        onPostsSelected={handleXPostsGeneration}
        loading={loadingXPosts}
      />
    </div>
  );
} 