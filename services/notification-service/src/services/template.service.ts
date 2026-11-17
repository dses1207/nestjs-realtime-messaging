import { Injectable, Logger } from '@nestjs/common';

export interface NotificationTemplate {
  type: 'new_message' | 'group_message' | 'group_invite';
  messageType?: 'text' | 'file' | 'image' | 'document' | 'audio' | 'video' | 'default';
  language: 'zh-TW' | 'en-US';
  title: string;
  body: string;
}

export interface RenderedNotification {
  title: string;
  body: string;
  truncatedBody?: string;
}

@Injectable()
export class TemplateService {
  private readonly logger = new Logger(TemplateService.name);
  
  // 預設通知模板 - 支援 type + messageType 組合
  private readonly templates: Record<string, Record<string, Record<string, NotificationTemplate>>> = {
    'zh-TW': {
      new_message: {
        text: {
          type: 'new_message',
          messageType: 'text',
          language: 'zh-TW',
          title: '{{senderName}}',
          body: '{{content}}'
        },
        image: {
          type: 'new_message',
          messageType: 'image',
          language: 'zh-TW',
          title: '{{senderName}}',
          body: '📷 傳送了一張圖片{{fileName ? ": " + fileName : ""}}'
        },
        file: {
          type: 'new_message',
          messageType: 'file',
          language: 'zh-TW',
          title: '{{senderName}}',
          body: '📎 傳送了檔案{{fileName ? ": " + fileName : ""}}'
        },
        video: {
          type: 'new_message',
          messageType: 'video',
          language: 'zh-TW',
          title: '{{senderName}}',
          body: '📹 傳送了影片{{fileName ? ": " + fileName : ""}}'
        },
        audio: {
          type: 'new_message',
          messageType: 'audio',
          language: 'zh-TW',
          title: '{{senderName}}',
          body: '🎵 傳送了語音訊息{{duration ? " (" + duration + ")" : ""}}'
        },
        document: {
          type: 'new_message',
          messageType: 'document',
          language: 'zh-TW',
          title: '{{senderName}}',
          body: '📄 傳送了文件{{fileName ? ": " + fileName : ""}}'
        }
      },
      group_message: {
        text: {
          type: 'group_message',
          messageType: 'text',
          language: 'zh-TW',
          title: '{{conversationName}}',
          body: '{{senderName}}: {{content}}'
        },
        image: {
          type: 'group_message',
          messageType: 'image',
          language: 'zh-TW',
          title: '{{conversationName}}',
          body: '{{senderName}} 📷 傳送了圖片{{fileName ? ": " + fileName : ""}}'
        },
        file: {
          type: 'group_message',
          messageType: 'file',
          language: 'zh-TW',
          title: '{{conversationName}}',
          body: '{{senderName}} 📎 傳送了檔案{{fileName ? ": " + fileName : ""}}'
        },
        video: {
          type: 'group_message',
          messageType: 'video',
          language: 'zh-TW',
          title: '{{conversationName}}',
          body: '{{senderName}} 📹 傳送了影片{{fileName ? ": " + fileName : ""}}'
        },
        audio: {
          type: 'group_message',
          messageType: 'audio',
          language: 'zh-TW',
          title: '{{conversationName}}',
          body: '{{senderName}} 🎵 傳送了語音{{duration ? " (" + duration + ")" : ""}}'
        },
        document: {
          type: 'group_message',
          messageType: 'document',
          language: 'zh-TW',
          title: '{{conversationName}}',
          body: '{{senderName}} 📄 傳送了文件{{fileName ? ": " + fileName : ""}}'
        }
      },
      group_invite: {
        default: {
          type: 'group_invite',
          messageType: 'default',
          language: 'zh-TW',
          title: '群組邀請',
          body: '{{senderName}} 邀請您加入 {{conversationName}}'
        }
      }
    },
    'en-US': {
      new_message: {
        text: {
          type: 'new_message',
          messageType: 'text',
          language: 'en-US',
          title: '{{senderName}}',
          body: '{{content}}'
        },
        image: {
          type: 'new_message',
          messageType: 'image',
          language: 'en-US',
          title: '{{senderName}}',
          body: '📷 sent an image{{fileName ? ": " + fileName : ""}}'
        },
        file: {
          type: 'new_message',
          messageType: 'file',
          language: 'en-US',
          title: '{{senderName}}',
          body: '📎 sent a file{{fileName ? ": " + fileName : ""}}'
        },
        video: {
          type: 'new_message',
          messageType: 'video',
          language: 'en-US',
          title: '{{senderName}}',
          body: '📹 sent a video{{fileName ? ": " + fileName : ""}}'
        },
        audio: {
          type: 'new_message',
          messageType: 'audio',
          language: 'en-US',
          title: '{{senderName}}',
          body: '🎵 sent a voice message{{duration ? " (" + duration + ")" : ""}}'
        },
        document: {
          type: 'new_message',
          messageType: 'document',
          language: 'en-US',
          title: '{{senderName}}',
          body: '📄 sent a document{{fileName ? ": " + fileName : ""}}'
        }
      },
      group_message: {
        text: {
          type: 'group_message',
          messageType: 'text',
          language: 'en-US',
          title: '{{conversationName}}',
          body: '{{senderName}}: {{content}}'
        },
        image: {
          type: 'group_message',
          messageType: 'image',
          language: 'en-US',
          title: '{{conversationName}}',
          body: '{{senderName}} 📷 sent an image{{fileName ? ": " + fileName : ""}}'
        },
        file: {
          type: 'group_message',
          messageType: 'file',
          language: 'en-US',
          title: '{{conversationName}}',
          body: '{{senderName}} 📎 sent a file{{fileName ? ": " + fileName : ""}}'
        },
        video: {
          type: 'group_message',
          messageType: 'video',
          language: 'en-US',
          title: '{{conversationName}}',
          body: '{{senderName}} 📹 sent a video{{fileName ? ": " + fileName : ""}}'
        },
        audio: {
          type: 'group_message',
          messageType: 'audio',
          language: 'en-US',
          title: '{{conversationName}}',
          body: '{{senderName}} 🎵 sent audio{{duration ? " (" + duration + ")" : ""}}'
        },
        document: {
          type: 'group_message',
          messageType: 'document',
          language: 'en-US',
          title: '{{conversationName}}',
          body: '{{senderName}} 📄 sent a document{{fileName ? ": " + fileName : ""}}'
        }
      },
      group_invite: {
        default: {
          type: 'group_invite',
          messageType: 'default',
          language: 'en-US',
          title: 'Group Invitation',
          body: '{{senderName}} invited you to join {{conversationName}}'
        }
      }
    }
  };

