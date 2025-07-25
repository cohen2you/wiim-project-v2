import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

export async function POST(req: Request) {
  try {
    const { url } = await req.json();
    if (!url) return NextResponse.json({ error: 'URL is required' }, { status: 400 });

    // Fetch the page content
    const res = await fetch(url, {
      headers: {
        // Some sites require a user-agent
        'User-Agent': 'Mozilla/5.0 (compatible; wiim-project/1.0)'
      }
    });
    if (!res.ok) {
      throw new Error('Failed to fetch the page. The site may block scraping.');
    }
    const html = await res.text();
    const $ = cheerio.load(html);

    // Try to extract the main article text
    let text = $('article').text() || $('main').text() || $('body').text();
    text = text.replace(/\s+/g, ' ').trim();

    if (!text || text.length < 100) {
      throw new Error('Could not extract meaningful text. The site may block scraping or use a non-standard structure.');
    }

    return NextResponse.json({ text });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to scrape page. Please cut and paste the article text manually.' }, { status: 500 });
  }
} 