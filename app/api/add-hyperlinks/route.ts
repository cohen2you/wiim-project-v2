import { NextResponse } from 'next/server';

// Optional mapping for nicer outlet names
const outletNameMap: Record<string, string> = {
  cnbc: 'CNBC',
  reuters: 'Reuters',
  bloomberg: 'Bloomberg',
  benzinga: 'Benzinga',
  // Add more mappings as needed
};

function getOutletNameFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    const domain = hostname.replace(/^www\./, '');
    const parts = domain.split('.');
    if (parts.length >= 2) {
      const name = parts[0].toLowerCase();
      return outletNameMap[name] || name.charAt(0).toUpperCase() + name.slice(1);
    }
    return domain;
  } catch {
    return 'Primary Source';
  }
}

// Insert link on first unlinked "reported"
function insertLinkOnReported(text: string, outletName: string, url: string) {
  const linkedReported = `[reported](${url})`;
  const linkedReportedRegex = /\[reported\]\([^)]+\)/i;

  if (linkedReportedRegex.test(text)) {
    return text;
  }

  const regex = new RegExp(`\\b${outletName}\\s+reported\\b`, 'i');
  if (regex.test(text)) {
    return text.replace(regex, `${outletName} ${linkedReported}`);
  }
  // fallback: just replace the first "reported"
  const reportedRegex = /\breported\b/i;
  if (reportedRegex.test(text)) {
    return text.replace(reportedRegex, linkedReported);
  }

  // If "reported" not found, prepend attribution (optional)
  return `${outletName} ${linkedReported}:\n\n${text}`;
}

// Insert hyperlink for any 3 consecutive words in second half of text (not overlapping existing links)
function insertSecondaryLink(text: string, url: string) {
  if (!url) return text;

  // Avoid double linking
  if (text.includes(`[${url}]`)) return text;

  const words = text.split(/\s+/);
  const halfIndex = Math.floor(words.length / 2);

  // Search for 3 consecutive words in the second half that are not already linked and do not contain markdown
  for (let i = halfIndex; i < words.length - 2; i++) {
    const phrase = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;

    // Skip if phrase contains markdown link or special chars that might break markdown
    if (phrase.match(/\[|\]|\(|\)/)) continue;

    // Regex to find the phrase as whole words, case insensitive
    const phraseRegex = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');

    if (phraseRegex.test(text)) {
      // Replace only first occurrence with markdown link
      return text.replace(phraseRegex, `[${phrase}](${url})`);
    }
  }
  // If no suitable phrase found, return original text
  return text;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const { text, primaryUrl, secondaryUrl, primaryOutlet } = body;

    if (!text) {
      return NextResponse.json({ error: 'Missing text field' }, { status: 400 });
    }

    const primaryName = primaryOutlet || getOutletNameFromUrl(primaryUrl || '');

    let linkedText = text;

    // Add hyperlink for primary outlet on "reported"
    if (primaryUrl) {
      linkedText = insertLinkOnReported(linkedText, primaryName, primaryUrl);
    }

    // Add hyperlink to any 3-word phrase in the second half linking to secondary URL
    if (secondaryUrl) {
      linkedText = insertSecondaryLink(linkedText, secondaryUrl);
    }

    return NextResponse.json({ result: linkedText });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unexpected error occurred' }, { status: 500 });
  }
}
