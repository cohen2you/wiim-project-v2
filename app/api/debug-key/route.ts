import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ key: process.env.OPENAI_API_KEY || 'missing' });
}
