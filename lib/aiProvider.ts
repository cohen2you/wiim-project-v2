import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

export type AIProvider = 'openai' | 'gemini';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AICompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: { type: 'json_object' };
}

export interface AICompletionResult {
  content: string;
  provider: AIProvider;
}

class AIProviderService {
  private openai: OpenAI | null = null;
  private gemini: GoogleGenerativeAI | null = null;
  private currentProvider: AIProvider = 'openai';

  constructor() {
    // Initialize OpenAI
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
    }

    // Initialize Gemini
    if (process.env.GEMINI_API_KEY) {
      this.gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    }

    // Determine which provider to use
    // Priority: AI_PROVIDER env var > GEMINI_API_KEY > OPENAI_API_KEY
    if (process.env.AI_PROVIDER) {
      this.currentProvider = process.env.AI_PROVIDER.toLowerCase() as AIProvider;
    } else if (process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY) {
      this.currentProvider = 'gemini';
    } else {
      this.currentProvider = 'openai';
    }
  }

  getCurrentProvider(): AIProvider {
    return this.currentProvider;
  }

  setProvider(provider: AIProvider): void {
    // Validate provider is available
    if (provider === 'gemini' && !this.gemini) {
      console.warn('Gemini API key not configured, falling back to OpenAI');
      if (this.openai) {
        this.currentProvider = 'openai';
        return;
      }
      throw new Error('Gemini API key not configured and OpenAI is also not available');
    }
    if (provider === 'openai' && !this.openai) {
      console.warn('OpenAI API key not configured, falling back to Gemini');
      if (this.gemini) {
        this.currentProvider = 'gemini';
        return;
      }
      throw new Error('OpenAI API key not configured and Gemini is also not available');
    }
    this.currentProvider = provider;
  }

  async generateCompletion(
    messages: ChatMessage[],
    options: AICompletionOptions = {},
    providerOverride?: AIProvider
  ): Promise<AICompletionResult> {
    const provider = providerOverride || this.currentProvider;
    
    if (provider === 'gemini' && this.gemini) {
      try {
        return await this.generateGeminiCompletion(messages, options);
      } catch (error: any) {
        // If Gemini fails and OpenAI is available, fall back to OpenAI
        const shouldFallback = this.openai && (
          error.message?.includes('not found') || 
          error.message?.includes('All model attempts failed') || 
          error.message?.includes('404') ||
          error.message?.includes('does not exist') ||
          error.message?.includes('quota') ||
          error.message?.includes('Too Many Requests') ||
          error.message?.includes('rate limit') ||
          error.status === 429 ||
          error.isModelNotFound
        );
        
        if (shouldFallback) {
          console.warn('Gemini models not available or quota exceeded, falling back to OpenAI');
          // Override the model name to use a valid OpenAI model
          const openAIOptions = {
            ...options,
            model: (options.model && options.model.startsWith('gemini')) ? 'gpt-4-turbo' : (options.model || 'gpt-4-turbo')
          };
          return this.generateOpenAICompletion(messages, openAIOptions);
        }
        throw error;
      }
    } else if (provider === 'openai' && this.openai) {
      return this.generateOpenAICompletion(messages, options);
    } else {
      throw new Error(`AI provider '${provider}' not available. Please check your API keys.`);
    }
  }

  private async generateOpenAICompletion(
    messages: ChatMessage[],
    options: AICompletionOptions
  ): Promise<AICompletionResult> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized');
    }

    // OpenAI models (gpt-4-turbo-preview) have a max of 4096 completion tokens
    // Cap the maxTokens to prevent API errors
    const maxTokens = Math.min(options.maxTokens ?? 4096, 4096);

    // Use gpt-4-turbo or gpt-4o for larger context windows (128k tokens)
    // Fall back to gpt-4-turbo-preview if specified model not available
    const modelName = options.model || 'gpt-4-turbo';
    
    const completion = await this.openai.chat.completions.create({
      model: modelName,
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      response_format: options.responseFormat,
      temperature: options.temperature ?? 0.7,
      max_tokens: maxTokens,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    return {
      content,
      provider: 'openai',
    };
  }

  private async generateGeminiCompletion(
    messages: ChatMessage[],
    options: AICompletionOptions
  ): Promise<AICompletionResult> {
    if (!this.gemini) {
      throw new Error('Gemini client not initialized');
    }

    // Extract system message and user messages
    const systemMessage = messages.find(m => m.role === 'system')?.content || '';
    const conversationMessages = messages.filter(m => m.role !== 'system');

    // Build the prompt - combine system message with user content
    let prompt = '';
    if (systemMessage) {
      prompt += `System: ${systemMessage}\n\n`;
    }

    // Add user messages
    conversationMessages.forEach(msg => {
      if (msg.role === 'user') {
        prompt += `User: ${msg.content}\n\n`;
      } else if (msg.role === 'assistant') {
        prompt += `Assistant: ${msg.content}\n\n`;
      }
    });

    // If JSON format is required, add instruction
    if (options.responseFormat?.type === 'json_object') {
      prompt += '\n\nIMPORTANT: You must respond with valid JSON only. Do not include any text outside of the JSON object.';
    }

    const generationConfig: any = {
      temperature: options.temperature ?? 0.7,
      // CRITICAL: Gemini supports higher token limits (8192+)
      // Use the provided maxTokens or default to 8192 for Gemini
      maxOutputTokens: options.maxTokens ?? 8192,
    };

    // Gemini 1.5+ supports JSON mode - force JSON output
    if (options.responseFormat?.type === 'json_object') {
      generationConfig.responseMimeType = 'application/json';
      // Also add instruction to ensure clean JSON
      prompt += '\n\nCRITICAL: You must respond with ONLY valid JSON. Do not include any markdown code blocks, explanations, or text outside the JSON object.';
    }
    
    // Ensure maxOutputTokens is always set (critical for preventing truncation)
    if (!generationConfig.maxOutputTokens || generationConfig.maxOutputTokens < 2048) {
      generationConfig.maxOutputTokens = 8192;
    }

    // Try different model names - prioritize latest models (as of December 2025)
    // Gemini 3 Pro (preview) is the most advanced, Gemini 2.5 Pro is the most capable stable model
    // If a specific model is requested, try it first, then fall back to alternatives (avoiding duplicates)
    const requestedModel = options.model;
    const defaultFallbackChain = [
      'gemini-3-pro-preview',   // Most advanced (preview) - best reasoning and agentic capabilities
      'gemini-2.5-pro',          // Most capable stable model for production
      'gemini-2.5-flash',        // Fast stable model
      'gemini-1.5-pro',          // Fallback to 1.5 Pro
      'gemini-1.5-flash',        // Fast and cost-effective fallback
    ];
    
    // If a specific model is requested, try it first, then add fallbacks (removing duplicates)
    const modelNames = requestedModel 
      ? [requestedModel, ...defaultFallbackChain.filter(m => m !== requestedModel)]
      : defaultFallbackChain;
    
    let lastError: any = null;
    
    // Try each model name until one works
    for (const modelName of modelNames) {
      try {
        // Log the config to verify maxOutputTokens is set
        console.log(`Attempting Gemini model: ${modelName} with maxOutputTokens: ${generationConfig.maxOutputTokens}`);
        console.log(`Prompt length: ${prompt.length} characters`);
        
        const model = this.gemini.getGenerativeModel({
          model: modelName,
          generationConfig,
        });

        const result = await model.generateContent(prompt);
        const response = result.response;
        const text = response.text();
        
        console.log(`Gemini response length: ${text.length} characters`);
        
        // Check if response seems truncated (ends abruptly)
        if (text.length > 0) {
          const lastChar = text.trim().slice(-1);
          const endsWithBrace = lastChar === '}';
          const endsWithBracket = lastChar === ']';
          const endsWithQuote = lastChar === '"';
          if (!endsWithBrace && !endsWithBracket && !endsWithQuote && text.length < 1000) {
            console.warn(`⚠ Response may be truncated - ends with: "${lastChar}" (length: ${text.length})`);
          }
        }

        console.log(`✓ Successfully used Gemini model: ${modelName}`);
        return {
          content: text,
          provider: 'gemini',
        };
      } catch (error: any) {
        lastError = error;
        // Check if it's a 404 or "not found" error - try next model
        const isNotFound = error.status === 404 || 
                          error.message?.includes('not found') || 
                          error.message?.includes('404') ||
                          error.errorDetails?.includes('not found');
        
        // Check if it's a quota/rate limit error - also try next model or fall back
        const isQuotaError = error.status === 429 ||
                            error.message?.includes('quota') ||
                            error.message?.includes('Too Many Requests') ||
                            error.message?.includes('rate limit');
        
        if (isNotFound) {
          console.warn(`Model ${modelName} not found (${error.status || 'unknown'}), trying next...`);
          continue;
        }
        
        if (isQuotaError) {
          console.warn(`Model ${modelName} quota exceeded (${error.status || 'unknown'}), will fall back to OpenAI if all models fail`);
          // Continue to try other models, but mark this as a fallback candidate
          continue;
        }
        
        // For other errors (auth, etc), throw immediately
        console.error(`Gemini API error with model ${modelName}:`, error.message);
        throw error;
      }
    }
    
    // If all models failed, throw an error that can be caught for fallback
    console.error('All Gemini models failed. Last error:', lastError);
    const error = new Error(
      `Gemini API error: None of the available models worked. ` +
      `This might be due to API key permissions or model availability. ` +
      `Please check your Google AI Studio settings. ` +
      `Last error: ${lastError?.message || 'Unknown error'}`
    );
    // Add a flag to indicate this is a "not found" type error for fallback logic
    (error as any).isModelNotFound = true;
    throw error;
  }
}

// Export singleton instance
export const aiProvider = new AIProviderService();

