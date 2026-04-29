import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type MessageDocument = Message & Document;

@Schema({ 
    timestamps: true,
    toJSON: {
    virtuals: true,
        transform: (doc: any, ret: any) => {
        ret.mid = ret._id; // Creamos el uid
        delete ret._id;    // Borramos el original
        delete ret.__v;    // Borramos la versión de Mongoose
        }
    }
})
export class Message {
  @Prop({ type: Types.ObjectId, ref: 'Channel', required: true, index: true })
  channelId: Types.ObjectId; // Relación con el número del cliente

  @Prop({ required: true })
  wamid: string;
  
  @Prop({ required: true })
  internalApiKey: string; 

  @Prop({ required: true })
  from: string; // Número del remitente

  @Prop({ required: true })
  to: string; // Número del destinatario

  @Prop({ required: true, enum: ['inbound', 'outbound'] })
  direction: string; // Para saber si el cliente de la rifa envió el mensaje o lo recibió

  @Prop({ required: true, enum: ['text', 'image', 'audio', 'video', 'document', 'sticker', 'template', 'button', 'interactive', 'reaction', 'unknown'] })
  type: string;

  // Usamos tipo JSON/Object para el contenido, así podemos guardar texto plano, 
  // o metadatos de archivos (media_id, url) si es una imagen o nota de voz
  @Prop({ type: Object, required: true })
  content: {
    text?: string;
    mediaId?: string;
    mimeType?: string;
    fileName?: string;
    caption?: string;
  };

  @Prop({ required: true, enum: ['sent', 'delivered', 'read', 'failed', 'received'] })
  status: string; // El estado actual del mensaje
}

export const MessageSchema = SchemaFactory.createForClass(Message);

MessageSchema.index({ channelId: 1, createdAt: -1 });
MessageSchema.index({ channelId: 1, from: 1, createdAt: -1 });