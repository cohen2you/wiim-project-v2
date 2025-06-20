// app/page.tsx
'use client';

import { useState } from 'react';
import PrimarySourceForm from '@/components/PrimarySourceForm';
import SecondarySourceForm from '@/components/SecondarySourceForm';
import FinalStoryForm from '@/components/FinalStoryForm';

export default function Home() {
  const [primaryOutput, setPrimaryOutput] = useState('');
  const [secondaryOutput, setSecondaryOutput] = useState('');

  // Debug logs to confirm values passed to FinalStoryForm
  console.log('Primary Output:', primaryOutput);
  console.log('Secondary Output:', secondaryOutput);

  return (
    <div className="max-w-4xl mx-auto py-12 px-6">
      <main className="p-6 space-y-10 max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-4">Why It's Moving — Story Builder</h1>

        <section>
          <h2 className="text-xl font-semibold mb-2">Step 1: Primary Article</h2>
          <PrimarySourceForm onComplete={setPrimaryOutput} />
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2">Step 2: Secondary Source</h2>
          <SecondarySourceForm
            initialPrimaryText={primaryOutput}
            onComplete={setSecondaryOutput}
          />
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2">Step 3: Final Assembly</h2>
          <FinalStoryForm
            leadAndWhatHappened={primaryOutput}
            whyItMatters={secondaryOutput}
          />
        </section>
      </main>
    </div>
  );
}
