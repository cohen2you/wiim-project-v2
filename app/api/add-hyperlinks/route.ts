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

// Insert HTML link on first unlinked "reported"
function insertLinkOnReported(text: string, outletName: string, url: string) {
  const linkedReported = `<a href="${url}">reported</a>`;
  const linkedReportedRegex = /<a href="[^"]+">reported<\/a>/i;

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

// Insert hyperlink for any 3 consecutive words in the lead paragraph
function insertLeadHyperlink(text: string, url: string) {
  if (!url) return text;

  // Avoid double linking
  if (text.includes(`href="${url}"`)) return text;

  // Find the first paragraph (before the first line break or "What To Know:")
  const lines = text.split('\n');
  let leadEndIndex = lines.length;
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('What To Know:') || lines[i].includes('What Happened:') || lines[i].includes('Why It Matters:')) {
      leadEndIndex = i;
      break;
    }
  }
  
  const leadSection = lines.slice(0, leadEndIndex).join('\n');
  const restOfText = lines.slice(leadEndIndex).join('\n');
  
  // Find a suitable 3-word phrase in the lead section
  const words = leadSection.split(/\s+/);
  
  for (let i = 0; i < words.length - 2; i++) {
    const phrase = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
    
    // Skip if phrase contains HTML tags or special chars
    if (phrase.match(/<|>|&/)) continue;
    
    // Skip if it's already a link
    if (leadSection.includes(`<a href`)) continue;
    
    // Regex to find the phrase as whole words, case insensitive
    const phraseRegex = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    
    if (phraseRegex.test(leadSection)) {
      // Replace the phrase with a hyperlink
      const linkedLead = leadSection.replace(phraseRegex, `<a href="${url}">${phrase}</a>`);
      return linkedLead + (restOfText ? '\n' + restOfText : '');
    }
  }
  
  return text;
}

// Insert hyperlink for any 3 consecutive words in middle paragraphs (not overlapping existing links)
function insertMiddleHyperlink(text: string, url: string) {
  if (!url) return text;

  // Avoid double linking
  if (text.includes(`href="${url}"`)) return text;

  // Split text into paragraphs to find middle section
  const lines = text.split('\n');
  let whatToKnowIndex = -1;
  let priceActionIndex = -1;
  
  // Find section boundaries
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('What To Know:') || lines[i].includes('What Happened:')) {
      whatToKnowIndex = i;
    }
    if (lines[i].includes('Price Action:') || lines[i].includes('<strong>') && lines[i].includes('Price Action:')) {
      priceActionIndex = i;
      break;
    }
  }
  
  // If we can't find sections, use the middle third of the text
  if (whatToKnowIndex === -1 || priceActionIndex === -1) {
    const words = text.split(/\s+/);
    const startIndex = Math.floor(words.length / 3);
    const endIndex = Math.floor(words.length * 2 / 3);
    
    for (let i = startIndex; i < endIndex - 2; i++) {
      const phrase = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
      
      if (phrase.match(/<|>|&/)) continue;
      
      const phraseRegex = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      
      if (phraseRegex.test(text)) {
        return text.replace(phraseRegex, `<a href="${url}">${phrase}</a>`);
      }
    }
    return text;
  }
  
  // Use the middle section between What To Know and Price Action
  const middleSection = lines.slice(whatToKnowIndex + 1, priceActionIndex).join('\n');
  const beforeSection = lines.slice(0, whatToKnowIndex + 1).join('\n');
  const afterSection = lines.slice(priceActionIndex).join('\n');
  
  const words = middleSection.split(/\s+/);
  
  for (let i = 0; i < words.length - 2; i++) {
    const phrase = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
    
    if (phrase.match(/<|>|&/)) continue;
    if (middleSection.includes(`<a href`)) continue;
    
    const phraseRegex = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    
    if (phraseRegex.test(middleSection)) {
      const linkedMiddle = middleSection.replace(phraseRegex, `<a href="${url}">${phrase}</a>`);
      return beforeSection + '\n' + linkedMiddle + '\n' + afterSection;
    }
  }
  
  return text;
}

// Ensure "Also Read" section is placed correctly after "What To Know"
function fixAlsoReadPlacement(text: string, alsoReadUrl: string, alsoReadHeadline: string) {
  if (!alsoReadUrl || !alsoReadHeadline) return text;
  
  const lines = text.split('\n');
  let whatToKnowIndex = -1;
  let alsoReadIndex = -1;
  
  // Find "What To Know" and existing "Also Read" sections
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('What To Know:')) {
      whatToKnowIndex = i;
    }
    if (lines[i].includes('Also Read:')) {
      alsoReadIndex = i;
    }
  }
  
  // If "What To Know" exists but "Also Read" is not immediately after it
  if (whatToKnowIndex !== -1) {
    const alsoReadSection = `Also Read: <a href="${alsoReadUrl}">${alsoReadHeadline}</a>`;
    
    // Remove existing "Also Read" if it's in the wrong place
    if (alsoReadIndex !== -1 && alsoReadIndex !== whatToKnowIndex + 1) {
      lines.splice(alsoReadIndex, 1);
    }
    
    // Insert "Also Read" immediately after "What To Know"
    if (alsoReadIndex === -1 || alsoReadIndex !== whatToKnowIndex + 1) {
      lines.splice(whatToKnowIndex + 1, 0, alsoReadSection);
    }
  }
  
  return lines.join('\n');
}

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

