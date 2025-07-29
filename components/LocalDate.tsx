"use client";
import { useEffect, useState } from 'react';

export default function LocalDate({ dateString }: { dateString: string }) {
  const [mounted, setMounted] = useState(false);
  const [local, setLocal] = useState('');

  useEffect(() => {
    setMounted(true);
    setLocal(new Date(dateString).toLocaleString());
  }, [dateString]);

  // Show a fallback on server-side to prevent hydration mismatch
  if (!mounted) {
    return <span style={{ fontSize: 12, color: '#666' }}>{new Date(dateString).toISOString()}</span>;
  }

  return <span style={{ fontSize: 12, color: '#666' }}>{local}</span>;
} 