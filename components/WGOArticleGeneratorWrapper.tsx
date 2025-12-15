'use client';

import TechnicalAnalysisGenerator from './TechnicalAnalysisGenerator';

export default function WGOArticleGeneratorWrapper() {
  return (
    <div style={{ 
      maxWidth: '768px', 
      margin: '40px auto', 
      padding: '0 48px',
      boxSizing: 'border-box'
    }}>
      <TechnicalAnalysisGenerator />
    </div>
  );
}

