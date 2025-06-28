// app/api/envtest/route.ts

import { NextResponse } from 'next/server';

export async function GET() {
  const key = process.env.OPENAI_API_KEY ?? 'missing';
  console.log('OPENAI_API_KEY in envtest route:', key);
  return NextResponse.json({ OPENAI_API_KEY: key });
}
