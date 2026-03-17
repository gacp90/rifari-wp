import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Message, MessageDocument } from '../whatsapp/schemas/message.schema';

@Injectable()
export class ChatService {
  constructor(
    @InjectModel(Message.name) private messageModel: Model<MessageDocument>,
  ) {}

  async getChatList(internalApiKey: string) {
    return await this.messageModel.aggregate([
      { $match: { internalApiKey } },
      {
        // Creamos un campo que siempre contenga el número del cliente
        $addFields: {
          chatWith: {
            $cond: [
              { $eq: ['$direction', 'inbound'] }, 
              '$from', // Si entra, el cliente es 'from'
              '$to'    // Si sale, el cliente es 'to'
            ]
          }
        }
      },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$chatWith', // Agrupamos por el cliente, no por el emisor
          lastMessage: { $first: '$$ROOT' },
          unreadCount: { 
            $sum: { 
              $cond: [
                { $and: [{ $eq: ['$status', 'received'] }, { $eq: ['$direction', 'inbound'] }] }, 
                1, 0
              ] 
            } 
          }
        }
      },
      { $sort: { 'lastMessage.createdAt': -1 } }
    ]);
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