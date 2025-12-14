import { NextRequest, NextResponse } from 'next/server';
import PDFParser from 'pdf2json';

export const dynamic = 'force-dynamic';

// Helper function to wrap pdf2json in a Promise
async function parsePdfBuffer(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    // Suppress console warnings from pdf2json during parsing
    const originalWarn = console.warn;
    const originalError = console.error;
    
    // Override console.warn and console.error to filter out pdf2json noise
    console.warn = (...args: any[]) => {
      const message = String(args[0] || '');
      // Suppress pdf2json warnings (these are harmless parsing warnings)
      if (message.includes('Setting up fake worker') ||
          message.includes('Type3 font') ||
          message.includes('field.type of Link') ||
          message.includes('NOT valid form element') ||
          message.includes('custom Glyph')) {
        return; // Suppress these warnings
      }
      originalWarn.apply(console, args);
    };
    
    console.error = (...args: any[]) => {
      const message = String(args[0] || '');
      // Suppress pdf2json errors that are actually just warnings
      if (message.includes('Setting up fake worker') ||
          message.includes('Type3 font') ||
          message.includes('field.type of Link') ||
          message.includes('NOT valid form element') ||
          message.includes('custom Glyph')) {
        return; // Suppress these
      }
      originalError.apply(console, args);
    };

    const pdfParser = new PDFParser(null); // Text content only

    pdfParser.on("pdfParser_dataError", (errData: any) => {
      // Restore console methods before rejecting
      console.warn = originalWarn;
      console.error = originalError;
      reject(new Error(errData.parserError));
    });

    pdfParser.on("pdfParser_dataReady", () => {
      // Restore console methods
      console.warn = originalWarn;
      console.error = originalError;
      
      // Get raw text content and clean it up
      const rawText = pdfParser.getRawTextContent();
      resolve(rawText);
    });

    // Start parsing
    pdfParser.parseBuffer(buffer);
  });
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Check file type
    if (file.type !== 'application/pdf' && !file.name.endsWith('.pdf')) {
      return NextResponse.json({ error: 'File must be a PDF' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Parse the PDF
    const extractedText = await parsePdfBuffer(buffer);
    const trimmedText = extractedText.trim();

    if (!trimmedText) {
      return NextResponse.json({ 
        error: 'No text could be extracted from the PDF. The PDF might be image-based or encrypted.',
        text: ''
      }, { status: 400 });
    }

    console.log('PDF extraction successful. Text length:', trimmedText.length);
    console.log('PDF preview:', trimmedText.substring(0, 200));

    return NextResponse.json({ 
      text: trimmedText
    });

  } catch (error: any) {
    console.error('Error processing PDF:', error);
    
    // Provide more specific error messages
    if (error.message?.includes('encrypted') || error.message?.includes('password')) {
      return NextResponse.json({ 
        error: 'The PDF is encrypted or password-protected. Please decrypt it first or paste the text manually.',
        text: ''
      }, { status: 400 });
    }
    
    return NextResponse.json({ 
      error: error.message || 'Failed to process PDF. Please try pasting the text manually.',
      text: ''
    }, { status: 500 });
  }
}

