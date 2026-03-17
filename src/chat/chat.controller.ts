import { Controller, Get, Query, Headers, UnauthorizedException } from '@nestjs/common';
import { ChatService } from './chat.service';

@Controller('api/chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // Obtener la lista lateral de chats usando el Header
  @Get('/list')
  async getList(@Headers('x-api-key') internalApiKey: string) {
    if (!internalApiKey) {
      throw new UnauthorizedException('No se proporcionó la internalApiKey');
    }
    return await this.chatService.getChatList(internalApiKey);
  }

  // Obtener los mensajes de un chat específico
  @Get('/history')
  async getHistory(
    @Headers('x-api-key') internalApiKey: string,
    @Query('phone') phone: string
  ) {
    if (!internalApiKey) {
      throw new UnauthorizedException('No se proporcionó la internalApiKey');
    }
    // Ojo: Aquí también cambié el servicio para que use la apikey en lugar del channelId
    return await this.chatService.getMessagesByCustomer(internalApiKey, phone);
  }
}