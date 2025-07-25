"use client";
import { useEffect, useState } from 'react';

export default function LocalDate({ dateString }: { dateString: string }) {
  const [local, setLocal] = useState('');
  useEffect(() => {
    setLocal(new Date(dateString).toLocaleString());
  }, [dateString]);
  return <span style={{ fontSize: 12, color: '#666' }}>{local}</span>;
} 