  /**
   * 取得通知模板
   */
  async getTemplate(
    type: 'new_message' | 'group_message' | 'group_invite',
    messageType: 'text' | 'file' | 'image' | 'document' | 'audio' | 'video' = 'text',
    language: string = 'zh-TW'
  ): Promise<NotificationTemplate> {
    // 如果語言不存在，使用預設語言
    const lang = this.templates[language] ? language : 'zh-TW';

    // 對於群組邀請，統一使用 default
    const msgType = type === 'group_invite' ? 'default' : messageType;

    const typeTemplates = this.templates[lang][type];
    if (!typeTemplates) {
      throw new Error(`Template type not found: ${type}, language: ${lang}`);
    }

    const template = typeTemplates[msgType];
    if (!template) {
      // 如果找不到特定messageType，回退到text類型
      const fallbackTemplate = typeTemplates['text'] || typeTemplates['default'];
      if (!fallbackTemplate) {
        throw new Error(`Template not found for type: ${type}, messageType: ${msgType}, language: ${lang}`);
      }
      this.logger.warn(`Template not found for messageType: ${msgType}, using fallback for type: ${type}`);
      return fallbackTemplate;
    }

    return template;
  }

  /**
   * 渲染通知模板
   */
  async renderTemplate(
    template: NotificationTemplate,
    data: Record<string, any>
  ): Promise<RenderedNotification> {
    try {
      // 替換標題中的變數
      let title = template.title;
      let body = template.body;

      // 處理條件式模板變數（如 fileName、duration）
      body = this.processConditionalVariables(body, data);

      // 簡單的模板變數替換
      Object.keys(data).forEach(key => {
        const placeholder = `{{${key}}}`;
        title = title.replace(new RegExp(placeholder, 'g'), data[key] || '');
        body = body.replace(new RegExp(placeholder, 'g'), data[key] || '');
      });

      // 清理剩餘的模板變數
      title = title.replace(/{{[^}]+}}/g, '');
      body = body.replace(/{{[^}]+}}/g, '');

      // 內容長度限制
      const maxBodyLength = this.getMaxBodyLength(template.type);
      let truncatedBody: string | undefined;

      if (body.length > maxBodyLength) {
        truncatedBody = body.substring(0, maxBodyLength - 3) + '...';
      }

