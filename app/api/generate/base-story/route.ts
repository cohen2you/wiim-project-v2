import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

<<<<<<< HEAD
// Helper function to fetch company name from Benzinga API
async function fetchCompanyName(ticker: string): Promise<string> {
  try {
    const response = await fetch(`https://api.benzinga.com/api/v2/quoteDelayed?token=${process.env.BENZINGA_API_KEY}&symbols=${encodeURIComponent(ticker)}`);
    
    if (!response.ok) {
      console.error('Failed to fetch company name from Benzinga API');
      return ticker.toUpperCase();
    }
    
    const data = await response.json();
    
    if (data && typeof data === 'object') {
      const quote = data[ticker.toUpperCase()];
      if (quote && typeof quote === 'object') {
        return quote.companyStandardName || quote.name || ticker.toUpperCase();
      }
    }
    
    return ticker.toUpperCase();
  } catch (error) {
    console.error('Error fetching company name:', error);
    return ticker.toUpperCase();
  }
}

export async function POST(req: Request) {
  try {
    const { ticker, scrapedContent, scrapedUrl, contextContent, contextUrl } = await req.json();

    // Extract publication date from article content
    let prDate = '';
    let publicationDate = null;
    
    // Look for publication date patterns in the content
    const publicationDatePatterns = [
      /(\w+)\s+(\d{1,2}),?\s+(\d{4})\s+\d{1,2}:\d{2}\s+[AP]M/i, // "August 19, 2025 7:56 AM"
      /(\w+)\s+(\d{1,2}),?\s+(\d{4})/i, // "August 19, 2025"
      /(\d{1,2})\/(\d{1,2})\/(\d{4})/i, // "8/19/2025"
      /(\d{1,2})-(\d{1,2})-(\d{4})/i, // "8-19-2025"
    ];
    
    for (const pattern of publicationDatePatterns) {
      const match = scrapedContent.match(pattern);
      if (match) {
        const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 
                           'july', 'august', 'september', 'october', 'november', 'december'];
        
        let month, day, year;
        if (match[1].length <= 2) {
          // Numeric format: 8/19/2025 or 8-19-2025
          [, month, day, year] = match;
          month = parseInt(month) - 1; // Convert to 0-based index
        } else {
          // Text format: August 19, 2025
          const monthName = match[1].toLowerCase();
          month = monthNames.indexOf(monthName);
          day = parseInt(match[2]);
          year = parseInt(match[3]);
        }
        
        if (month !== -1 && day && year) {
          publicationDate = new Date(year, month, day);
          
          // Format in AP style: Aug. 19 (no year if current year)
          const monthNames = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'];
          const monthAbbr = monthNames[month];
          const currentYear = new Date().getFullYear();
          
          if (year === currentYear) {
            prDate = `${monthAbbr} ${day}`;
          } else {
            prDate = `${monthAbbr} ${day}, ${year}`;
          }
          
          console.log('Extracted publication date:', prDate, 'from content');
          break;
        }
      }
    }

    // Extract publication date from context content if available
    let contextDate = '';
    let contextPublicationDate = null;
    
    if (contextContent) {
      // Look for publication date patterns in the context content
      const publicationDatePatterns = [
        /(\w+)\s+(\d{1,2}),?\s+(\d{4})\s+\d{1,2}:\d{2}\s+[AP]M/i, // "August 19, 2025 7:56 AM"
        /(\w+)\s+(\d{1,2}),?\s+(\d{4})/i, // "August 19, 2025"
        /(\d{1,2})\/(\d{1,2})\/(\d{4})/i, // "8/19/2025"
        /(\d{1,2})-(\d{1,2})-(\d{4})/i, // "8-19-2025"
      ];
      
      for (const pattern of publicationDatePatterns) {
        const match = contextContent.match(pattern);
        if (match) {
          const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 
                             'july', 'august', 'september', 'october', 'november', 'december'];
          
          let month, day, year;
          if (match[1].length <= 2) {
            // Numeric format: 8/19/2025 or 8-19-2025
            [, month, day, year] = match;
            month = parseInt(month) - 1; // Convert to 0-based index
          } else {
            // Text format: August 19, 2025
            const monthName = match[1].toLowerCase();
            month = monthNames.indexOf(monthName);
            day = parseInt(match[2]);
            year = parseInt(match[3]);
          }
          
          if (month !== -1 && day && year) {
            contextPublicationDate = new Date(year, month, day);
            
            // Format in AP style: Aug. 19 (no year if current year)
            const monthNames = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'];
            const monthAbbr = monthNames[month];
            const currentYear = new Date().getFullYear();
            
            if (year === currentYear) {
              contextDate = `${monthAbbr} ${day}`;
            } else {
              contextDate = `${monthAbbr} ${day}, ${year}`;
            }
            
            console.log('Extracted context publication date:', contextDate, 'from content');
            break;
          }
        }
      }
    }
