import { NextResponse } from 'next/server';
import { generateFinalStory } from '@/lib/api';

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const {
      story, // The complete story with hyperlinks already added
    } = body;

    if (!story) {
      return NextResponse.json(
        { error: 'Missing required field: story.' },
        { status: 400 }
      );
    }

    // Simply return the story as-is, preserving all existing hyperlinks
    return NextResponse.json({ result: story });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Unexpected error occurred' },
      { status: 500 }
    );
  }
}
