import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Message, MessageDocument } from '../whatsapp/schemas/message.schema';
import { Conversation } from './schemas/conversation.schema';

@Injectable()
export class ChatService {
  constructor(
    @InjectModel(Message.name) private messageModel: Model<MessageDocument>,
    @InjectModel(Conversation.name) private conversationModel: Model<Conversation>,
  ) {}

  async getChatList(internalApiKey: string) {
    // Calculamos el límite exacto de las 24 horas
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    // Hacemos una consulta directa indexada
    return await this.conversationModel
      .find({
        internalApiKey: internalApiKey,
        // Filtro mágico: solo chats donde el cliente haya escrito en las últimas 24h
        lastInboundDate: { $gte: twentyFourHoursAgo }
      })
      .sort({ 'lastMessage.createdAt': -1 }) // Los chats con actividad más reciente primero
      .exec();
}

  // Extra: Un método para traer la conversación de un solo cliente (paginado)
  async getMessagesByCustomer(internalApiKey: string, customerPhone: string, limit = 50) {
    return await this.messageModel
      .find({
        internalApiKey: internalApiKey,
        $or: [
          { from: customerPhone }, // Mensajes que él envió
          { to: customerPhone }   // Mensajes que yo le envié a él
        ]
      })
      .sort({ createdAt: -1 }) // Traemos los últimos 50
      .limit(limit)
      .exec();
  }
}