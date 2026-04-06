import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, SchemaTypes } from 'mongoose';

export type TemplateDocument = Template & Document;

@Schema({ timestamps: true })
export class Template {
  @Prop({ required: true, index: true })
  internalApiKey: string; // Para identificar de qué cuenta/cliente es la plantilla

  @Prop({ required: true })
  name: string; // Ej: 'recordatorio_pago_boletos'

  @Prop({ required: true })
  language: string; // Ej: 'es'

  @Prop({ required: true })
  status: string; // 'APPROVED', 'REJECTED', 'PENDING'

  @Prop({ required: true })
  category: string; // 'MARKETING', 'UTILITY', 'AUTHENTICATION'

  @Prop({ default: false })
  hasMedia: boolean; // true si requiere imagen, video o documento

  @Prop({ enum: ['IMAGE', 'VIDEO', 'DOCUMENT', 'TEXT', 'NONE'], default: 'NONE' })
  headerType: string;

  @Prop({ default: null })
  headerContent: string; // El texto del header (si es TEXT) o nulo si es media

  @Prop({ required: true })
  bodyText: string; // El texto principal de la plantilla con sus {{1}}, {{2}}...

  @Prop({ default: null })
  footerText: string; // El texto pequeñito gris al final (no acepta variables)

  @Prop({ type: [SchemaTypes.Mixed], default: [] })
  buttons: any[]; // Array con los botones (Quick Replies, URLs dinámicas, etc.)

  @Prop({ type: [String], default: [] })
  headerVariablesMapping: string[]; // Si el header es texto y tiene {{1}}, qué variable de tu sistema va ahí

  @Prop({ type: [String], default: [] })
  bodyVariablesMapping: string[]; // Ej: ['nombre', 'boletos_comprados', 'fecha_sorteo']

  @Prop({ type: [String], default: [] })
  buttonVariablesMapping: string[]; // Si el botón es un enlace dinámico que termina en {{1}}

  @Prop({ type: SchemaTypes.Mixed })
  rawComponents: any;

  @Prop({ default: true })
  active: boolean;
}

export const TemplateSchema = SchemaFactory.createForClass(Template);

// Índice compuesto para evitar guardar la misma plantilla del mismo idioma dos veces
TemplateSchema.index({ internalApiKey: 1, name: 1, language: 1 }, { unique: true });