=======
export async function POST(req: Request) {
  try {
    const { ticker, scrapedContent, scrapedUrl } = await req.json();
>>>>>>> 8e3f4bf

    if (!ticker || !scrapedContent) {
      return NextResponse.json({ error: 'Ticker and scraped content are required' }, { status: 400 });
    }

<<<<<<< HEAD
    // Get company name from Benzinga API
    const companyName = await fetchCompanyName(ticker);
    const companyNameFormatted = `<strong>${companyName}</strong> (NASDAQ: ${ticker.toUpperCase()})`;
=======
    // Get company name and exchange info
    const companyNames: { [key: string]: string } = {
      'NVDA': 'Nvidia Corp.',
      'META': 'Meta Platforms Inc.',
      'AAPL': 'Apple Inc.',
      'MSFT': 'Microsoft Corp.',
      'GOOGL': 'Alphabet Inc.',
      'AMZN': 'Amazon.com Inc.',
      'TSLA': 'Tesla Inc.',
      'NFLX': 'Netflix Inc.',
      'AMD': 'Advanced Micro Devices Inc.',
      'INTC': 'Intel Corp.'
    };
    
    const companyName = companyNames[ticker.toUpperCase()] || ticker.toUpperCase();
    const companyNameFormatted = `${companyName} (NASDAQ: ${ticker.toUpperCase()})`;
>>>>>>> 8e3f4bf
    
    // Get current day
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const today = new Date();
    const currentDay = today.getDay();
    const tradingDay = days[currentDay];

<<<<<<< HEAD
    // Extract event dates from article content and determine time context
    let timeContext = '';
    let eventDates = [];
    
    // Look for event date patterns in the content
    const eventDatePatterns = [
      /(?:earnings|results|report|announcement|release|opening|event).*?(?:on|for|scheduled for|after|took place on).*?(\w+)\s+(\d{1,2})/gi,
      /(?:earnings|results|report|announcement|release|opening|event).*?(\d{1,2})\/(\d{1,2})/gi,
      /(?:earnings|results|report|announcement|release|opening|event).*?(\d{1,2})-(\d{1,2})/gi,
      // Also look for day of week + date patterns
      /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s*,?\s*(\w+)\s+(\d{1,2})/gi,
    ];
    
    for (const pattern of eventDatePatterns) {
      const matches = [...scrapedContent.matchAll(pattern)];
      for (const match of matches) {
        const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 
                           'july', 'august', 'september', 'october', 'november', 'december'];
        
        let month, day, dayOfWeek = null;
        
        // Check if this is a day of week pattern
        const dayOfWeekMatch = match[0].match(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i);
        if (dayOfWeekMatch) {
          dayOfWeek = dayOfWeekMatch[1];
        }
        
        if (match[1].length <= 2) {
          // Numeric format: 8/19 or 8-19
          month = parseInt(match[1]) - 1;
          day = parseInt(match[2]);
        } else {
          // Text format: August 19
          const monthName = match[1].toLowerCase();
          month = monthNames.indexOf(monthName);
          day = parseInt(match[2]);
        }
        
        if (month !== -1 && day) {
          // Assume current year for event dates
          const eventDate = new Date(today.getFullYear(), month, day);
          
          // Validate day of week if provided
          if (dayOfWeek) {
            const actualDayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][eventDate.getDay()];
            if (actualDayOfWeek.toLowerCase() === dayOfWeek.toLowerCase()) {
              eventDates.push({ date: eventDate, dayOfWeek, context: match[0] });
            } else {
              console.log(`Day of week mismatch: expected ${dayOfWeek}, got ${actualDayOfWeek} for date ${eventDate.toDateString()}`);
            }
          } else {
            eventDates.push({ date: eventDate, context: match[0] });
          }
        }
      }
    }
    
    // Determine time context based on publication date and event dates
    if (publicationDate) {
      const daysSincePublication = Math.floor((today.getTime() - publicationDate.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysSincePublication > 0) {
        timeContext = ` This article was published ${daysSincePublication} day${daysSincePublication !== 1 ? 's' : ''} ago.`;
      } else if (daysSincePublication === 0) {
        timeContext = ' This article was published today.';
      } else {
        timeContext = ` This article was published ${Math.abs(daysSincePublication)} day${Math.abs(daysSincePublication) !== 1 ? 's' : ''} in the future.`;
      }
      
      // Add event date context
      if (eventDates.length > 0) {
        const eventInfo = eventDates[0]; // Use the first event date found
        const eventDate = eventInfo.date;
        const daysSinceEvent = Math.floor((today.getTime() - eventDate.getTime()) / (1000 * 60 * 60 * 24));
        
        // Determine event type from context
        let eventType = 'event';
        if (eventInfo.context.toLowerCase().includes('earnings')) eventType = 'earnings';
        else if (eventInfo.context.toLowerCase().includes('opening')) eventType = 'opening';
        else if (eventInfo.context.toLowerCase().includes('report')) eventType = 'report';
        else if (eventInfo.context.toLowerCase().includes('announcement')) eventType = 'announcement';
        
        if (daysSinceEvent > 0) {
          timeContext += ` The main ${eventType} mentioned in this article occurred ${daysSinceEvent} day${daysSinceEvent !== 1 ? 's' : ''} ago.`;
        } else if (daysSinceEvent === 0) {
          timeContext += ` The main ${eventType} mentioned in this article is scheduled for today.`;
        } else {
          timeContext += ` The main ${eventType} mentioned in this article is scheduled for ${Math.abs(daysSinceEvent)} day${Math.abs(daysSinceEvent) !== 1 ? 's' : ''} from now.`;
        }
      }
    }

=======
>>>>>>> 8e3f4bf
    // Clean the scraped content to extract only the relevant article text
    let cleanContent = scrapedContent;
    
    // Remove all the navigation and website structure
    const patternsToRemove = [
      /Benzinga.*?Login/gs,
      /Register.*?Services/gs,
      /News.*?Crypto/gs,
      /Research.*?Tools/gs,
      /Free.*?Portfolio/gs,
      /Calculators.*?Screeners/gs,
      /Stock.*?Recent/gs,
      /Markets.*?read/gs,
      /by.*?Follow/gs,
      /Zinger.*?Points/gs,
      /Get more.*?opportunity\./gs,
      /Add Comment.*?Score/gs,
      /Locked.*?Score/gs,
      /Benzinga.*?Score/gs,
      /Edge.*?Overview/gs,
      /Momentum.*?Overview/gs,
      /Also Read.*?Momentum/gs,
      /Big Money.*?$/gs,
      /España.*?Français/gs,
      /My Account.*?Login/gs,
      /Get Benzinga.*?Events/gs,
      /Premarket.*?Contribute/gs,
      /Our Services.*?Crypto/gs,
      /Earnings.*?Crypto/gs,
      /M&A.*?Crypto/gs,
      /Buybacks.*?Crypto/gs,
      /Legal.*?Crypto/gs,
      /Interviews.*?Crypto/gs,
      /Management.*?Crypto/gs,
      /Offerings.*?Crypto/gs,
      /IPOs.*?Crypto/gs,
      /Insider.*?Crypto/gs,
      /Biotech.*?Crypto/gs,
      /FDA.*?Crypto/gs,
      /Politics.*?Crypto/gs,
      /Healthcare.*?Crypto/gs,
      /Pre-Market.*?Crypto/gs,
      /After Hours.*?Crypto/gs,
      /Movers.*?Crypto/gs,
      /ETFs.*?Crypto/gs,
      /Forex.*?Crypto/gs,
      /Commodities.*?Crypto/gs,
      /Binary.*?Crypto/gs,
      /Options.*?Crypto/gs,
      /Bonds.*?Crypto/gs,
      /Futures.*?Crypto/gs,
      /CME.*?Crypto/gs,
      /Global.*?Crypto/gs,
      /Economics.*?Crypto/gs,
      /Mining.*?Crypto/gs,
      /Previews.*?Crypto/gs,
      /Small-Cap.*?Crypto/gs,
      /Real Estate.*?Crypto/gs,
      /Penny.*?Crypto/gs,
      /Digital.*?Crypto/gs,
      /Securities.*?Crypto/gs,
      /Volatility.*?Crypto/gs,
      /From The Press.*?Crypto/gs,
      /Jim Cramer.*?Crypto/gs,
      /Rumors.*?Crypto/gs,
      /Whisper.*?Crypto/gs,
      /Index.*?Crypto/gs,
      /Stock of the Day.*?Crypto/gs,
      /Best Stocks.*?Crypto/gs,
      /Best Penny.*?Crypto/gs,
      /Best S&P.*?Crypto/gs,
      /Best Swing.*?Crypto/gs,
      /Best Blue.*?Crypto/gs,
      /Best High-Volume.*?Crypto/gs,
      /Best Small.*?Crypto/gs,
      /Best Stocks to Day.*?Crypto/gs,
      /Best REITs.*?Crypto/gs,
      /Money.*?Crypto/gs,
      /Investing.*?Crypto/gs,
      /Cryptocurrency.*?Crypto/gs,
      /Mortgage.*?Crypto/gs,
      /Insurance.*?Crypto/gs,
      /Yield.*?Crypto/gs,
      /Personal.*?Crypto/gs,
      /Finance.*?Crypto/gs,
      /Startup.*?Crypto/gs,
      /Real Estate Investing.*?Crypto/gs,
      /Prop Trading.*?Crypto/gs,
      /Credit.*?Crypto/gs,
      /Cards.*?Crypto/gs,
      /Stock Brokers.*?Crypto/gs,
      /Research.*?Crypto/gs,
      /My Stocks.*?Crypto/gs,
      /Tools.*?Crypto/gs,
      /Free Benzinga.*?Crypto/gs,
      /Calendars.*?Crypto/gs,
      /Analyst Ratings.*?Crypto/gs,
      /Conference.*?Crypto/gs,
      /Dividend.*?Crypto/gs,
      /Economic.*?Crypto/gs,
      /Guidance.*?Crypto/gs,
      /IPO.*?Crypto/gs,
      /SPAC.*?Crypto/gs,
      /Stock Split.*?Crypto/gs,
      /Trade Ideas.*?Crypto/gs,
      /Free Stock.*?Crypto/gs,
      /Insider Trades.*?Crypto/gs,
      /Trade Idea.*?Crypto/gs,
      /Analyst Ratings.*?Crypto/gs,
      /Unusual Options.*?Crypto/gs,
      /Heatmaps.*?Crypto/gs,
      /Free Newsletter.*?Crypto/gs,
      /Government.*?Crypto/gs,
      /Perfect Stock.*?Crypto/gs,
      /Easy Income.*?Crypto/gs,
      /Short Interest.*?Crypto/gs,
      /Most Shorted.*?Crypto/gs,
      /Largest Increase.*?Crypto/gs,
      /Largest Decrease.*?Crypto/gs,
      /Calculators.*?Crypto/gs,
      /Margin.*?Crypto/gs,
      /Forex Profit.*?Crypto/gs,
      /100x Options.*?Crypto/gs,
      /Screeners.*?Crypto/gs,
      /Stock Screener.*?Crypto/gs,
      /Top Momentum.*?Crypto/gs,
      /Top Quality.*?Crypto/gs,
      /Top Value.*?Crypto/gs,
      /Top Growth.*?Crypto/gs,
      /Recent.*?Crypto/gs,
      /August.*?read/gs,
      /Chandrima.*?Follow/gs,
      /Key Points.*?opportunity\./gs,
      /Add Comment.*?Score/gs,
      /Locked.*?Score/gs,
      /Benzinga Rankings.*?Score/gs,
      /Reveal Full.*?Score/gs,
      /Edge Rankings.*?Overview/gs,
      /Momentum.*?Overview/gs,
      /Price Trend.*?Overview/gs,
      /Short.*?Overview/gs,
      /Medium.*?Overview/gs,
      /Long.*?Overview/gs,
      /Overview.*?Overview/gs,
      /Also Read.*?Momentum/gs,
      /Big Money.*?$/gs
    ];
    
    // Apply all removal patterns
    patternsToRemove.forEach(pattern => {
      cleanContent = cleanContent.replace(pattern, '');
    });
    
    // Clean up whitespace and formatting
    cleanContent = cleanContent
      .replace(/\\n+/g, ' ') // Replace multiple newlines with spaces
      .replace(/\\s+/g, ' ') // Replace multiple spaces with single space
      .replace(/\\s+/g, ' ') // Replace multiple spaces with single space
      .trim();
    
    // If the content is still too long or contains too much navigation, extract just the main article
    if (cleanContent.length > 1000 || cleanContent.includes('Benzinga')) {
      // Try to find the main article content
      const articleMatch = cleanContent.match(/(World index provider|MSCI|The revisions|The three largest|On the side of emerging markets).*?(?=Also Read|Big Money|$)/s);
      if (articleMatch) {
        cleanContent = articleMatch[0];
      }
    }
    
    // Debug logging
    console.log('Original content length:', scrapedContent.length);
    console.log('Cleaned content length:', cleanContent.length);
    console.log('Cleaned content preview:', cleanContent.substring(0, 200) + '...');

    // Determine source type and hyperlink instructions
    let hyperlinkInstructions = '';
    if (scrapedUrl) {
      const isBenzinga = scrapedUrl.includes('benzinga.com') || scrapedUrl.includes('benzinga');
<<<<<<< HEAD
      const dateContext = prDate ? ` Include the date "${prDate}" when referencing this announcement.` : '';
      
      if (isBenzinga) {
        hyperlinkInstructions = `- PRIMARY SOURCE HYPERLINK: In the lead paragraph, you MUST hyperlink the phrase "recent announcement" or "announcement" or "news" to the primary source URL.${dateContext} Format as: <a href="${scrapedUrl}" target="_blank">recent announcement</a> or <a href="${scrapedUrl}" target="_blank">announcement</a>`;
      } else {
        // Extract domain for other sources
        const urlObj = new URL(scrapedUrl);
        const domain = urlObj.hostname.replace('www.', '');
        const sourceName = domain.split('.')[0].toUpperCase();
        hyperlinkInstructions = `- PRIMARY SOURCE HYPERLINK: In the lead paragraph, include "According to ${sourceName}" with "According" hyperlinked to the source URL.${dateContext} Format as: <a href="${scrapedUrl}" target="_blank">According</a> to ${sourceName}`;
      }
    }

    // Clean context content if provided
    let cleanContextContent = '';
    if (contextContent) {
      cleanContextContent = contextContent
        .replace(/\\n+/g, ' ')
        .replace(/\\s+/g, ' ')
        .trim();
      
      // Apply the same cleaning patterns to context content
      patternsToRemove.forEach(pattern => {
        cleanContextContent = cleanContextContent.replace(pattern, '');
      });
    }

    // Determine context hyperlink instructions
    let contextHyperlinkInstructions = '';
    if (contextUrl) {
      const isBenzinga = contextUrl.includes('benzinga.com') || contextUrl.includes('benzinga');
      if (isBenzinga) {
        const dateContext = contextDate ? ` When referencing this context information, include the date: "${contextDate}"` : '';
        contextHyperlinkInstructions = `- CONTEXT HYPERLINK: In the main content (NOT the lead paragraph), naturally hyperlink any three consecutive words to the context URL.${dateContext} Do NOT mention "Benzinga" - just hyperlink existing text naturally. Format as: <a href="${contextUrl}" target="_blank">[three word phrase]</a>`;
      } else {
        const urlObj = new URL(contextUrl);
        const domain = urlObj.hostname.replace('www.', '');
        const sourceName = domain.split('.')[0].toUpperCase();
        const dateContext = contextDate ? ` When referencing this context information, include the date: "${contextDate}"` : '';
        contextHyperlinkInstructions = `- CONTEXT HYPERLINK: In the main content (NOT the lead paragraph), include "According to ${sourceName}" with "According" hyperlinked to the context URL.${dateContext} Format as: <a href="${contextUrl}" target="_blank">According</a> to ${sourceName}`;
      }
=======
      if (isBenzinga) {
        hyperlinkInstructions = `- HYPERLINK: In the second paragraph, naturally hyperlink relevant text to the source URL. Do NOT mention "Benzinga" - just hyperlink existing text naturally. Format as: <a href="${scrapedUrl}" target="_blank">[relevant text]</a>`;
             } else {
         // Extract domain for other sources
         const urlObj = new URL(scrapedUrl);
         const domain = urlObj.hostname.replace('www.', '');
         const sourceName = domain.split('.')[0].toUpperCase();
         hyperlinkInstructions = `- HYPERLINK: In the second paragraph, include "According to ${sourceName}" with "According" hyperlinked to the source URL. Format as: <a href="${scrapedUrl}" target="_blank">According</a> to ${sourceName}`;
       }
>>>>>>> 8e3f4bf
    }

    const prompt = `You are a financial journalist creating a news story about ${ticker}. 

IMPORTANT: You must create a NEW, ORIGINAL story based on the information provided. DO NOT return the raw scraped content or copy it directly.

<<<<<<< HEAD
TIME CONTEXT:${timeContext} Use this information to determine if events mentioned in the article have already happened or are scheduled to happen in the future. Write accordingly.

CURRENT DATE: Today is ${today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}. Use this as your reference point for determining if events are past, present, or future.

Based on the following cleaned article content${contextContent ? ' and context information' : ''}, create a complete news story with the EXACT structure:

1. HEADLINE: Format as "[Company] Stock Is Trending ${tradingDay}: What's Going On?" (no quotes, no bold formatting)
2. LEAD PARAGRAPH: ${companyNameFormatted} + movement + time context + day of the week (exactly 2 sentences)
3. MAIN CONTENT: 2-3 paragraphs incorporating the key information from the article${contextContent ? ' and context' : ''} (2 sentences max per paragraph)

Primary Article Content:
${cleanContent}${contextContent ? `

Context Information:
${cleanContextContent}` : ''}
=======
Based on the following cleaned article content, create a complete news story with the EXACT structure:

1. HEADLINE: Format as "[Company] Stock Is Trending ${tradingDay}: What's Going On?" (no quotes, no bold formatting)
2. LEAD PARAGRAPH: ${companyNameFormatted} + movement + time context + day of the week (exactly 2 sentences)
3. MAIN CONTENT: 2-3 paragraphs incorporating the key information from the article (2 sentences max per paragraph)

Article Content:
${cleanContent}
>>>>>>> 8e3f4bf

REQUIRED FORMAT:
- Headline: [Company] Stock Is Trending ${tradingDay}: What's Going On?
- Lead: Use exact format "${companyNameFormatted}" + general movement + ${tradingDay}
<<<<<<< HEAD
- Lead Hyperlinks: Include exactly ${scrapedUrl ? '1' : '0'} primary source hyperlink in the lead paragraph${contextUrl ? ' (context source hyperlink goes in main content)' : ''}
=======
>>>>>>> 8e3f4bf
- Content: Professional financial journalism style
- Paragraphs: Separate with double line breaks (\\n\\n)
- No quotes around any content
- No bold formatting
- Keep paragraphs to 2 sentences maximum
- Focus on the key news and financial implications
- Do NOT include any website navigation, menus, or promotional content
- DO NOT copy the original text - write a new story based on the information
<<<<<<< HEAD
- Use appropriate tense: past tense for events that have already occurred, present tense for current events, future tense only for scheduled future events
${hyperlinkInstructions}${contextHyperlinkInstructions}

HYPERLINK REQUIREMENTS:
- Primary source hyperlink: Must be in the lead paragraph, use any three consecutive words naturally
- Context source hyperlink: Must be in the main content (NOT the lead paragraph), use any three consecutive words naturally
- Do NOT mention "Benzinga" or source names - just hyperlink existing text
=======
${hyperlinkInstructions}
>>>>>>> 8e3f4bf

Generate the complete story with this exact structure:`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
             messages: [
         {
           role: "system",
           content: "You are a professional financial journalist writing for a financial news website. You must create properly structured news stories with headlines, lead paragraphs, and main content. Never return raw scraped content - always create a new, well-formatted story based on the information provided."
         },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 1500,
    });

    const story = completion.choices[0]?.message?.content?.trim();

    if (!story) {
      return NextResponse.json({ error: 'Failed to generate story' }, { status: 500 });
    }

