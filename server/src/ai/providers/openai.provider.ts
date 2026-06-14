import OpenAI from 'openai';
import { BaseProvider } from './base.provider.js';
import { ChatMessage, ChatResponse, ToolDefinition } from '../types.js';

export class OpenAIProvider extends BaseProvider {
  private client: OpenAI;

  constructor(apiKey: string, model: string = 'gpt-4o-mini') {
    super(apiKey, model);
    this.client = new OpenAI({ apiKey: this.apiKey });
  }

  providerName(): string {
    return 'OpenAI';
  }

  supportsToolCalling(): boolean {
    return true;
  }

  supportsNativeWebSearch(): boolean {
    return true;
  }

  async chat(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    options?: { modelId?: string; maxTokens?: number; enableWebSearch?: boolean }
  ): Promise<ChatResponse> {
    const formattedMessages = messages.map(msg => {
      const formatted: any = { role: msg.role, content: msg.content };
      if (msg.name) formatted.name = msg.name;
      if (msg.tool_call_id) formatted.tool_call_id = msg.tool_call_id;
      if (msg.tool_calls) {
        formatted.tool_calls = msg.tool_calls.map((tc: any) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments)
          }
        }));
      }
      return formatted;
    });

    const requestBody: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: options?.enableWebSearch ? 'gpt-4o-mini-search-preview' : (options?.modelId || this.defaultModel),
      messages: formattedMessages,
      max_tokens: options?.maxTokens,
    };

    if (tools && tools.length > 0) {
      requestBody.tools = tools.map(tool => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
    }

    const response = await this.client.chat.completions.create(requestBody);
    const message = response.choices[0]?.message;

    if (!message) {
      throw new Error('OpenAI returned no choices');
    }

    return {
      content: message.content || '',
      toolCalls: message.tool_calls?.map((tc: any) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      })),
    };
  }
}
