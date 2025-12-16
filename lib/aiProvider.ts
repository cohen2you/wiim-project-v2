/// <reference types="node" />

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
  responseFormat?: { type: 'text' | 'json_object' };
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
      } catch (error: unknown) {
        // If Gemini fails and OpenAI is available, fall back to OpenAI
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (this.openai && (errorMessage.includes('not found') || errorMessage.includes('All model attempts failed'))) {
          console.warn('Gemini models not available, falling back to OpenAI');
          return this.generateOpenAICompletion(messages, options);
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

    const completion = await this.openai.chat.completions.create({
      model: options.model || 'gpt-4-turbo-preview',
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

    // Convert messages to Gemini format (Gemini doesn't support system messages)
    // Combine system messages into the first user message
    const systemMessages = messages.filter(m => m.role === 'system');
    const nonSystemMessages = messages.filter(m => m.role !== 'system');
    
    let prompt = '';
    if (systemMessages.length > 0) {
      prompt = systemMessages.map(m => m.content).join('\n\n') + '\n\n';
    }
    
    // Combine user/assistant messages into a single prompt
    // Gemini works best with a single prompt string
    const conversation = nonSystemMessages.map(msg => {
      if (msg.role === 'user') {
        return `User: ${msg.content}`;
      } else {
        return `Assistant: ${msg.content}`;
      }
    }).join('\n\n');
    
    prompt += conversation;

    interface GeminiGenerationConfig {
      temperature: number;
      maxOutputTokens: number;
      responseMimeType?: string;
    }

    const generationConfig: GeminiGenerationConfig = {
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

    // Try different model names - gemini-pro (1.0) is deprecated, use 2.5/1.5 models
    const modelNames = options.model ? [options.model] : [
      'gemini-2.5-flash',      // Current standard (fastest/cost-effective)
      'gemini-1.5-flash',      // Legacy compatibility
      'gemini-1.5-pro',        // More capable
      'gemini-1.5-pro-latest', // Latest 1.5 version
    ];
    
    let lastError: unknown = null;
    
    // Try each model name until one works
    for (const modelName of modelNames) {
      try {
        const model = this.gemini!.getGenerativeModel({
          model: modelName,
          generationConfig,
        });

        const result = await model.generateContent(prompt);
        const response = result.response;
        const text = response.text();

        console.log(`✓ Successfully used Gemini model: ${modelName}`);
        return {
          content: text,
          provider: 'gemini',
        };
      } catch (error: unknown) {
        lastError = error;
        // If it's a 404 (model not found), try the next model
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStatus = (error as { status?: number })?.status;
        if (errorStatus === 404 || errorMessage.includes('not found')) {
          console.log(`Model ${modelName} not found, trying next...`);
          continue;
        }
        // For other errors, throw immediately
        throw error;
      }
    }
    
    // If all models failed, throw the last error
    const lastErrorMessage = lastError instanceof Error ? lastError.message : String(lastError || 'Unknown error');
    throw new Error(`Gemini API error: All model attempts failed. Last error: ${lastErrorMessage}`);
  }
}

// Export singleton instance
export const aiProvider = new AIProviderService();

