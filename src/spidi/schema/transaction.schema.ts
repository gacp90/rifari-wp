import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type TransactionDocument = Transaction & Document;

@Schema({ timestamps: true })
export class Transaction {
  @Prop({ type: Types.ObjectId, ref: 'Channel', required: true })
  channelId!: Types.ObjectId; // A qué cliente pertenece la recarga

  @Prop({ required: true })
  internalApiKey!: string; // Útil para búsquedas rápidas

  @Prop({ required: true, unique: true })
  externalReference!: string; // El ID de la transacción que genera Spidi

  @Prop({ required: true })
  amount!: number; // Monto en dinero o cantidad de créditos comprados

  @Prop({ required: true, enum: ['pending', 'completed', 'failed', 'refunded'], default: 'pending' })
  status!: string;

  @Prop({ type: Object })
  spidiRawData: any; // Guardamos el JSON crudo de Spidi por si hay reclamos
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);