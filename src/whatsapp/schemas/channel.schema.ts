import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ChannelDocument = Channel & Document;

@Schema({ 
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (doc: any, ret: any) => {
      ret.uid = ret._id; // Creamos el uid
      delete ret._id;    // Borramos el original
      delete ret.__v;    // Borramos la versión de Mongoose
    }
  }
}) // Mongoose añadirá createdAt y updatedAt automáticamente
export class Channel {
  @Prop({ required: true, index: true })
  userId!: string; // El ID del cliente/organizador en tu base de datos principal de Rifari

  @Prop({ required: true, unique: true })
  phoneNumberId!: string; // El ID del número que Meta le asignó durante el Embedded Signup

  @Prop({ required: true })
  wabaId!: string; // WhatsApp Business Account ID business_id verified_name

  @Prop()
  verified_name!: string;

  @Prop()
  business_id!: string;

  @Prop()
  displayPhoneNumber!: string; // El número legible (ej. +58 424...) para mostrarlo en el panel

  @Prop({ required: true, unique: true })
  internalApiKey!: string; // El token que mencionaste, para que su frontend se autentique con este microservicio

  @Prop({ required: true, unique: true })
  access_token!: string;

  @Prop({ default: 1 })
  amount!: number;

  @Prop({ default: true })
  isActive!: boolean;

  @Prop()
  lastMessageDate!: Date;

  @Prop({default: 0})
  dailyMessagesSent!: number;

  @Prop({default: 250})
  messagingLimit!: number;

  @Prop({ default: 'PENDING' })
  metaStatus!: string;
}

export const ChannelSchema = SchemaFactory.createForClass(Channel);