// components/FinalStoryForm.tsx
'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';

function Button({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} className="bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700">
      {children}
    </button>
  );
}

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className="border p-2 rounded w-full" />;
}

function Loader() {
  return <span className="animate-spin h-5 w-5 border-2 border-t-transparent border-white rounded-full inline-block"></span>;
}

interface FinalStoryFormProps {
  leadAndWhatHappened: string;
  whyItMatters: string;
}

export default function FinalStoryForm({ leadAndWhatHappened, whyItMatters }: FinalStoryFormProps) {
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);

  const { register, handleSubmit, reset } = useForm({
    defaultValues: {
      leadAndWhatHappened: '',
      whyItMatters: '',
    },
  });

  useEffect(() => {
    console.log('Resetting form with:', { leadAndWhatHappened, whyItMatters });
    reset({
      leadAndWhatHappened: leadAndWhatHappened || '',
      whyItMatters: whyItMatters || '',
    });
  }, [leadAndWhatHappened, whyItMatters, reset]);

  const onSubmit = async (data: any) => {
    console.log('Final form submitted with data:', data);
    if (!data.leadAndWhatHappened?.trim()) {
      setOutput('Please provide the Lead & What Happened section before submitting.');
      return;
    }

    setLoading(true);
    setOutput('');

    try {
      const response = await fetch('/api/generate/final', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const result = await response.json();
      console.log('API response:', result);
      setOutput(result.output || 'No output returned.');
    } catch (error) {
      console.error('Error generating final story:', error);
      setOutput('Error generating final story.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8 p-6 bg-white rounded-lg shadow-md max-w-3xl mx-auto">
      <div className="space-y-2">
        <label className="block font-semibold text-gray-700">Lead & What Happened</label>
        <Textarea {...register('leadAndWhatHappened')} rows={9} className="w-full border p-2 rounded" />
      </div>

      <div className="space-y-2">
        <label className="block font-semibold text-gray-700">Why It Matters</label>
        <Textarea {...register('whyItMatters')} rows={6} className="w-full border p-2 rounded" />
      </div>

      <div className="pt-4">
        <Button type="submit" disabled={loading} className="w-full">
          {loading ? <Loader /> : 'Generate Final Story'}
        </Button>
      </div>

      {output && (
        <div className="mt-12 p-6 bg-white border border-gray-300 rounded shadow text-gray-900 text-base leading-6 whitespace-pre-line">
          {output}
        </div>
      )}
    </form>
  );
}
