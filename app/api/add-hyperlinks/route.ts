import { NextResponse } from 'next/server';
import { 
  getOutletNameFromUrl, 
  insertLinkOnReported, 
  insertLeadHyperlink, 
  insertMiddleHyperlink, 
  fixAlsoReadPlacement 
} from '../../../lib/hyperlink-preservation';

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const { text, primaryUrl, secondaryUrl, primaryOutlet, alsoReadUrl, alsoReadHeadline } = body;

    if (!text) {
      return NextResponse.json({ error: 'Missing text field' }, { status: 400 });
    }

    const primaryName = primaryOutlet || getOutletNameFromUrl(primaryUrl || '');

    let linkedText = text;

    // Add hyperlink in the lead paragraph using primary URL
    if (primaryUrl) {
      linkedText = insertLeadHyperlink(linkedText, primaryUrl);
    }

    // Add hyperlink in the middle section using secondary URL
    if (secondaryUrl) {
      linkedText = insertMiddleHyperlink(linkedText, secondaryUrl);
    }

    // Fix "Also Read" section placement if provided
    if (alsoReadUrl && alsoReadHeadline) {
      linkedText = fixAlsoReadPlacement(linkedText, alsoReadUrl, alsoReadHeadline);
    }

    return NextResponse.json({ result: linkedText });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unexpected error occurred' }, { status: 500 });
  }
}