<<<<<<< HEAD
    // Post-processing: Ensure source hyperlink is added if missing
    let finalStory = story;
    if (scrapedUrl) {
      const hasHyperlink = finalStory.includes('<a href="') && finalStory.includes(scrapedUrl);
      
      if (!hasHyperlink) {
        console.log('Source hyperlink missing, adding it to lead paragraph...');
        
        // Split into paragraphs
        const paragraphs = finalStory.split('\n\n').filter(p => p.trim());
        
        if (paragraphs.length > 0) {
          const leadParagraph = paragraphs[0];
          
          // Try to add hyperlink to "recent announcement" or "announcement" or "news"
          let updatedLead = leadParagraph;
          
          if (leadParagraph.includes('recent announcement')) {
            updatedLead = leadParagraph.replace(
              'recent announcement',
              `<a href="${scrapedUrl}" target="_blank">recent announcement</a>`
            );
          } else if (leadParagraph.includes('announcement')) {
            updatedLead = leadParagraph.replace(
              'announcement',
              `<a href="${scrapedUrl}" target="_blank">announcement</a>`
            );
          } else if (leadParagraph.includes('news')) {
            updatedLead = leadParagraph.replace(
              'news',
              `<a href="${scrapedUrl}" target="_blank">news</a>`
            );
          } else {
            // If no suitable phrase found, add hyperlink at the beginning of the lead paragraph
            updatedLead = `<a href="${scrapedUrl}" target="_blank">recent announcement</a> ${leadParagraph}`;
          }
          
          paragraphs[0] = updatedLead;
          finalStory = paragraphs.join('\n\n');
          console.log('Source hyperlink added to lead paragraph');
        }
      }
    }

    // Post-processing: Remove any "Headline:" prefix and section labels
    finalStory = finalStory.replace(/^Headline:\s*/i, '');
    finalStory = finalStory.replace(/^Lead Paragraph:\s*/i, '');
    finalStory = finalStory.replace(/^Main Content:\s*/i, '');

    return NextResponse.json({ story: finalStory });
=======
    return NextResponse.json({ story });
>>>>>>> 8e3f4bf
  } catch (error: any) {
    console.error('Error generating base story:', error);
    return NextResponse.json({ error: 'Failed to generate base story' }, { status: 500 });
  }
}