      const result: RenderedNotification = {
        title: title.trim(),
        body: body.trim(),
        ...(truncatedBody && { truncatedBody })
      };

      this.logger.debug(`Rendered notification template: ${template.type}/${template.messageType}`, result);
      return result;

    } catch (error) {
      this.logger.error(`Failed to render template: ${template.type}/${template.messageType}`, error);
      throw new Error(`Template rendering failed: ${error.message}`);
    }
  }

  /**
   * 處理條件式模板變數 (如 fileName ? ": " + fileName : "")
   */
  private processConditionalVariables(template: string, data: Record<string, any>): string {
    // 處理條件式變數：{{variable ? "prefix" + variable : ""}}
    const conditionalRegex = /{{(\w+)\s*\?\s*"([^"]*?)"\s*\+\s*\1\s*:\s*"([^"]*?)"}}/g;

    return template.replace(conditionalRegex, (match, variable, prefix, fallback) => {
      const value = data[variable];
      return value ? prefix + value : fallback;
    });
  }

  /**
   * 根據通知類型取得內容最大長度
   */
  private getMaxBodyLength(type: string): number {
    const limits = {
      new_message: 100,
      group_message: 80,  // 群組訊息因為有發送者名稱，限制較短
      group_invite: 120
    };
    
    return limits[type] || 100;
  }

  /**
   * 驗證模板變數
   */
  validateTemplateData(
    type: 'new_message' | 'group_message' | 'group_invite',
    messageType: 'text' | 'file' | 'image' | 'document' | 'audio' | 'video' = 'text',
    data: Record<string, any>
  ): { valid: boolean; missingFields: string[] } {
    const requiredFields = {
      new_message: {
        text: ['senderName', 'content'],
        image: ['senderName'],
        file: ['senderName'],
        video: ['senderName'],
        audio: ['senderName'],
        document: ['senderName']
      },
      group_message: {
        text: ['senderName', 'content', 'conversationName'],
        image: ['senderName', 'conversationName'],
        file: ['senderName', 'conversationName'],
        video: ['senderName', 'conversationName'],
        audio: ['senderName', 'conversationName'],
        document: ['senderName', 'conversationName']
      },
      group_invite: {
        default: ['senderName', 'conversationName']
      }
    };

    const msgType = type === 'group_invite' ? 'default' : messageType;
    const required = requiredFields[type]?.[msgType] || [];
    const missingFields = required.filter(field => !data[field]);

    return {
      valid: missingFields.length === 0,
      missingFields
    };
  }

  /**
   * 格式化特殊內容類型
   */
  formatSpecialContent(content: string, contentType?: string): string {
    if (!contentType) return content;

    const formatters = {
      image: '📷 發送了一張圖片',
      file: '📎 發送了一個檔案',
      document: '📄 發送了一份文件',
      location: '📍 分享了位置',
      audio: '🎵 發送了一段語音',
      video: '📹 發送了一段影片'
    };

    return formatters[contentType] || content;
  }

  /**
   * 產生輕量化通知內容
   */
  generateLightweightBody(
    messageType: 'text' | 'file' | 'image' | 'document' | 'audio' | 'video' = 'text',
    language: string = 'zh-TW'
  ): string {
    const bodyMap = {
      'zh-TW': {
        text: '傳送了一則訊息',
        file: '📎 傳送了一個檔案',
        image: '📷 傳送了一張圖片',
        document: '📄 傳送了一份文件',
        audio: '🎵 傳送了一段語音',
        video: '📹 傳送了一段影片'
      },
      'en-US': {
        text: 'sent a message',
        file: '📎 sent a file',
        image: '📷 sent an image',
        document: '📄 sent a document',
        audio: '🎵 sent a voice message',
        video: '📹 sent a video'
      }
    };

    const lang = bodyMap[language] || bodyMap['zh-TW'];
    return lang[messageType] || lang.text;
  }

  /**
   * 根據時間調整問候語
   */
  getTimeBasedGreeting(language: string = 'zh-TW'): string {
    const hour = new Date().getHours();
    
    const greetings = {
      'zh-TW': {
        morning: '早安！',
        afternoon: '午安！',
        evening: '晚安！'
      },
      'en-US': {
        morning: 'Good morning!',
        afternoon: 'Good afternoon!',
        evening: 'Good evening!'
      }
    };

    const lang = greetings[language] || greetings['zh-TW'];
    
    if (hour >= 5 && hour < 12) return lang.morning;
    if (hour >= 12 && hour < 18) return lang.afternoon;
    return lang.evening;
  }
}