import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { GoogleGenAI, Type } from '@google/genai';
import { promises as fsPromises } from 'fs';
import * as fs from 'fs';

@Injectable()
export class WhatsappAiService {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }

  async auditarPlantilla(textPrompt: string, file?: Express.Multer.File) {
    try {
      const contents: any[] = [];

      // 1. Procesar el archivo si el cliente subió una imagen o video
      if (file) {
        if (file.mimetype.startsWith('video/')) {
          const uploadResult = await this.ai.files.upload({
            file: file.path,
            config: {
                mimeType: file.mimetype,
            }
          });
          contents.push(uploadResult);
        } else if (file.mimetype.startsWith('image/')) {
          const imageBuffer = fs.readFileSync(file.path);
          contents.push({
            inlineData: {
              data: imageBuffer.toString('base64'),
              mimeType: file.mimetype,
            },
          });
        }
      }

      // 2. Agregar el texto de la plantilla
      contents.push(`Texto a evaluar: "${textPrompt}"`);

      // 3. Consultar a Gemini forzando una respuesta en formato JSON
      const response: any = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: contents,
        config: {
          systemInstruction: `Eres un auditor estricto de las Políticas de Comercio de Meta. 
          Busca cualquier violación relacionada con: rifas, sorteos, loterías, apuestas, venta de números o premios monetarios.
          Sé sumamente estricto. Si detectas palabras como "rifa", "sorteo", "triple", "ganador", "compra tu número", "tabla" o emojis de manzanas verdes, lechugas usados como dinero, recházalo.`,
          
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              aprobado: { type: Type.BOOLEAN },
              motivo_rechazo: { type: Type.STRING },
              sugerencia_correccion: { type: Type.STRING },
            },
            required: ['aprobado', 'motivo_rechazo', 'sugerencia_correccion'],
          },
        },
      });

      // 4. Limpieza del servidor (Vital para tu VPS de 2GB RAM)
      if (file && fs.existsSync(file.path)) {
        await fsPromises.unlink(file.path);
      }

      return JSON.parse(response.text);

    } catch (error) {
      console.error('Error con Gemini:', error);
      if (file && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
      throw new InternalServerErrorException('Error al auditar la plantilla');
    }
  }
}