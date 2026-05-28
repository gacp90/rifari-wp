import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Conversation extends Document {
  @Prop({ required: true, index: true })
  internalApiKey!: string;

  @Prop({ required: true })
  channelId!: string;

  @Prop({ required: true, index: true })
  customerPhone!: string; // El número del cliente final

  @Prop({ type: Object, required: true })
  lastMessage!: {
    wamid: string;
    text: string;
    type: string;
    direction: 'inbound' | 'outbound';
    createdAt: Date;
  };

  @Prop({ required: false, index: true })
  lastInboundDate!: Date; // La fecha del ÚLTIMO mensaje que envió el cliente

  @Prop({ default: 0 })
  unreadCount!: number;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);
// Índice compuesto para búsquedas instantáneas en la bandeja de entrada
ConversationSchema.index({ internalApiKey: 1, lastInboundDate: -1 });