import { Controller, Get, Query, Headers, UnauthorizedException, Post, UseInterceptors, Body, UploadedFile, HttpException, HttpStatus, Put, BadRequestException } from '@nestjs/common';
import { ChatService } from './chat.service';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('api/chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // Obtener la lista lateral de chats usando el Header
  @Get('/list')
  async getList(@Headers('x-api-key') internalApiKey: string) {
    if (!internalApiKey) {
      throw new UnauthorizedException('No se proporcionó la internalApiKey');
    }

    let chats: any[] = await this.chatService.getChatList(internalApiKey);    

    return chats;
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

  @Post('media')
  @UseInterceptors(FileInterceptor('file')) // 'file' es el nombre que le dimos en el FormData de Angular
  async sendMediaMessage(
    @Headers('x-api-key') internalApiKey: string,
    @Body('to') to: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new HttpException({ok: false, msg: 'No se recibió ningún archivo'}, HttpStatus.BAD_REQUEST);
    }
    if (!internalApiKey || !to) {
      throw new HttpException({ok: false, msg: 'Faltan parámetros requeridos'}, HttpStatus.BAD_REQUEST);
    }

    try {
      const result = await this.chatService.processAndSendMedia(internalApiKey, to, file);
      return { success: true, data: result };
    } catch (error: any) {
      throw new HttpException({ok: false, msg: error.message}, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Put('conversation/name')
  async updateCustomerName(
    @Headers('x-api-key') internalApiKey: string,
    @Body('customerPhone') customerPhone: string,
    @Body('newName') newName: string
  ) {
    // 1. Validación rápida de entrada
    if (!internalApiKey || !customerPhone || !newName) {
      throw new BadRequestException({ok: false, msg:'Faltan parámetros requeridos '});
    }

    // 2. Delegamos al servicio
    return await this.chatService.updateCustomerName(internalApiKey, customerPhone, newName);
  }
}